"""Импорт меню с сайта сети: категории, блюда, описания, цены и фотографии.

Запуск: uv run python -m app.import_menu
Скрипт идемпотентный: повторный запуск обновляет цены и описания,
а фотографии заново не качает.
"""

import asyncio
import re
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import SessionLocal, engine
from app.models.menu import Dish, MenuCategory
from app.seed import CATEGORIES as DEMO_CATEGORIES
from app.services import media as media_service

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
TAG_RE = re.compile(r"<[^>]+>")
VOLUME_RE = re.compile(r"(\d+)\s*мл")
LITRE_RE = re.compile(r"([\d.,]+)\s*л\b")
WEIGHT_RE = re.compile(r"(\d+)\s*г\b")


@dataclass(slots=True)
class SiteDish:
    name: str
    description: str | None
    price_kopecks: int
    photo_id: str | None
    volume_ml: int | None = None
    weight_grams: int | None = None


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


def parse_dishes(html: str) -> list[SiteDish]:
    dishes: list[SiteDish] = []
    for match in ITEM_RE.finditer(html):
        name, volume_ml, weight_grams = clean_name(match.group("name"))
        if not name:
            continue

        description = (match.group("description") or "").strip()
        price = int(re.sub(r"\D", "", match.group("price")) or 0)
        photo = PHOTO_ID_RE.search(match.group("image") or "")

        dishes.append(
            SiteDish(
                name=name,
                description=description or None,
                price_kopecks=price * 100,
                photo_id=photo.group(1) if photo else None,
                volume_ml=volume_ml,
                weight_grams=weight_grams,
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
                return media_service.save_image(response.content, "image/jpeg", "dishes")
            except media_service.MediaError:
                return None
    return None


async def drop_demo_dishes(session: AsyncSession) -> int:
    demo_names = {name for _, _, rows in DEMO_CATEGORIES for name, *_ in rows}
    rows = await session.scalars(
        select(Dish).where(Dish.tenant_id == TENANT_ID, Dish.name.in_(demo_names))
    )
    removed = 0
    for dish in rows.all():
        media_service.delete_image(dish.image_url)
        await session.delete(dish)
        removed += 1
    await session.commit()
    return removed


async def run() -> None:
    headers = {"User-Agent": USER_AGENT}
    created = updated = photos = 0

    async with (
        httpx.AsyncClient(headers=headers, timeout=40, follow_redirects=True) as client,
        SessionLocal() as session,
    ):
        removed = await drop_demo_dishes(session)
        print(f"Демо-блюда убраны: {removed}")

        catalog = (await client.get(CATALOG)).text
        categories = parse_categories(catalog)
        print(f"Разделов на сайте: {len(categories)}\n")

        for order, (href, slug, title) in enumerate(categories):
            html = catalog if href == "/dostavka/" else (await client.get(f"{SITE}{href}")).text
            await asyncio.sleep(PAGE_DELAY)

            dishes = parse_dishes(html)
            if not dishes:
                print(f"  {title}: блюд не найдено, пропускаем")
                continue

            category = await session.scalar(
                select(MenuCategory).where(
                    MenuCategory.tenant_id == TENANT_ID, MenuCategory.slug == slug
                )
            )
            if category is None:
                category = MenuCategory(
                    tenant_id=TENANT_ID, name=title, slug=slug, sort_order=order
                )
                session.add(category)
                await session.flush()
            else:
                category.name = title
                category.sort_order = order

            for position, item in enumerate(dishes):
                dish = await session.scalar(
                    select(Dish).where(Dish.tenant_id == TENANT_ID, Dish.name == item.name)
                )
                if dish is None:
                    dish = Dish(tenant_id=TENANT_ID, name=item.name, price_kopecks=0)
                    session.add(dish)
                    created += 1
                else:
                    updated += 1

                dish.category_id = category.id
                dish.description = item.description
                dish.price_kopecks = item.price_kopecks
                dish.sort_order = position
                if item.volume_ml is not None:
                    dish.volume_ml = item.volume_ml
                if item.weight_grams is not None:
                    dish.weight_grams = item.weight_grams
                dish.is_active = item.price_kopecks > 0

                if dish.image_url is None and item.photo_id is not None:
                    url = await download_photo(client, item.photo_id)
                    await asyncio.sleep(IMAGE_DELAY)
                    if url is not None:
                        dish.image_url = url
                        photos += 1

            await session.commit()
            print(f"  {title:16} блюд: {len(dishes)}")

    await engine.dispose()
    print(f"\nГотово. Новых блюд: {created}, обновлено: {updated}, загружено фото: {photos}")


if __name__ == "__main__":
    asyncio.run(run())
