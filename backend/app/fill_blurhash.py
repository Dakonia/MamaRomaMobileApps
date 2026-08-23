"""Считает размытые отпечатки для уже загруженных картинок.

Новые снимки получают отпечаток при сохранении, а этому скрипту достаются те,
что легли в базу раньше. Повторный запуск считает только недостающие.
"""

import asyncio
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.models.geo import Restaurant
from app.models.menu import Dish, MenuCategory
from app.models.promotion import Promotion
from app.services import media as media_service


async def _dishes(session: AsyncSession) -> list[Dish]:
    return list(
        await session.scalars(
            select(Dish).where(Dish.image_url.is_not(None), Dish.image_blurhash.is_(None))
        )
    )


async def _categories(session: AsyncSession) -> list[MenuCategory]:
    return list(
        await session.scalars(
            select(MenuCategory).where(
                MenuCategory.image_url.is_not(None), MenuCategory.image_blurhash.is_(None)
            )
        )
    )


async def _promotions(session: AsyncSession) -> list[Promotion]:
    return list(
        await session.scalars(
            select(Promotion).where(
                Promotion.image_url.is_not(None), Promotion.image_blurhash.is_(None)
            )
        )
    )


async def _restaurants(session: AsyncSession) -> list[Restaurant]:
    return list(
        await session.scalars(
            select(Restaurant).where(
                Restaurant.image_url.is_not(None), Restaurant.image_blurhash.is_(None)
            )
        )
    )


async def main(dry: bool) -> None:
    async with SessionLocal() as session:
        groups = (
            ("блюда", await _dishes(session)),
            ("категории", await _categories(session)),
            ("акции", await _promotions(session)),
            ("рестораны", await _restaurants(session)),
        )

        for label, rows in groups:
            filled = 0

            for row in rows:
                found = media_service.blurhash_for(row.image_url)
                if found is None:
                    continue

                filled += 1
                if not dry:
                    row.image_blurhash = found

            print(f"  {label:12} без отпечатка {len(rows):4} → посчитано {filled}")

        if not dry:
            await session.commit()

    print("\nпроверка, ничего не записано" if dry else "\nготово")


if __name__ == "__main__":
    asyncio.run(main(dry="--dry" in sys.argv))
