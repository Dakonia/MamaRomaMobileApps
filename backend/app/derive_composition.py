"""Перенос описаний-перечислений в поле состава.

Запуск: uv run python -m app.derive_composition [--dry]
На сайте поля состава нет, но у части блюд описание — это и есть список
ингредиентов через запятую. Такие описания переезжают в состав, обычный
текст остаётся описанием.
"""

import asyncio
import re
import sys

from sqlalchemy import select

from app.core.config import settings
from app.core.db import SessionLocal, engine
from app.models.menu import Dish

TENANT_ID = settings.default_tenant_id

MIN_PARTS = 2
MAX_WORDS_PER_PART = 5
MAX_LENGTH = 200

# Описание, начинающееся с предлога, — это уточнение к блюду, а не состав
PREPOSITION_RE = re.compile(r"^(с|со|в|во|из|под|на|для)\s", re.I)

# «Пармезаном, моцареллой и зеленью» — продолжение фразы в творительном падеже,
# а не перечень. Ловим по окончанию первого слова
INSTRUMENTAL_RE = re.compile(r"\w+(ом|ем|ой|ей|ами|ями)$", re.I)


def looks_like_composition(text: str) -> bool:
    value = text.strip()
    if len(value) > MAX_LENGTH or value.endswith("."):
        return False
    if PREPOSITION_RE.match(value):
        return False

    parts = [part.strip() for part in value.split(",")]
    if len(parts) < MIN_PARTS:
        return False

    if INSTRUMENTAL_RE.match(parts[0]):
        return False

    return all(part and len(part.split()) <= MAX_WORDS_PER_PART for part in parts)


def normalise(text: str) -> str:
    parts = [part.strip(" .;") for part in text.split(",")]
    parts = [part for part in parts if part]
    return ", ".join(part[0].upper() + part[1:] if part else part for part in parts)


async def run(dry: bool) -> None:
    moved = kept = 0
    samples: list[str] = []

    async with SessionLocal() as session:
        dishes = (
            await session.scalars(
                select(Dish).where(
                    Dish.tenant_id == TENANT_ID,
                    Dish.description.is_not(None),
                    Dish.composition.is_(None),
                )
            )
        ).all()

        for dish in dishes:
            description = dish.description or ""
            if not looks_like_composition(description):
                kept += 1
                continue

            if len(samples) < 6:
                samples.append(f"{dish.name[:28]:30} → {normalise(description)[:60]}")

            if not dry:
                dish.composition = normalise(description)
                # Иначе один и тот же текст показывался бы дважды
                dish.description = None
            moved += 1

        if not dry:
            await session.commit()

    await engine.dispose()

    print("\n".join(samples))
    print(f"\n{'Нашлось' if dry else 'Перенесено'} в состав: {moved}, осталось описанием: {kept}")


if __name__ == "__main__":
    asyncio.run(run(dry="--dry" in sys.argv))
