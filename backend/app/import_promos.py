"""
Импорт акций сети с сайта mamaroma.ru.

Список берём постранично из открытого API сайта, а всё остальное — со страницы
самой акции: там лежит полный текст условий и большая картинка. Из списка
приходит только превью 360×360 и обрезанный анонс, их недостаточно.

Акции, которых на сайте больше нет, удаляем: сайт здесь источник правды.
Ссылку на страницу сохраняем — за подробностями приложение ведёт туда.

Запуск: uv run python -m app.import_promos [--dry]
"""

import asyncio
import html
import re
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.models.geo import Restaurant
from app.models.promotion import Promotion
from app.services import media as media_service
from app.services.sync import Change, Plan, SyncReport, describe

SITE = "https://www.mamaroma.ru"
TENANT_ID = "mamaroma"
USER_AGENT = "Mozilla/5.0"

# Акции про доставку — их и только их показываем в карусели меню.
# Метка рисуется на карточке, поэтому она короткая
MENU_PROMOS = {
    "5pizza": "4 + 1",
    "dostavka_2026": "подарок",
    "pizzapepperoni": "подарок",
    "delivery600": "бесплатно",
    "pizza-v_podarok": "подарок",
}

TAG_RE = re.compile(r"<[^>]+>")
DESC_RE = re.compile(r'<meta name="description" content="([^"]*)"')
OG_DESC_RE = re.compile(r'<meta property="og:description" content="([^"]*)"')

# Текст акции лежит в блоке описания, картинка — в блоке над ним
BODY_RE = re.compile(r'<div class="description_block">(.*?)</div>\s*</div>', re.S)
HEADING_RE = re.compile(r"<h1[^>]*>.*?</h1>", re.S)
PAGE_PHOTO_RE = re.compile(r'<div class="img_block event_img">\s*<img src="([^"]+)"', re.S)
# Внизу страницы акции перечислены рестораны, где она идёт
PLACE_RE = re.compile(r'<div class="place">([^<]+)</div>')

# Дату мероприятия сайт держит только в тексте: «27 августа в 18:00».
# В start_at у него лежит день публикации, по нему афишу не построишь
MONTHS = (
    "январ", "феврал", "март", "апрел", "ма", "июн",
    "июл", "август", "сентябр", "октябр", "ноябр", "декабр",
)
DATE_RE = re.compile(r"\b(\d{1,2})\s+(" + "|".join(MONTHS) + r")\w*", re.IGNORECASE)
BREAK_RE = re.compile(r"<br\s*/?>|</(?:div|p|li|h\d)>", re.I)


def event_dates(text: str | None) -> tuple[datetime | None, datetime | None]:
    """«с 15 июля по 30 августа» → две даты, «27 августа» → одна.

    Года в тексте нет: берём текущий, а сильно прошедшую дату считаем
    следующим годом — так «25 декабря» в августе остаётся впереди.
    """
    if not text:
        return None, None

    today = datetime.now(UTC)
    found: list[datetime] = []

    for day, month in DATE_RE.findall(text):
        number = MONTHS.index(month.lower()) + 1
        try:
            moment = datetime(today.year, number, int(day), tzinfo=UTC)
        except ValueError:
            continue

        # Дата больше чем на полгода позади — значит речь про следующий год
        if (today - moment).days > 180:
            moment = moment.replace(year=today.year + 1)
        if moment not in found:
            found.append(moment)

    if not found:
        return None, None

    starts = min(found)
    ends = max(found)
    # Однодневное событие живёт до конца своего дня
    return starts, ends.replace(hour=23, minute=59)


@dataclass(slots=True)
class SitePromo:
    slug: str
    title: str
    photo_path: str | None
    starts_at: datetime | None
    ends_at: datetime | None = None
    venue: str | None = None
    description: str | None = None
    places: list[str] = field(default_factory=list)


def clean(raw: str) -> str:
    text = html.unescape(raw)
    text = TAG_RE.sub(" ", text).replace("\xa0", " ")
    text = re.sub(r"\s*[-–]\s*Mama Roma\s*$", "", text)
    # Сайт обрезает мета-описание по длине и оставляет битый символ в конце
    text = re.sub(r"[�\s]+$", "", text)
    return re.sub(r"\s+", " ", text).strip()


def original(photo: str) -> str:
    """Превью лежит в /conversions/ с суффиксом, оригинал — уровнем выше."""
    return re.sub(r"/conversions/(.+?)-(?:thumb|cropped)(\.\w+)$", r"/\1\2", photo)


async def fetch_promos(client: httpx.AsyncClient) -> list[SitePromo]:
    await client.get(f"{SITE}/ru/events?type=delivery")

    found: list[SitePromo] = []
    page = 1

    while page <= 20:
        payload = (await client.get(f"{SITE}/api/events", params={"page": page})).json()
        rows = payload.get("data") or []
        if not rows:
            break

        for row in rows:
            title = clean(str(row.get("title") or ""))
            href = str(row.get("href") or "")
            slug = href.rstrip("/").rsplit("/", 1)[-1]
            if not title or not slug:
                continue

            starts_at: datetime | None = None
            start = row.get("start_at")
            if isinstance(start, dict) and isinstance(start.get("date"), str):
                try:
                    starts_at = datetime.fromisoformat(start["date"]).replace(tzinfo=UTC)
                except ValueError:
                    starts_at = None

            photo = row.get("photo")
            venue = row.get("restaurants_title")

            found.append(
                SitePromo(
                    slug=slug,
                    title=title,
                    photo_path=str(photo) if isinstance(photo, str) else None,
                    starts_at=starts_at,
                    venue=clean(str(venue)) if isinstance(venue, str) else None,
                )
            )

        if not (payload.get("links") or {}).get("next"):
            break
        page += 1

    return found


def parse_body(html_text: str) -> str | None:
    """Достаёт текст акции из блока описания, сохраняя разбивку на строки."""
    block = BODY_RE.search(html_text)
    if not block:
        return None

    body = HEADING_RE.sub("", block.group(1))
    # Переводы строк сайт задаёт разметкой — превращаем их в настоящие
    body = BREAK_RE.sub("\n", body)
    body = TAG_RE.sub("", body)

    lines = [clean(line) for line in html.unescape(body).split("\n")]
    kept = [line for line in lines if line]
    if not kept:
        return None

    return "\n".join(kept)


async def fetch_details(client: httpx.AsyncClient, promo: SitePromo) -> None:
    """Забирает со страницы акции полный текст и большую картинку."""
    try:
        response = await client.get(f"{SITE}/ru/events/{promo.slug}")
    except httpx.HTTPError:
        return

    if response.status_code != 200:
        return

    promo.description = parse_body(response.text)

    if promo.description is None:
        for pattern in (DESC_RE, OG_DESC_RE):
            found = pattern.search(response.text)
            if found:
                text = clean(found.group(1))
                if text and text.lower() != "mama roma":
                    promo.description = text
                    break

    photo = PAGE_PHOTO_RE.search(response.text)
    if photo:
        promo.photo_path = photo.group(1)

    promo.places = [clean(place) for place in PLACE_RE.findall(response.text)]

    # Дата из текста — это когда событие пройдёт, а не когда его анонсировали.
    # В starts_at сайт держит день публикации, и афиша должна висеть с него
    _, ends = event_dates(promo.description)
    if ends is not None:
        promo.ends_at = ends


def _is_image(data: bytes) -> bool:
    return data[:3] == b"\xff\xd8\xff" or data[:8] == b"\x89PNG\r\n\x1a\n" or data[:4] == b"RIFF"


async def download_photo(
    client: httpx.AsyncClient, path: str | None
) -> tuple[str, int, int] | None:
    if not path:
        return None

    # Сначала оригинал, потом превью: у части акций оригинала на сервере нет
    for candidate in (original(path), path):
        try:
            response = await client.get(f"{SITE}{candidate}")
        except httpx.HTTPError:
            continue

        # У сайта мягкая ошибка: вместо картинки отдаёт страницу 404 с кодом 200,
        # поэтому проверяем содержимое, а не только код ответа
        if response.status_code != 200 or not _is_image(response.content):
            continue

        try:
            url = media_service.save_image(response.content, "image/jpeg", "promos")
        except media_service.MediaError:
            continue

        size = media_service.dimensions(url)
        return (url, *size) if size else None
    return None


async def _restaurants_by_name(session: AsyncSession) -> dict[str, Restaurant]:
    rows = await session.scalars(
        select(Restaurant).where(Restaurant.tenant_id == TENANT_ID)
    )
    return {_key(restaurant.name): restaurant for restaurant in rows}


def _key(name: str) -> str:
    """Адрес на сайте пишут по-разному: «пр. Славы, 30, к. 1» и «Славы пр., 30 к1»."""
    lowered = name.lower().replace("ё", "е")
    lowered = re.sub(r"\b(пр|ул|наб|пер|просп|проспект|улица|корпус|литера|к|д)\b\.?", " ", lowered)
    return re.sub(r"[^a-zа-я0-9]+", "", lowered)


async def plan_changes() -> Plan:
    result = Plan()

    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT, "X-Requested-With": "XMLHttpRequest"},
        timeout=40,
        follow_redirects=True,
    ) as client:
        promos = await fetch_promos(client)
        result.notes.append(f"На сайте акций: {len(promos)}")

        for promo in promos:
            await fetch_details(client, promo)

        async with SessionLocal() as session:
            existing: dict[str, Promotion] = {
                str(promotion.external_id): promotion
                for promotion in await session.scalars(
                    select(Promotion).where(Promotion.tenant_id == TENANT_ID)
                )
                if promotion.external_id
            }
            restaurants = await _restaurants_by_name(session)
            seen: set[str] = set()
            unknown: set[str] = set()

            for order, promo in enumerate(promos):
                external_id = f"event-{promo.slug}"
                seen.add(external_id)
                promotion = existing.get(external_id)

                venues: list[str] = []
                for place in promo.places:
                    restaurant = restaurants.get(_key(place))
                    if restaurant is None:
                        unknown.add(place)
                    elif str(restaurant.id) not in venues:
                        venues.append(str(restaurant.id))

                payload = {
                    "title": promo.title,
                    "description": promo.description,
                    "label": MENU_PROMOS.get(promo.slug),
                    "starts_at": promo.starts_at.isoformat() if promo.starts_at else None,
                    "ends_at": promo.ends_at.isoformat() if promo.ends_at else None,
                    "sort_order": order,
                    "show_in_menu": promo.slug in MENU_PROMOS,
                    "source_url": f"{SITE}/ru/events/{promo.slug}",
                    "photo_path": promo.photo_path,
                    "restaurant_ids": venues,
                }

                where = (
                    "во всех ресторанах"
                    if not venues
                    else f"{len(venues)} ресторан(ов)"
                    if len(venues) > 1
                    else promo.places[0]
                    if promo.places
                    else ""
                )

                if promotion is None:
                    result.changes.append(
                        Change(
                            external_id=external_id,
                            title=promo.title,
                            action="create",
                            summary=where,
                            payload=payload,
                            group="Новые акции",
                        )
                    )
                    continue

                differences: list[str] = []
                if promotion.title != promo.title:
                    differences.append(describe("title", promotion.title, promo.title))
                if (promotion.description or "") != (promo.description or ""):
                    differences.append(
                        describe("description", promotion.description, promo.description)
                    )
                if promotion.image_url is None and promo.photo_path:
                    differences.append(describe("image", None, promo.photo_path))
                if sorted(str(item.id) for item in promotion.restaurants) != sorted(venues):
                    differences.append(f"рестораны: {where}")
                if promotion.show_in_menu != (promo.slug in MENU_PROMOS):
                    differences.append("показ в меню")
                if promo.starts_at is not None and promotion.starts_at != promo.starts_at:
                    differences.append(f"показ с {promo.starts_at:%d.%m}")
                if promo.ends_at is not None and promotion.ends_at != promo.ends_at:
                    differences.append(
                        f"идёт до {promo.ends_at:%d.%m}"
                        if promo.starts_at != promo.ends_at
                        else f"дата {promo.ends_at:%d.%m}"
                    )

                if differences:
                    result.changes.append(
                        Change(
                            external_id=external_id,
                            title=promo.title,
                            action="update",
                            summary=", ".join(differences),
                            payload=payload,
                            group="Изменились",
                        )
                    )
                else:
                    result.unchanged += 1

            # Чего на сайте нет — предлагаем убрать. Акции, заведённые в админке
            # руками, живут без внешнего кода и в список не попадают
            for external_id, promotion in existing.items():
                if external_id in seen:
                    continue
                result.changes.append(
                    Change(
                        external_id=external_id,
                        title=promotion.title,
                        action="delete",
                        summary="на сайте больше нет",
                        payload={},
                        group="Пропали с сайта",
                    )
                )

            if unknown:
                result.notes.append("Не нашли ресторан: " + ", ".join(sorted(unknown)[:6]))

    return result


async def apply_changes(changes: list[Change]) -> SyncReport:
    report = SyncReport()

    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT, "X-Requested-With": "XMLHttpRequest"},
        timeout=40,
        follow_redirects=True,
    ) as client, SessionLocal() as session:
        for change in changes:
            promotion = await session.scalar(
                select(Promotion).where(
                    Promotion.tenant_id == TENANT_ID,
                    Promotion.external_id == change.external_id,
                )
            )

            if change.action == "delete":
                if promotion is not None:
                    media_service.delete_image(promotion.image_url)
                    await session.delete(promotion)
                    report.removed += 1
                continue

            payload = change.payload
            fields: dict[str, object] = {
                "title": payload["title"],
                "description": payload["description"],
                "label": payload["label"],
                "starts_at": (
                    datetime.fromisoformat(str(payload["starts_at"]))
                    if payload.get("starts_at")
                    else None
                ),
                # Дата события: до неё акция висит в афише, после — уходит
                "ends_at": (
                    datetime.fromisoformat(str(payload["ends_at"]))
                    if payload.get("ends_at")
                    else None
                ),
                "sort_order": int(payload["sort_order"]),
                "is_active": True,
                "show_in_menu": bool(payload["show_in_menu"]),
                "source_url": payload["source_url"],
            }

            photo = await download_photo(client, payload.get("photo_path"))
            if photo is not None:
                url, width, height = photo
                fields |= {"image_url": url, "image_width": width, "image_height": height}

            venues = list(
                await session.scalars(
                    select(Restaurant).where(
                        Restaurant.tenant_id == TENANT_ID,
                        Restaurant.id.in_(
                            [UUID(item) for item in payload.get("restaurant_ids", [])]
                        ),
                    )
                )
            )

            if promotion is None:
                session.add(
                    Promotion(
                        tenant_id=TENANT_ID,
                        external_id=change.external_id,
                        restaurants=venues,
                        **fields,
                    )
                )
                report.created += 1
            else:
                for name, value in fields.items():
                    setattr(promotion, name, value)
                promotion.restaurants = venues
                report.updated += 1

        await session.commit()

    return report


async def main(dry: bool) -> None:
    if dry:
        async with httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT, "X-Requested-With": "XMLHttpRequest"},
            timeout=40,
            follow_redirects=True,
        ) as client:
            for promo in await fetch_promos(client):
                mark = "меню" if promo.slug in MENU_PROMOS else "    "
                print(f"  {mark} {promo.title[:46]:48} фото: {'да' if promo.photo_path else 'нет'}")
        return

    result = await plan_changes()
    for note in result.notes:
        print(note)
    print(f"Изменений: {len(result.changes)}, без изменений: {result.unchanged}")

    report = await apply_changes(result.changes)
    print(report.summary())


if __name__ == "__main__":
    asyncio.run(main(dry="--dry" in sys.argv))
