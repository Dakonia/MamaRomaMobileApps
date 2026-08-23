"""
Импорт зон доставки с карты сайта mamaroma.ru/dostavka/store/map.

Зоны лежат прямо в разметке страницы: обычный GeoJSON в скрытом блоке.
В описании каждой зоны — адрес ресторана и его номер в системе доставки,
по адресу и связываем зону с нашим рестораном.

Запуск: uv run python -m app.import_zones [--dry]
"""

import asyncio
import json
import re
import sys
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.models.geo import City, DeliveryZone, Restaurant

MAP_URL = "https://www.mamaroma.ru/dostavka/store/map"
TENANT_ID = "mamaroma"
CITY_NAME = "Санкт-Петербург"

# На сайте одна минимальная сумма на весь город
DEFAULT_MIN_ORDER_KOPECKS = 1_200_00

ZONA_BLOCK = re.compile(r'id=["\']zona["\'][^>]*>(.*?)</', re.S)

# На карте адреса записаны вольно и с опечатками — эти сопоставляем вручную
ALIASES = {
    "наб.р.Фонтанки, 34": "Наб. реки Фонтанки, 34",
    "Адмиралтеская 10": "Адмиралтейский пр, 10",
    "Большевиков,9 (Кудрово)": "пр. Большевиков, 9, к. 1",
    # Ресторана на Чернышевского в списке сети нет: зону обслуживает ближайший
    "Чернышевского, 6": "Захарьевская ул., 16",
}


@dataclass(slots=True)
class SiteZone:
    name: str
    store_code: str
    color: str
    outline: list[list[float]]


def _normalize(address: str) -> str:
    """
    «Большой пр., П.С., 70-72» и «Большой пр. П.С., 70-72» — один адрес.
    Сравниваем только буквы и цифры в нижнем регистре.
    """
    text = address.lower().replace("ё", "е")
    text = re.sub(
        r"\bул\.?|улица|пр-?кт|проспект|пр\.?|наб\.?|набережная|реки|\bр\.|к\.?\s*(\d)",
        r"\1",
        text,
    )
    return re.sub(r"[^a-zа-я0-9]", "", text)


def _outline(geometry: dict[str, object]) -> list[list[float]]:
    """GeoJSON-полигон → плоский контур. Дырки внутри зон сеть не использует."""
    coordinates = geometry.get("coordinates")
    if geometry.get("type") == "Polygon" and isinstance(coordinates, list):
        ring = coordinates[0]
    elif geometry.get("type") == "MultiPolygon" and isinstance(coordinates, list):
        ring = coordinates[0][0]
    else:
        return []

    return [[float(point[0]), float(point[1])] for point in ring if len(point) >= 2]


async def fetch_zones() -> list[SiteZone]:
    async with httpx.AsyncClient(
        timeout=30, headers={"User-Agent": "Mozilla/5.0"}, follow_redirects=True
    ) as client:
        page = (await client.get(MAP_URL)).text

    block = ZONA_BLOCK.search(page)
    if block is None:
        raise RuntimeError("На странице карты не нашёлся блок с зонами")

    data = json.loads(block.group(1).strip())
    zones: list[SiteZone] = []

    for feature in data.get("features", []):
        properties = feature.get("properties") or {}
        description = str(properties.get("description") or "").strip()
        if not description:
            continue

        address, _, code = description.rpartition("|")
        outline = _outline(feature.get("geometry") or {})
        if len(outline) < 3:
            continue

        zones.append(
            SiteZone(
                name=address.strip() or description,
                store_code=code.strip(),
                color=str(properties.get("fill") or "#C0392B"),
                outline=outline,
            )
        )

    return zones


async def _match(session: AsyncSession, city: City, zone: SiteZone) -> Restaurant | None:
    rows = await session.scalars(
        select(Restaurant).where(Restaurant.tenant_id == TENANT_ID, Restaurant.city_id == city.id)
    )
    wanted = _normalize(ALIASES.get(zone.name, zone.name))

    best: Restaurant | None = None
    for restaurant in rows:
        current = _normalize(restaurant.address)
        if current == wanted:
            return restaurant
        # «Большой пр., П.С., 70» против «Большой пр. П.С., 70-72» — считаем совпадением
        if best is None and (current.startswith(wanted) or wanted.startswith(current)):
            best = restaurant

    return best


async def main(dry: bool) -> None:
    zones = await fetch_zones()
    print(f"На карте сайта зон: {len(zones)}")

    async with SessionLocal() as session:
        city = await session.scalar(
            select(City).where(City.tenant_id == TENANT_ID, City.name == CITY_NAME)
        )
        if city is None:
            raise RuntimeError(f"Город {CITY_NAME} не найден — сначала импортируйте рестораны")

        created = 0
        updated = 0
        lost: list[str] = []

        for order, zone in enumerate(zones):
            restaurant = await _match(session, city, zone)
            if restaurant is None:
                lost.append(f"{zone.name} (код {zone.store_code})")
                continue

            if dry:
                print(f"  {zone.name:34} → {restaurant.address:34} точек {len(zone.outline)}")
                continue

            external_id = f"map-{zone.store_code}-{order}"
            existing = await session.scalar(
                select(DeliveryZone).where(
                    DeliveryZone.tenant_id == TENANT_ID, DeliveryZone.external_id == external_id
                )
            )

            if existing is None:
                session.add(
                    DeliveryZone(
                        tenant_id=TENANT_ID,
                        external_id=external_id,
                        city_id=city.id,
                        restaurant_id=restaurant.id,
                        name=zone.name,
                        outline=zone.outline,
                        color=zone.color,
                        min_order_kopecks=DEFAULT_MIN_ORDER_KOPECKS,
                        sort_order=order,
                    )
                )
                created += 1
            else:
                existing.restaurant_id = restaurant.id
                existing.name = zone.name
                existing.outline = zone.outline
                existing.color = zone.color
                existing.sort_order = order
                updated += 1

        if not dry:
            await session.commit()
            print(f"Создано зон: {created}, обновлено: {updated}")

        if lost:
            print("Не нашли ресторан для зон:")
            for name in lost:
                print("  ", name)


if __name__ == "__main__":
    asyncio.run(main(dry="--dry" in sys.argv))
