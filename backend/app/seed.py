"""Демо-данные для разработки: город, три ресторана и меню.

Запуск: uv run python -m app.seed
Скрипт идемпотентный — повторный запуск ничего не дублирует.
"""

import asyncio
from datetime import time

from sqlalchemy import select

from app.core.config import settings
from app.core.db import SessionLocal, engine
from app.core.security import hash_password
from app.models.geo import City, Restaurant
from app.models.menu import Dish, DishPrice, MenuCategory, StopListEntry
from app.models.promotion import Promotion
from app.models.staff import StaffUser

TENANT_ID = settings.default_tenant_id
ADMIN_EMAIL = "admin@mamaroma.ru"
ADMIN_PASSWORD = "mamaroma"

CATEGORIES: list[tuple[str, str, list[tuple[str, str, int, int | None]]]] = [
    (
        "Пицца",
        "pizza",
        [
            ("Маргарита", "Томаты, моцарелла, базилик", 69000, 480),
            ("Пепперони", "Острая пепперони, моцарелла, томатный соус", 79000, 510),
            ("Четыре сыра", "Моцарелла, горгонзола, пармезан, скаморца", 89000, 490),
            ("Прошутто э фунги", "Ветчина, шампиньоны, моцарелла", 85000, 530),
        ],
    ),
    (
        "Паста",
        "pasta",
        [
            ("Карбонара", "Спагетти, гуанчале, пармезан, желток", 69000, 380),
            ("Болоньезе", "Тальятелле, говяжий рагу, пармезан", 65000, 400),
            ("Пенне арабьята", "Острый томатный соус, чеснок, перец чили", 59000, 360),
            ("Феттучини с курицей", "Сливочный соус, шампиньоны, курица", 69000, 420),
        ],
    ),
    (
        "Салаты",
        "salads",
        [
            ("Цезарь с курицей", "Романо, пармезан, гренки, соус цезарь", 59000, 280),
            ("Капрезе", "Томаты бычье сердце, моцарелла ди буфала, песто", 55000, 260),
            ("Греческий", "Овощи, фета, оливки, орегано", 49000, 300),
        ],
    ),
    (
        "Супы",
        "soups",
        [
            ("Минестроне", "Овощной суп с пастой и песто", 39000, 350),
            ("Крем-суп из томатов", "Томаты, сливки, базилик, гренки", 39000, 330),
        ],
    ),
    (
        "Десерты",
        "desserts",
        [
            ("Тирамису", "Маскарпоне, савоярди, эспрессо", 39000, 180),
            ("Панна котта", "Сливочный десерт с ягодным соусом", 35000, 160),
        ],
    ),
    (
        "Напитки",
        "drinks",
        [
            ("Лимонад домашний", "Лимон, мята, лёд", 29000, None),
            ("Капучино", "Двойной эспрессо, молочная пена", 22000, None),
            ("Эспрессо", "Обжарка недели", 15000, None),
        ],
    ),
]

RESTAURANTS: list[tuple[str, str, str, float, float, str]] = [
    (
        "Мама Рома на Невском",
        "Невский пр., 30",
        "Невский проспект",
        59.9355,
        30.3255,
        "+78127777701",
    ),
    (
        "Мама Рома на Петроградской",
        "Большой пр. П.С., 88",
        "Петроградская",
        59.9662,
        30.3113,
        "+78127777702",
    ),
    ("Мама Рома в Пулково", "Пулковское ш., 41", "Московская", 59.8003, 30.2625, "+78127777703"),
]


async def seed() -> None:
    async with SessionLocal() as session:
        city = await session.scalar(
            select(City).where(City.tenant_id == TENANT_ID, City.slug == "spb")
        )
        if city is None:
            city = City(tenant_id=TENANT_ID, name="Санкт-Петербург", slug="spb", sort_order=1)
            session.add(city)
            await session.flush()

        restaurants: list[Restaurant] = []
        for name, address, metro, lat, lon, phone in RESTAURANTS:
            restaurant = await session.scalar(
                select(Restaurant).where(Restaurant.tenant_id == TENANT_ID, Restaurant.name == name)
            )
            if restaurant is None:
                restaurant = Restaurant(
                    tenant_id=TENANT_ID,
                    city_id=city.id,
                    name=name,
                    address=address,
                    metro=metro,
                    phone=phone,
                    latitude=lat,
                    longitude=lon,
                    opens_at=time(11, 0),
                    closes_at=time(23, 0),
                    delivery_price_kopecks=19000,
                    delivery_min_order_kopecks=80000,
                    free_delivery_from_kopecks=250000,
                )
                session.add(restaurant)
                await session.flush()
            restaurants.append(restaurant)

        dishes_by_name: dict[str, Dish] = {}
        for order, (category_name, slug, dish_rows) in enumerate(CATEGORIES):
            category = await session.scalar(
                select(MenuCategory).where(
                    MenuCategory.tenant_id == TENANT_ID, MenuCategory.slug == slug
                )
            )
            if category is None:
                category = MenuCategory(
                    tenant_id=TENANT_ID, name=category_name, slug=slug, sort_order=order
                )
                session.add(category)
                await session.flush()

            for dish_order, (name, description, price, weight) in enumerate(dish_rows):
                dish = await session.scalar(
                    select(Dish).where(Dish.tenant_id == TENANT_ID, Dish.name == name)
                )
                if dish is None:
                    dish = Dish(
                        tenant_id=TENANT_ID,
                        category_id=category.id,
                        name=name,
                        description=description,
                        price_kopecks=price,
                        weight_grams=weight,
                        sort_order=dish_order,
                    )
                    session.add(dish)
                    await session.flush()
                dishes_by_name[name] = dish

        # В аэропорту цены выше — проверяем переопределение цены по ресторану
        airport = restaurants[-1]
        for name in ("Маргарита", "Карбонара", "Капучино"):
            dish = dishes_by_name[name]
            existing = await session.scalar(
                select(DishPrice).where(
                    DishPrice.tenant_id == TENANT_ID,
                    DishPrice.restaurant_id == airport.id,
                    DishPrice.dish_id == dish.id,
                )
            )
            if existing is None:
                session.add(
                    DishPrice(
                        tenant_id=TENANT_ID,
                        restaurant_id=airport.id,
                        dish_id=dish.id,
                        price_kopecks=int(dish.price_kopecks * 1.3),
                    )
                )

        # И один стоп-лист, чтобы было видно, как блюдо гаснет
        panna = dishes_by_name["Панна котта"]
        stopped = await session.scalar(
            select(StopListEntry).where(
                StopListEntry.tenant_id == TENANT_ID,
                StopListEntry.restaurant_id == airport.id,
                StopListEntry.dish_id == panna.id,
            )
        )
        if stopped is None:
            session.add(
                StopListEntry(
                    tenant_id=TENANT_ID,
                    restaurant_id=airport.id,
                    dish_id=panna.id,
                    comment="Закончились сливки",
                )
            )

        promos = [
            (
                "Паста дня — 490 ₽",
                "Каждый будний день с 12:00 до 16:00 одна паста из меню по специальной цене.",
                "−30%",
            ),
            (
                "Тирамису в подарок",
                "При заказе от 2500 ₽ добавим фирменный тирамису бесплатно.",
                "Подарок",
            ),
        ]
        for order_index, (title, description, label) in enumerate(promos):
            exists = await session.scalar(
                select(Promotion).where(
                    Promotion.tenant_id == TENANT_ID, Promotion.title == title
                )
            )
            if exists is None:
                session.add(
                    Promotion(
                        tenant_id=TENANT_ID,
                        title=title,
                        description=description,
                        label=label,
                        sort_order=order_index,
                    )
                )

        staff = await session.scalar(
            select(StaffUser).where(
                StaffUser.tenant_id == TENANT_ID, StaffUser.email == ADMIN_EMAIL
            )
        )
        if staff is None:
            session.add(
                StaffUser(
                    tenant_id=TENANT_ID,
                    email=ADMIN_EMAIL,
                    password_hash=hash_password(ADMIN_PASSWORD),
                    name="Администратор",
                    role="owner",
                )
            )

        await session.commit()

    await engine.dispose()

    total = sum(len(rows) for _, _, rows in CATEGORIES)
    print(
        f"Готово: 1 город, {len(RESTAURANTS)} ресторана, {len(CATEGORIES)} категорий, {total} блюд"
    )


if __name__ == "__main__":
    asyncio.run(seed())
