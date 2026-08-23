"""Заводит зоны для районов, которых нет на карте сайта.

Условия доставки туда на сайте описаны словами, а контуров нет — из-за этого
приложение отвечало «сюда не доставляем» тем, кому сеть возит. Скрипт создаёт
черновые прямоугольники вокруг посёлков и вешает на них минимальные суммы из
условий сети. Точные границы менеджер поправит мышкой в админке.
"""

import asyncio
import math
import sys

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models.geo import DeliveryZone, Restaurant

TENANT_ID = "mamaroma"

# Полширины и полвысоты черновой рамки в градусах: примерно 4 на 4 километра
HALF_LON = 0.055
HALF_LAT = 0.030


class Draft:
    def __init__(
        self,
        name: str,
        latitude: float,
        longitude: float,
        min_order_kopecks: int,
        half_lon: float = HALF_LON,
        half_lat: float = HALF_LAT,
    ) -> None:
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.min_order_kopecks = min_order_kopecks
        self.half_lon = half_lon
        self.half_lat = half_lat

    def outline(self) -> list[list[float]]:
        """Контур хранится парами [долгота, широта] — как на карте сайта."""
        return [
            [self.longitude - self.half_lon, self.latitude - self.half_lat],
            [self.longitude - self.half_lon, self.latitude + self.half_lat],
            [self.longitude + self.half_lon, self.latitude + self.half_lat],
            [self.longitude + self.half_lon, self.latitude - self.half_lat],
        ]


# Минимальные суммы взяты из условий доставки на сайте сети
DRAFTS = [
    Draft("Петергоф и Стрельна", 59.870, 29.965, 3_000_00, half_lon=0.115, half_lat=0.035),
    Draft("Сестрорецк", 60.095, 29.960, 3_000_00, half_lon=0.075, half_lat=0.045),
    Draft("Горелово", 59.780, 30.170, 3_000_00),
    Draft("Пушкин и Шушары", 59.745, 30.420, 5_000_00, half_lon=0.085, half_lat=0.050),
    Draft("Мурино и Бугры", 60.062, 30.420, 2_000_00, half_lon=0.090, half_lat=0.040),
]


def _distance(restaurant: Restaurant, draft: Draft) -> float:
    """Расстояние по прямой в градусах — для выбора ближайшей точки хватает."""
    return math.hypot(restaurant.latitude - draft.latitude, restaurant.longitude - draft.longitude)


async def main(dry: bool) -> None:
    async with SessionLocal() as session:
        restaurants = list(
            await session.scalars(
                select(Restaurant).where(
                    Restaurant.tenant_id == TENANT_ID,
                    Restaurant.is_active.is_(True),
                    Restaurant.has_delivery.is_(True),
                )
            )
        )
        if not restaurants:
            print("нет ресторанов с доставкой — сначала импортируйте сеть")
            return

        existing = {
            name.lower()
            for name in await session.scalars(
                select(DeliveryZone.name).where(DeliveryZone.tenant_id == TENANT_ID)
            )
        }

        # Ставим черновики выше всех: районные условия должны побеждать
        # общегородские зоны, которые местами накрывают те же посёлки
        order = await session.scalar(
            select(DeliveryZone.sort_order)
            .where(DeliveryZone.tenant_id == TENANT_ID)
            .order_by(DeliveryZone.sort_order)
        )
        next_order = (order or 0) - len(DRAFTS)

        created = 0
        for draft in DRAFTS:
            if draft.name.lower() in existing:
                print(f"  уже есть: {draft.name}")
                continue

            nearest = min(restaurants, key=lambda row: _distance(row, draft))
            print(
                f"  {draft.name:22} → {nearest.address:32} "
                f"минимум {draft.min_order_kopecks // 100} ₽"
            )
            created += 1

            if dry:
                continue

            session.add(
                DeliveryZone(
                    tenant_id=TENANT_ID,
                    city_id=nearest.city_id,
                    restaurant_id=nearest.id,
                    name=draft.name,
                    # Цвет черновика: в админке видно, что зону ещё не уточняли
                    color="#7B8598",
                    outline=draft.outline(),
                    delivery_price_kopecks=0,
                    min_order_kopecks=draft.min_order_kopecks,
                    delivery_minutes=None,
                    sort_order=next_order,
                    is_active=True,
                )
            )
            next_order += 1

        if not dry:
            await session.commit()

        print(f"\nчерновых зон {'к созданию' if dry else 'создано'}: {created}")
        print("границы уточните в админке: вкладка «Зоны» → кнопка «Контур»")


if __name__ == "__main__":
    asyncio.run(main(dry="--dry" in sys.argv))
