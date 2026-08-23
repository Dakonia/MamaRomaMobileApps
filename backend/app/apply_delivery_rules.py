"""
Условия доставки со страницы mamaroma.ru/dostavka.

Условия там записаны текстом для людей, а не данными: «с 11:00 до 22:30»,
«с понедельника по четверг от 1400 руб.». Разобрать это надёжно нельзя —
текст меняют руками и формулировки каждый раз новые. Поэтому правила лежат
здесь явными таблицами: их видно, легко проверить и легко поправить,
когда сеть изменит условия.

Дальше эти же значения правятся в админке — скрипт нужен только для первого
наполнения и для сверки с сайтом.

Запуск: uv run python -m app.apply_delivery_rules
"""

import asyncio
import re
from datetime import time

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models.geo import DeliveryZone, Restaurant

TENANT_ID = "mamaroma"

# Режим работы службы доставки. Ключ — часть адреса ресторана
DELIVERY_HOURS: dict[str, tuple[time, time]] = {
    "энгельса пр., 124": (time(10, 0), time(23, 0)),
    "энгельса пр., 43": (time(10, 0), time(22, 30)),
}
DEFAULT_DELIVERY_HOURS = (time(11, 0), time(22, 30))

# Минимальная сумма заказа: (будни, выходные и праздники). Пусто во втором
# значении — минимум одинаковый всю неделю
MIN_ORDER: dict[str, tuple[int, int | None]] = {
    "пр. просвещения 69": (1_500_00, None),
    "новочеркасский пр., 35": (1_400_00, 2_000_00),
    "пр. ветеранов, 142": (990_00, 1_200_00),
    "средний пр. в.о., 6": (990_00, 1_200_00),
}
DEFAULT_MIN_ORDER = 1_200_00

# Отдельные минимумы по районам — привязаны к названию зоны на карте
ZONE_MIN_ORDER: dict[str, int] = {
    "кудрово": 2_000_00,
}

# Условия, для которых на карте сайта нет контуров: показываем их менеджеру,
# чтобы он завёл зоны руками, а не молчим
UNCOVERED = [
    "Петергоф, Стрельна, Сестрорецк — от 3000 ₽",
    "Горелово — от 3000 ₽",
    "Пушкин и Шушары — от 5000 ₽",
    "Мурино и Бугры — от 2000 ₽, доставка платная",
    "Средний пр. В.О., 6 за пределы ЗСД — от 1800 ₽",
    "ул. Н. Рубцова, 5 — бесплатно в пределах 1,5 км от ресторана",
]


def _key(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


async def main() -> None:
    async with SessionLocal() as session:
        restaurants = list(
            await session.scalars(select(Restaurant).where(Restaurant.tenant_id == TENANT_ID))
        )
        zones = list(
            await session.scalars(select(DeliveryZone).where(DeliveryZone.tenant_id == TENANT_ID))
        )

        by_restaurant = {restaurant.id: restaurant for restaurant in restaurants}
        hours_set = 0
        minimum_set = 0

        for restaurant in restaurants:
            key = _key(restaurant.address)
            opens, closes = DELIVERY_HOURS.get(key, DEFAULT_DELIVERY_HOURS)
            restaurant.delivery_opens_at = opens
            restaurant.delivery_closes_at = closes
            hours_set += 1

        for zone in zones:
            owner = by_restaurant.get(zone.restaurant_id)
            if owner is None:
                continue

            weekday, weekend = MIN_ORDER.get(_key(owner.address), (DEFAULT_MIN_ORDER, None))

            # Название зоны важнее адреса ресторана: у зоны «Кудрово» свой минимум,
            # хотя везёт туда обычный ресторан на Большевиков
            for marker, amount in ZONE_MIN_ORDER.items():
                if marker in _key(zone.name):
                    weekday, weekend = amount, None

            zone.min_order_kopecks = weekday
            zone.min_order_weekend_kopecks = weekend
            minimum_set += 1

        await session.commit()

    print(f"Часы доставки проставлены: {hours_set} ресторанов")
    print(f"Минимальные суммы проставлены: {minimum_set} зон")
    print("\nУсловия без контуров на карте — заведите зоны в админке вручную:")
    for line in UNCOVERED:
        print("  ", line)


if __name__ == "__main__":
    asyncio.run(main())
