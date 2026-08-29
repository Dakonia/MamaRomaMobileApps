from dataclasses import dataclass
from uuid import UUID

from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenants import Tenant
from app.models.geo import DeliveryZone, Restaurant


@dataclass(slots=True)
class ZoneMatch:
    zone: DeliveryZone
    restaurant: Restaurant


def contains(outline: list[list[float]], longitude: float, latitude: float) -> bool:
    """
    Точка внутри многоугольника — метод луча: считаем, сколько раз горизонтальный
    луч из точки пересекает стороны. Нечётное число — точка внутри.
    Контур хранится как в GeoJSON: пары [долгота, широта].
    """
    inside = False
    count = len(outline)

    for index in range(count):
        x1, y1 = outline[index]
        x2, y2 = outline[(index + 1) % count]

        if (y1 > latitude) != (y2 > latitude):
            crossing = x1 + (latitude - y1) * (x2 - x1) / (y2 - y1)
            if crossing > longitude:
                inside = not inside

    return inside


# Насколько упрощаем общий контур: около двадцати метров. На карте разницы не
# видно, а точек становится втрое меньше
SIMPLIFY = 0.0002


def coverage(outlines: list[list[list[float]]]) -> list[list[list[float]]]:
    """Общая граница доставки: все зоны, слитые в один силуэт.

    Зоны накладываются друг на друга, и по отдельности их контуры на карте
    превращаются в паутину. Гостю сперва нужен один вопрос — возите ли сюда
    вообще, — поэтому показываем внешнюю границу, а разбивку по зонам уже под
    меткой.
    """
    shapes = [Polygon(outline) for outline in outlines if len(outline) >= 3]
    if not shapes:
        return []

    # buffer(0) чинит контуры, которые сами себя пересекают: такие в базе
    # попадаются после ручного рисования, и объединение на них падает
    merged = unary_union([shape.buffer(0) for shape in shapes]).simplify(SIMPLIFY)

    parts = merged.geoms if isinstance(merged, MultiPolygon) else [merged]

    return [
        [[round(x, 6), round(y, 6)] for x, y in part.exterior.coords]
        for part in parts
        if not part.is_empty
    ]


async def resolve(
    session: AsyncSession,
    tenant: Tenant,
    latitude: float,
    longitude: float,
    city_id: UUID | None = None,
) -> ZoneMatch | None:
    """
    Какой ресторан везёт на эту точку. Зоны накладываются друг на друга —
    например, ближняя зона лежит внутри дальней, — поэтому берём первую по
    sort_order: у ближней он меньше. Рестораны на паузе и отключённые пропускаем.
    """
    query = (
        select(DeliveryZone, Restaurant)
        .join(Restaurant, Restaurant.id == DeliveryZone.restaurant_id)
        .where(
            DeliveryZone.tenant_id == tenant.id,
            DeliveryZone.is_active.is_(True),
            Restaurant.is_active.is_(True),
            Restaurant.has_delivery.is_(True),
        )
        .order_by(DeliveryZone.sort_order)
    )
    if city_id is not None:
        query = query.where(DeliveryZone.city_id == city_id)

    rows = (await session.execute(query)).all()

    paused: ZoneMatch | None = None
    for zone, restaurant in rows:
        if not contains(zone.outline, longitude, latitude):
            continue

        # Ресторан на паузе — держим про запас: если других зон нет, гость
        # хотя бы увидит, кто его обслуживает и почему сейчас нельзя
        if restaurant.is_paused:
            paused = paused or ZoneMatch(zone=zone, restaurant=restaurant)
            continue

        return ZoneMatch(zone=zone, restaurant=restaurant)

    return paused
