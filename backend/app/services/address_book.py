import logging
import re

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.geo import GeoAddress
from app.services import geo

logger = logging.getLogger(__name__)

# Сколько своих совпадений считаем достаточными, чтобы не ходить наружу.
# Когда в запросе есть номер дома, выдача и должна быть короткой — хватит одного
ENOUGH_STREET = 3
ENOUGH_HOUSE = 1

# Типы улиц и домов: гость их не пишет, а в справочнике они есть.
# Длинные варианты идут первыми, иначе «пр» съест начало «пр-кт» и оставит «-кт»
TYPE_WORDS = (
    "улица", "ул", "проспект", "просп", "пр-кт", "пр", "переулок", "пер",
    "набережная", "наб", "бульвар", "б-р", "шоссе", "ш", "площадь", "пл",
    "аллея", "линия", "проезд", "тупик", "туп", "дом", "д", "корпус", "корп", "к",
    "строение", "стр", "литера", "лит", "город", "г", "посёлок", "поселок", "пос",
    "микрорайон", "мкр", "область", "обл", "район", "р-н", "метро",
)
NOISE = re.compile(
    r"\b(" + "|".join(sorted(TYPE_WORDS, key=len, reverse=True)) + r")\.?\b"
)
# «5к2» гость пишет слитно, а в справочнике это дом 5 и корпус 2
GLUED = re.compile(r"(?<=\d)(?=[а-яa-z])|(?<=[а-яa-z])(?=\d)")


def normalize(text: str) -> str:
    """«ул. Столичная, д 5к2» → «столичная 5 2»: ищем по сути, а не по типам."""
    lowered = text.lower().replace("ё", "е")
    split_glued = GLUED.sub(" ", lowered)
    cleaned = re.sub(r"[^a-zа-я0-9-]+", " ", split_glued)
    without_types = NOISE.sub(" ", cleaned)
    words = [word.strip("-") for word in without_types.split()]
    return " ".join(word for word in words if word)


def _search_text(item: geo.Suggestion) -> str:
    return normalize(" ".join(filter(None, (item.city, item.street, item.house, item.building))))


def to_suggestion(row: GeoAddress) -> geo.Suggestion:
    return geo.Suggestion(
        title=row.title,
        subtitle=row.subtitle,
        city=row.locality or "",
        street=row.street,
        house=row.house,
        building=row.building,
        latitude=row.latitude,
        longitude=row.longitude,
        fias_id=row.fias_id,
        postal_code=row.postal_code,
        city_district=row.city_district,
        metro=row.metro,
        geo_precision=row.geo_precision,
    )


async def find_local(
    session: AsyncSession, query: str, regions: list[str], limit: int
) -> list[GeoAddress]:
    words = normalize(query).split()
    if not words:
        return []

    statement = select(GeoAddress)
    if regions:
        statement = statement.where(GeoAddress.region_code.in_(regions))

    # Все слова запроса должны встретиться: «столичная 5» не выдаст «столичная 15»
    for word in words:
        statement = statement.where(
            or_(
                GeoAddress.search_text.like(f"{word}%"),
                GeoAddress.search_text.like(f"% {word}%"),
            )
        )

    rows = await session.scalars(
        statement.order_by(func.length(GeoAddress.search_text)).limit(limit)
    )
    return list(rows.all())


async def remember(
    session: AsyncSession, fallback_region: str, items: list[geo.Suggestion]
) -> None:
    """Кладём находку в свой справочник — второй раз за неё платить не придётся."""
    rows = [
        {
            "region_code": item.region_code or fallback_region,
            "locality": item.city or None,
            "street": item.street,
            "house": item.house,
            "building": item.building,
            "title": item.title[:260],
            "subtitle": item.subtitle[:260],
            "search_text": _search_text(item)[:400],
            "fias_id": item.fias_id,
            "postal_code": item.postal_code,
            "city_district": item.city_district,
            "metro": item.metro,
            "latitude": item.latitude,
            "longitude": item.longitude,
            "geo_precision": item.geo_precision,
        }
        for item in items
        if item.street and item.fias_id
    ]
    if not rows:
        return

    statement = insert(GeoAddress).values(rows)
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[GeoAddress.fias_id],
            set_={
                "metro": statement.excluded.metro,
                "postal_code": statement.excluded.postal_code,
                "latitude": statement.excluded.latitude,
                "longitude": statement.excluded.longitude,
            },
        )
    )
    await session.commit()


async def search(
    session: AsyncSession, query: str, regions: list[str], limit: int = 8
) -> list[geo.Suggestion]:
    """
    Сначала свой справочник, потом внешний сервис. Чем дольше живёт приложение,
    тем реже нужен внешний запрос: улицы у города не бесконечные.
    """
    words = normalize(query).split()
    enough = ENOUGH_HOUSE if any(word[0].isdigit() for word in words) else ENOUGH_STREET

    local = await find_local(session, query, regions, limit)
    if len(local) >= enough:
        return [to_suggestion(row) for row in local]

    found = await geo.suggest_addresses(query, regions, limit)
    if found and regions:
        await remember(session, regions[0], found)

    if found:
        return found

    return [to_suggestion(row) for row in local]
