"""Импорт событий и акций с сайта сети.

Запуск: uv run python -m app.import_promos
Список берём из открытого API сайта, описание — из мета-тега страницы события,
фотографию — в полном размере, а не превью.
"""

import asyncio
import html
import re
from dataclasses import dataclass
from datetime import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import SessionLocal, engine
from app.models.promotion import Promotion
from app.services import media as media_service

SITE = "https://www.mamaroma.ru"
EVENTS_API = f"{SITE}/api/events"
USER_AGENT = "MamaRomaApp/0.1 (own events import)"

REQUEST_DELAY = 0.3
TENANT_ID = settings.default_tenant_id

# Заглушки, которые мы завели сами при первом запуске
DEMO_TITLES = ("Паста дня — 490 ₽", "Тирамису в подарок")

DESCRIPTION_RE = re.compile(r'<meta name="description" content="([^"]*)"', re.I)
TAG_RE = re.compile(r"<[^>]+>")


@dataclass(slots=True)
class SiteEvent:
    title: str
    description: str | None
    photo_path: str | None
    starts_at: datetime | None
    venue: str | None


def clean_text(raw: str) -> str:
    text = html.unescape(raw)
    text = TAG_RE.sub(" ", text).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def full_size(photo: str) -> str:
    """Превью лежит в /conversions/ с суффиксом -thumb, оригинал — рядом."""
    return re.sub(r"/conversions/(.+)-thumb(\.\w+)$", r"/\1\2", photo)


def parse_events(payload: dict[str, object]) -> list[SiteEvent]:
    rows = payload.get("data")
    if not isinstance(rows, list):
        return []

    events: list[SiteEvent] = []
    for row in rows:
        if not isinstance(row, dict):
            continue

        title = clean_text(str(row.get("title") or ""))
        if not title:
            continue

        starts_at: datetime | None = None
        start = row.get("start_at")
        if isinstance(start, dict) and isinstance(start.get("date"), str):
            try:
                starts_at = datetime.fromisoformat(start["date"])
            except ValueError:
                starts_at = None

        photo = row.get("photo")
        venue = row.get("restaurants_title")

        events.append(
            SiteEvent(
                title=title,
                description=None,
                photo_path=str(photo) if isinstance(photo, str) else None,
                starts_at=starts_at,
                venue=clean_text(str(venue)) if isinstance(venue, str) else None,
            )
        )
    return events


async def fetch_description(client: httpx.AsyncClient, href: str) -> str | None:
    try:
        response = await client.get(href)
    except httpx.HTTPError:
        return None

    if response.status_code != 200:
        return None

    found = DESCRIPTION_RE.search(response.text)
    return clean_text(found.group(1)) if found else None


async def download_photo(client: httpx.AsyncClient, path: str) -> str | None:
    for candidate in (full_size(path), path):
        try:
            response = await client.get(f"{SITE}{candidate}")
        except httpx.HTTPError:
            continue

        if response.status_code == 200 and len(response.content) > 1024:
            try:
                return media_service.save_image(response.content, "image/jpeg", "promos")
            except media_service.MediaError:
                return None
    return None


async def drop_demo(session: AsyncSession) -> int:
    rows = await session.scalars(
        select(Promotion).where(Promotion.tenant_id == TENANT_ID, Promotion.title.in_(DEMO_TITLES))
    )
    removed = 0
    for promotion in rows.all():
        media_service.delete_image(promotion.image_url)
        await session.delete(promotion)
        removed += 1
    await session.commit()
    return removed


async def run() -> None:
    created = updated = photos = 0

    async with (
        httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT}, timeout=40, follow_redirects=True
        ) as client,
        SessionLocal() as session,
    ):
        removed = await drop_demo(session)
        print(f"Заглушки убраны: {removed}")

        payload = (await client.get(EVENTS_API)).json()
        events = parse_events(payload)
        print(f"Событий на сайте: {len(events)}\n")

        raw_rows = payload.get("data") if isinstance(payload, dict) else None
        hrefs = [
            str(row.get("href")) if isinstance(row, dict) and row.get("href") else None
            for row in (raw_rows if isinstance(raw_rows, list) else [])
        ]

        for order, event in enumerate(events):
            href = hrefs[order] if order < len(hrefs) else None
            if href:
                event.description = await fetch_description(client, href)
                await asyncio.sleep(REQUEST_DELAY)

            promotion = await session.scalar(
                select(Promotion).where(
                    Promotion.tenant_id == TENANT_ID, Promotion.title == event.title
                )
            )
            if promotion is None:
                promotion = Promotion(tenant_id=TENANT_ID, title=event.title)
                session.add(promotion)
                created += 1
            else:
                updated += 1

            # Адрес заведения дописываем к тексту: у нас свои рестораны,
            # сопоставить их с сайтом пока нечем
            parts = [event.description or "", f"Где: {event.venue}" if event.venue else ""]
            promotion.description = "\n\n".join(part for part in parts if part) or None
            promotion.starts_at = event.starts_at
            promotion.sort_order = order
            promotion.is_active = True

            if promotion.image_url is None and event.photo_path:
                url = await download_photo(client, event.photo_path)
                await asyncio.sleep(REQUEST_DELAY)
                if url is not None:
                    promotion.image_url = url
                    photos += 1

            print(f"  {event.title[:44]}")

        await session.commit()

    await engine.dispose()
    print(f"\nГотово. Новых: {created}, обновлено: {updated}, фотографий: {photos}")


if __name__ == "__main__":
    asyncio.run(run())
