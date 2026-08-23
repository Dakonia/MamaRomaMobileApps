"""
Импорт ресторанов сети с сайта mamaroma.ru.

Сайт отдаёт список только для выбранного города, поэтому проходим города по
очереди: переключаем город и забираем его рестораны. Часы работы и описание
берём со страницы ресторана — в API их нет.

Запуск: uv run python -m app.import_restaurants [--dry]
"""

import asyncio
import re
import sys
from dataclasses import dataclass
from datetime import time

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.core.tenants import get_tenant
from app.models.geo import City, Restaurant, RestaurantPhoto
from app.services import media as media_service
from app.services.sync import Change, Plan, SyncReport, describe

SITE = "https://www.mamaroma.ru"
TENANT_ID = "mamaroma"
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
    "X-Requested-With": "XMLHttpRequest",
}

# Часы работы, если на странице ресторана их не нашлось
DEFAULT_OPEN = time(11, 0)
DEFAULT_CLOSE = time(23, 0)

HOURS = re.compile(r"(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})")

# Коды КЛАДР регионов: по ним ищутся адреса гостей. У Петербурга своя область
# рядом, у остальных городов регион один
CITY_REGIONS = {
    "Санкт-Петербург": ["78", "47"],
    "Красноярск": ["24"],
    "Кемерово": ["42"],
    "Самара": ["63"],
    "Чита": ["75"],
    "Абакан": ["19"],
    "Киров": ["43"],
    "Мурманск": ["51"],
    "Псков": ["60"],
    "Сочи": ["23"],
}


@dataclass(slots=True)
class SiteRestaurant:
    site_id: int
    city_title: str
    address: str
    phone: str | None
    metro: str | None
    photo: str | None
    gallery: list[str]
    slug: str
    latitude: float
    longitude: float
    opens_at: time
    closes_at: time


def _coords(raw: str | None) -> tuple[float, float] | None:
    parts = [piece.strip() for piece in (raw or "").split(",")]
    if len(parts) < 2:
        return None
    try:
        return float(parts[0]), float(parts[1])
    except ValueError:
        return None


def _clean_phone(raw: str | None) -> str | None:
    """«+7 (812)  504-88-13» → «+7 (812) 504-88-13»: на сайте пробелы гуляют."""
    if not raw:
        return None
    phone = re.sub(r"\s+", " ", raw).strip()
    return phone.replace("( ", "(").replace(" )", ")")[:24]


# Снимки зала лежат в /storage/<id>/<файл>, рядом с ними — уменьшенные копии
# в /conversions, они нам не нужны
GALLERY = re.compile(r'["\'](/storage/\d+/(?!conversions)[^"\']+?\.(?:jpg|jpeg|png|webp))["\']')


def _gallery(page: str) -> list[str]:
    """Галерея интерьеров со страницы точки: порядок на сайте сохраняем."""
    found: list[str] = []
    for path in GALLERY.findall(page):
        if path not in found:
            found.append(path)
    return found[:12]


def _hours(page: str) -> tuple[time, time]:
    found = HOURS.findall(page)
    if not found:
        return DEFAULT_OPEN, DEFAULT_CLOSE

    opens_h, opens_m, closes_h, closes_m = (int(value) for value in found[0])
    return time(min(opens_h, 23), opens_m), time(min(closes_h, 23), closes_m)


async def fetch_site() -> list[SiteRestaurant]:
    async with httpx.AsyncClient(timeout=30, headers=HEADERS, follow_redirects=True) as client:
        await client.get(f"{SITE}/ru/restaurants")

        cities = (await client.get(f"{SITE}/api/cities")).json()["data"]
        found: list[SiteRestaurant] = []

        for city in cities:
            await client.put(f"{SITE}/api/cities/change", json={"city": city["id"]})
            rows = (await client.get(f"{SITE}/api/restaurants")).json()["data"]

            for row in rows:
                point = _coords(row.get("coordinates"))
                if point is None:
                    print(f"  пропускаю {row['address']}: нет координат")
                    continue

                slug = str(row.get("href", "")).rstrip("/").rsplit("/", 1)[-1]
                page = ""
                if slug:
                    try:
                        response = await client.get(f"{SITE}/restaurants/{slug}")
                        page = response.text
                    except httpx.HTTPError:
                        page = ""

                opens_at, closes_at = _hours(page)
                gallery = _gallery(page)
                metro = row.get("metro")

                found.append(
                    SiteRestaurant(
                        site_id=int(row["id"]),
                        city_title=row["city"]["title"],
                        address=str(row["address"]).strip(),
                        phone=_clean_phone(row.get("phone")),
                        metro=(metro or {}).get("title") if isinstance(metro, dict) else metro,
                        photo=row.get("photo"),
                        gallery=gallery,
                        slug=slug,
                        latitude=point[0],
                        longitude=point[1],
                        opens_at=opens_at,
                        closes_at=closes_at,
                    )
                )

        return found


async def _city_for(session: AsyncSession, title: str, order: int) -> City:
    city = await session.scalar(select(City).where(City.tenant_id == TENANT_ID, City.name == title))
    if city is not None:
        return city

    slug = re.sub(r"[^a-z0-9]+", "-", title.lower().replace("ё", "е")).strip("-") or f"city-{order}"
    city = City(
        tenant_id=TENANT_ID,
        name=title,
        slug=slug[:60],
        sort_order=order,
        suggest_regions=CITY_REGIONS.get(title, []),
    )
    session.add(city)
    await session.flush()
    print(f"  новый город: {title}")
    return city


async def _photo(client: httpx.AsyncClient, path: str | None) -> str | None:
    if not path:
        return None

    try:
        response = await client.get(f"{SITE}{path}")
        if response.status_code != 200:
            return None
        # Снимки зала показываются каруселью в полэкрана: 1400 px им незачем,
        # а вес карусели из десяти кадров это решает
        return media_service.save_image(
            response.content,
            response.headers.get("content-type"),
            folder="restaurants",
            max_side=1000,
            quality=82,
        )
    except httpx.HTTPError:
        return None


async def _gallery_for(
    session: AsyncSession,
    client: httpx.AsyncClient,
    restaurant: Restaurant,
    gallery: list[str],
) -> None:
    """Скачиваем снимки зала. Уже загруженные не трогаем: они могли быть заменены руками."""
    if not gallery:
        return

    await session.flush()
    have = await session.scalar(
        select(func.count())
        .select_from(RestaurantPhoto)
        .where(
            RestaurantPhoto.tenant_id == TENANT_ID,
            RestaurantPhoto.restaurant_id == restaurant.id,
        )
    )
    if have:
        return

    for position, path in enumerate(gallery):
        url = await _photo(client, str(path))
        if url is None:
            continue

        session.add(
            RestaurantPhoto(
                tenant_id=TENANT_ID,
                restaurant_id=restaurant.id,
                url=url,
                position=position,
            )
        )


async def plan_changes() -> Plan:
    result = Plan()
    site = await fetch_site()
    result.notes.append(f"На сайте ресторанов: {len(site)}")

    async with SessionLocal() as session:
        for row in site:
            external_id = f"site-{row.site_id}"
            restaurant = await session.scalar(
                select(Restaurant).where(
                    Restaurant.tenant_id == TENANT_ID, Restaurant.external_id == external_id
                )
            )

            payload = {
                "city_title": row.city_title,
                "address": row.address,
                "phone": row.phone,
                "metro": row.metro,
                "photo": row.photo,
                "gallery": row.gallery,
                "latitude": row.latitude,
                "longitude": row.longitude,
                "opens_at": row.opens_at.isoformat(),
                "closes_at": row.closes_at.isoformat(),
            }

            if restaurant is None:
                result.changes.append(
                    Change(
                        external_id=external_id,
                        title=row.address,
                        action="create",
                        summary=f"{row.city_title} · {row.opens_at:%H:%M}–{row.closes_at:%H:%M}",
                        payload=payload,
                        group=row.city_title,
                    )
                )
                continue

            differences: list[str] = []
            if restaurant.address != row.address:
                differences.append(describe("address", restaurant.address, row.address))
            if (restaurant.phone or "") != (row.phone or "") and row.phone:
                differences.append(describe("phone", restaurant.phone, row.phone))
            if (restaurant.metro or "") != (row.metro or "") and row.metro:
                differences.append(describe("metro", restaurant.metro, row.metro))
            if (restaurant.opens_at, restaurant.closes_at) != (row.opens_at, row.closes_at):
                differences.append(
                    f"часы работы {restaurant.opens_at:%H:%M}–{restaurant.closes_at:%H:%M} → "
                    f"{row.opens_at:%H:%M}–{row.closes_at:%H:%M}"
                )
            if restaurant.latitude is None or restaurant.longitude is None:
                differences.append(describe("point", None, row.latitude))
            if restaurant.image_url is None and row.photo:
                differences.append(describe("image", None, row.photo))

            # Галерею добираем только вперёд: снятые вручную снимки не трогаем
            have = await session.scalar(
                select(func.count())
                .select_from(RestaurantPhoto)
                .where(
                    RestaurantPhoto.tenant_id == TENANT_ID,
                    RestaurantPhoto.restaurant_id == restaurant.id,
                )
            )
            if (have or 0) == 0 and row.gallery:
                differences.append(f"фотографии зала: +{len(row.gallery)}")

            if differences:
                result.changes.append(
                    Change(
                        external_id=external_id,
                        title=restaurant.name,
                        action="update",
                        summary=", ".join(differences),
                        payload=payload,
                        group=row.city_title,
                    )
                )
            else:
                result.unchanged += 1

    return result


async def apply_changes(changes: list[Change]) -> SyncReport:
    report = SyncReport()

    async with (
        SessionLocal() as session,
        httpx.AsyncClient(
            timeout=30, headers={"User-Agent": "Mozilla/5.0"}, follow_redirects=True
        ) as client,
    ):
        cities: dict[str, City] = {}

        for order, change in enumerate(changes):
            payload = change.payload
            city_title = str(payload["city_title"])
            if city_title not in cities:
                cities[city_title] = await _city_for(session, city_title, order)
            city = cities[city_title]

            restaurant = await session.scalar(
                select(Restaurant).where(
                    Restaurant.tenant_id == TENANT_ID, Restaurant.external_id == change.external_id
                )
            )

            if restaurant is None:
                restaurant = Restaurant(
                    tenant_id=TENANT_ID,
                    external_id=change.external_id,
                    city_id=city.id,
                    name=str(payload["address"]),
                    address=str(payload["address"]),
                )
                session.add(restaurant)
                report.created += 1
            else:
                report.updated += 1

            restaurant.city_id = city.id
            restaurant.address = str(payload["address"])
            restaurant.metro = payload.get("metro")
            restaurant.phone = payload.get("phone")
            restaurant.latitude = float(payload["latitude"])
            restaurant.longitude = float(payload["longitude"])
            restaurant.opens_at = time.fromisoformat(str(payload["opens_at"]))
            restaurant.closes_at = time.fromisoformat(str(payload["closes_at"]))

            if restaurant.image_url is None and payload.get("photo"):
                image_url = await _photo(client, str(payload["photo"]))
                if image_url:
                    restaurant.image_url = image_url

            await _gallery_for(session, client, restaurant, payload.get("gallery") or [])

        await session.commit()

    return report


async def main(dry: bool) -> None:
    tenant = get_tenant(TENANT_ID)
    print(f"Импорт ресторанов сети {tenant.branding.display_name}")

    result = await plan_changes()
    for note in result.notes:
        print(note)
    print(f"Изменений: {len(result.changes)}, без изменений: {result.unchanged}")

    if dry:
        for change in result.changes:
            print(f"  {change.action:7} {change.title[:34]:36} {change.summary}")
        return

    report = await apply_changes(result.changes)
    print(report.summary())


if __name__ == "__main__":
    asyncio.run(main(dry="--dry" in sys.argv))
