"""Импорт меню с сайта сети: категории, блюда, описания, цены и фотографии.

Запуск: uv run python -m app.import_menu [--replace]
Из админки вызывается тот же код. По умолчанию блюда, которые уже есть,
не переписываются — дозаполняются только пустые поля. С --replace цены и
описания берутся с сайта заново. Фотографии повторно не качаются.
"""

import asyncio
import hashlib
import html as html_lib
import re
import sys
from dataclasses import dataclass, field
from typing import cast

import httpx
from sqlalchemy import delete, insert, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import SessionLocal, engine
from app.models.menu import Dish, DishExtra, MenuCategory, dish_extra_links
from app.seed import CATEGORIES as DEMO_CATEGORIES
from app.services import media as media_service
from app.services.sync import Change, Plan, SyncReport, describe

SITE = "https://www.mamaroma.ru"
CATALOG = f"{SITE}/dostavka/"
# Заголовки HTTP допускают только ASCII, поэтому подпись латиницей
USER_AGENT = "MamaRomaApp/0.1 (own menu import)"

PAGE_DELAY = 0.4
IMAGE_DELAY = 0.15

TENANT_ID = settings.default_tenant_id

# Пицца лежит на самой странице доставки, детское меню — в отдельном разделе
SLUG_OVERRIDES = {"/dostavka/": "pizza", "/dostavka/store/453": "kids"}

NAV_RE = re.compile(r'<li class="[^"]*"\s*><a href="(/dostavka/[^"]*)">([^<]+)</a></li>')
ITEM_RE = re.compile(
    r"class=\"item menuitem\s*\".*?"
    r"src='(?P<image>[^']*)'.*?"
    r'<p itemprop="name">(?P<name>.*?)</p>\s*'
    r"(?:<span>(?P<description>[^<]*)</span>)?.*?"
    r'<div class="price">\s*(?P<price>[\d\s]+)\s*р\.',
    re.S,
)
PHOTO_ID_RE = re.compile(r"/(\d+)\.jpg", re.I)

# Карточка блюда на сайте открывается отдельной страницей — там же лежит
# список добавок: «бекон 50 гр (95 р)» с кодом позиции в value
MODEL_RE = re.compile(r"href=['\"]/dostavka/store/model/(\d+)/(\d+)['\"]")
# Часть карточек открывается не ссылкой, а скриптом: код блюда там же
PANEL_RE = re.compile(r"openpanel\((\d+)\)")
TOPPINGS_RE = re.compile(r'<select[^>]*id="topping\d+"(.*?)</select>', re.S)
TOPPING_RE = re.compile(r"<option value='([^']+)'\s*>([^<]+)</option>")
EXTRA_PRICE_RE = re.compile(r"^(.*?)\s*\((\d+)\s*р\)\s*$")

# Сайт отдаёт собственную заглушку «Скоро здесь будет фото» вместо снимка.
# Узнаём её по отпечатку уже пережатого файла и не сохраняем
PLACEHOLDER_DIGESTS = {"b2d056516d46d906eb3a663b6c699bf4"}
TAG_RE = re.compile(r"<[^>]+>")
VOLUME_RE = re.compile(r"(\d+)\s*мл")
LITRE_RE = re.compile(r"([\d.,]+)\s*л\b")
WEIGHT_RE = re.compile(r"(\d+)\s*г\b")


@dataclass(slots=True)
class SiteExtra:
    external_id: str
    name: str
    price_kopecks: int


@dataclass(slots=True)
class SiteDish:
    name: str
    description: str | None
    price_kopecks: int
    photo_id: str | None
    volume_ml: int | None = None
    weight_grams: int | None = None
    model_url: str | None = None
    extras: list[SiteExtra] = field(default_factory=list)


def clean_name(raw: str) -> tuple[str, int | None, int | None]:
    """«Rich Кола - <nobr>330 мл</nobr>» → («Rich Кола», 330 мл, None).

    Объём и вес сайт пишет внутри названия — вытаскиваем их в свои поля.
    """
    text = TAG_RE.sub(" ", raw)
    text = re.sub(r"\s+", " ", text).strip()

    volume = VOLUME_RE.search(text)
    litre = LITRE_RE.search(text)
    weight = WEIGHT_RE.search(text)

    volume_ml = int(volume.group(1)) if volume else None
    if volume_ml is None and litre:
        volume_ml = round(float(litre.group(1).replace(",", ".")) * 1000)
    weight_grams = int(weight.group(1)) if weight else None

    # Убираем хвост вида «- 330 мл»
    name = re.sub(r"\s*[-–—]\s*[\d.,]+\s*(мл|л|г|кг)\b.*$", "", text).strip()
    return (name or text), volume_ml, weight_grams


def slug_for(href: str) -> str:
    if href in SLUG_OVERRIDES:
        return SLUG_OVERRIDES[href]
    return href.rstrip("/").rsplit("/", 1)[-1]


def parse_categories(html: str) -> list[tuple[str, str, str]]:
    """Возвращает пары «адрес, код, название» без повторов: меню продублировано для мобильных."""
    seen: dict[str, tuple[str, str, str]] = {}
    for href, name in NAV_RE.findall(html):
        slug = slug_for(href)
        if slug not in seen:
            seen[slug] = (href, slug, name.strip())
    return list(seen.values())


def parse_extras(page: str) -> list[SiteExtra]:
    """Достаёт добавки со страницы блюда: имя, цену и код позиции."""
    block = TOPPINGS_RE.search(page)
    if block is None:
        return []

    found: list[SiteExtra] = []
    for code, label in TOPPING_RE.findall(block.group(1)):
        text = html_lib.unescape(label).strip()
        price = EXTRA_PRICE_RE.match(text)
        if price is None:
            continue

        found.append(
            SiteExtra(
                external_id=code,
                name=price.group(1).strip(),
                price_kopecks=int(price.group(2)) * 100,
            )
        )

    return found


def parse_dishes(html: str) -> list[SiteDish]:
    # Код раздела берём из первой же ссылки на карточку: он одинаковый на странице
    section = MODEL_RE.search(html)
    section_id = section.group(2) if section else None

    dishes: list[SiteDish] = []
    for match in ITEM_RE.finditer(html):
        name, volume_ml, weight_grams = clean_name(match.group("name"))
        if not name:
            continue

        description = (match.group("description") or "").strip()
        price = int(re.sub(r"\D", "", match.group("price")) or 0)
        photo = PHOTO_ID_RE.search(match.group("image") or "")

        model = MODEL_RE.search(match.group(0))
        panel = PANEL_RE.search(match.group(0))
        good_id = model.group(1) if model else panel.group(1) if panel else None
        model_section = model.group(2) if model else section_id

        dishes.append(
            SiteDish(
                name=name,
                description=description or None,
                price_kopecks=price * 100,
                photo_id=photo.group(1) if photo else None,
                volume_ml=volume_ml,
                weight_grams=weight_grams,
                model_url=(
                    f"{SITE}/dostavka/store/model/{good_id}/{model_section}"
                    if good_id and model_section
                    else None
                ),
            )
        )
    return dishes


async def download_photo(client: httpx.AsyncClient, photo_id: str) -> str | None:
    """Берём полноразмерный снимок, а не превью: 1050 px против 525."""
    for path in (
        f"/dostavka/store/pictures/tovar/big/{photo_id}.jpg",
        f"/dostavka/store/pictures/tovar/thumb/{photo_id}.jpg",
    ):
        try:
            response = await client.get(f"{SITE}{path}")
        except httpx.HTTPError:
            continue

        if response.status_code == 200 and len(response.content) > 1024:
            try:
                url = media_service.save_image(response.content, "image/jpeg", "dishes")
            except media_service.MediaError:
                return None

            saved = settings.media_root / url.removeprefix(f"{settings.media_url_prefix}/")
            if hashlib.md5(saved.read_bytes()).hexdigest() in PLACEHOLDER_DIGESTS:
                saved.unlink(missing_ok=True)
                return None

            return url
    return None


def dish_key(name: str) -> str:
    """Метка блюда с сайта. Своего кода сайт не отдаёт, поэтому считаем от
    названия — оно же и служит ключом при повторном импорте."""
    digest = hashlib.sha1(name.strip().lower().encode()).hexdigest()[:12]
    return f"site-{digest}"


async def drop_demo_dishes(session: AsyncSession) -> int:
    demo_names = {name for _, _, rows in DEMO_CATEGORIES for name, *_ in rows}
    # Только демо-блюда из первой сборки: у пришедших с сайта есть метка, и
    # половина их названий совпадает с демо («Маргарита», «Тирамису»)
    rows = await session.scalars(
        select(Dish).where(
            Dish.tenant_id == TENANT_ID,
            Dish.name.in_(demo_names),
            Dish.external_id.is_(None),
        )
    )
    removed = 0
    for dish in rows.all():
        media_service.delete_image(dish.image_url)
        await session.delete(dish)
        removed += 1
    await session.commit()
    return removed


async def _sync_extras(
    session: AsyncSession, rows: list[dict[str, object]]
) -> list[DishExtra]:
    """Справочник добавок общий: одна и та же позиция идёт к десяткам блюд."""
    found: list[DishExtra] = []

    for row in rows:
        external_id = str(row["external_id"])
        extra = await session.scalar(
            select(DishExtra).where(
                DishExtra.tenant_id == TENANT_ID, DishExtra.external_id == external_id
            )
        )
        if extra is None:
            extra = DishExtra(tenant_id=TENANT_ID, external_id=external_id, name=str(row["name"]))
            session.add(extra)

        extra.name = str(row["name"])
        extra.price_kopecks = int(str(row["price_kopecks"]))
        found.append(extra)

    await session.flush()
    return found


async def plan_changes() -> Plan:
    """Читает сайт и сверяет с базой, ничего не записывая."""
    result = Plan()

    async with (
        httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT}, timeout=40, follow_redirects=True
        ) as client,
        SessionLocal() as session,
    ):
        catalog = (await client.get(CATALOG)).text
        categories = parse_categories(catalog)
        result.notes.append(f"Разделов на сайте: {len(categories)}")

        for href, slug, title in categories:
            html = catalog if href == "/dostavka/" else (await client.get(f"{SITE}{href}")).text
            await asyncio.sleep(PAGE_DELAY)

            dishes = parse_dishes(html)
            if not dishes:
                result.notes.append(f"{title}: блюд не найдено")
                continue

            for position, item in enumerate(dishes):
                if item.model_url is not None:
                    page = (await client.get(item.model_url)).text
                    item.extras = parse_extras(page)
                    await asyncio.sleep(PAGE_DELAY)

                external_id = dish_key(item.name)
                dish = await session.scalar(
                    select(Dish).where(
                        Dish.tenant_id == TENANT_ID,
                        or_(Dish.external_id == external_id, Dish.name == item.name),
                    )
                )

                payload = {
                    "name": item.name,
                    "description": item.description,
                    "price_kopecks": item.price_kopecks,
                    "photo_id": item.photo_id,
                    "volume_ml": item.volume_ml,
                    "weight_grams": item.weight_grams,
                    "category_slug": slug,
                    "category_title": title,
                    "sort_order": position,
                    "extras": [
                        {
                            "external_id": extra.external_id,
                            "name": extra.name,
                            "price_kopecks": extra.price_kopecks,
                        }
                        for extra in item.extras
                    ],
                }

                if dish is None:
                    result.changes.append(
                        Change(
                            external_id=external_id,
                            title=item.name,
                            action="create",
                            summary=f"{item.price_kopecks // 100} ₽ · {title}",
                            payload=payload,
                            group=title,
                        )
                    )
                    continue

                differences: list[str] = []
                if dish.price_kopecks != item.price_kopecks and item.price_kopecks > 0:
                    differences.append(
                        describe("price_kopecks", dish.price_kopecks, item.price_kopecks)
                    )
                if (dish.description or "") != (item.description or "") and item.description:
                    differences.append(describe("description", dish.description, item.description))
                if item.weight_grams is not None and dish.weight_grams != item.weight_grams:
                    differences.append(
                        describe("weight_grams", dish.weight_grams, item.weight_grams)
                    )
                if item.volume_ml is not None and dish.volume_ml != item.volume_ml:
                    differences.append(describe("volume_ml", dish.volume_ml, item.volume_ml))
                if dish.image_url is None and item.photo_id is not None:
                    differences.append(describe("image", None, item.photo_id))
                if len(dish.extras) != len(item.extras):
                    differences.append(f"добавки: {len(item.extras)}")

                if differences:
                    result.changes.append(
                        Change(
                            external_id=external_id,
                            title=item.name,
                            action="update",
                            summary=", ".join(differences),
                            payload=payload,
                            group=title,
                        )
                    )
                else:
                    result.unchanged += 1

    return result


async def apply_changes(changes: list[Change]) -> SyncReport:
    """Записывает только то, что менеджер оставил отмеченным."""
    report = SyncReport()
    photos = 0

    async with (
        httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT}, timeout=40, follow_redirects=True
        ) as client,
        SessionLocal() as session,
    ):
        report.removed = await drop_demo_dishes(session)

        for change in changes:
            payload = change.payload
            slug = str(payload["category_slug"])

            category = await session.scalar(
                select(MenuCategory).where(
                    MenuCategory.tenant_id == TENANT_ID, MenuCategory.slug == slug
                )
            )
            if category is None:
                category = MenuCategory(
                    tenant_id=TENANT_ID,
                    name=str(payload["category_title"]),
                    slug=slug,
                    sort_order=int(payload["sort_order"]),
                )
                session.add(category)
                await session.flush()

            dish = await session.scalar(
                select(Dish).where(
                    Dish.tenant_id == TENANT_ID,
                    or_(Dish.external_id == change.external_id, Dish.name == change.title),
                )
            )

            if dish is None:
                dish = Dish(tenant_id=TENANT_ID, name=str(payload["name"]), price_kopecks=0)
                session.add(dish)
                report.created += 1
            else:
                report.updated += 1

            dish.external_id = change.external_id
            dish.category_id = category.id
            dish.sort_order = int(payload["sort_order"])

            price = int(payload["price_kopecks"] or 0)
            if price > 0:
                dish.price_kopecks = price
                dish.is_active = True
            if payload.get("description"):
                dish.description = str(payload["description"])
            if payload.get("volume_ml") is not None:
                dish.volume_ml = int(payload["volume_ml"])
            if payload.get("weight_grams") is not None:
                dish.weight_grams = int(payload["weight_grams"])

            extras = [
                dict(row) for row in cast(list[dict[str, object]], payload.get("extras") or [])
            ]
            if extras:
                rows = await _sync_extras(session, extras)
                # Связи пишем напрямую: присваивание коллекции у только что
                # созданного блюда тянет ленивую подгрузку и рвётся на await
                await session.flush()
                await session.execute(
                    delete(dish_extra_links).where(dish_extra_links.c.dish_id == dish.id)
                )
                await session.execute(
                    insert(dish_extra_links),
                    [{"dish_id": dish.id, "extra_id": extra.id} for extra in rows],
                )

            if dish.image_url is None and payload.get("photo_id"):
                url = await download_photo(client, str(payload["photo_id"]))
                await asyncio.sleep(IMAGE_DELAY)
                if url is not None:
                    dish.image_url = url
                    photos += 1

        await session.commit()

    if photos:
        report.notes.append(f"Загружено фотографий: {photos}")
    return report


async def run() -> None:
    result = await plan_changes()
    for note in result.notes:
        print(note)
    print(f"Изменений: {len(result.changes)}, без изменений: {result.unchanged}")

    if "--apply" in sys.argv:
        report = await apply_changes(result.changes)
        print(report.summary())
    else:
        for change in result.changes[:40]:
            print(f"  {change.action:7} {change.title[:40]:42} {change.summary}")
        print("Запустите с --apply, чтобы записать")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())
