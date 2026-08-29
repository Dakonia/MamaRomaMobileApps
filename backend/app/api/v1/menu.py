from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import SessionDep, TenantDep
from app.models.geo import City, DeliveryZone, Restaurant
from app.schemas.menu import (
    CityRead,
    DeliveryResolve,
    DeliveryZoneRead,
    DishRead,
    MenuRead,
    RestaurantRead,
)
from app.services import delivery as delivery_service
from app.services import menu as menu_service

router = APIRouter(tags=["Меню"])


@router.get("/cities", summary="Города присутствия сети")
async def list_cities(session: SessionDep, tenant: TenantDep) -> list[CityRead]:
    cities = await session.scalars(
        select(City)
        .where(City.tenant_id == tenant.id, City.is_active.is_(True))
        .order_by(City.sort_order, City.name)
    )
    return [CityRead.model_validate(city) for city in cities]


@router.get("/restaurants", summary="Рестораны, при желании одного города")
async def list_restaurants(
    session: SessionDep,
    tenant: TenantDep,
    city_id: Annotated[UUID | None, Query()] = None,
) -> list[RestaurantRead]:
    query = select(Restaurant).where(
        Restaurant.tenant_id == tenant.id, Restaurant.is_active.is_(True)
    )
    if city_id is not None:
        query = query.where(Restaurant.city_id == city_id)

    restaurants = await session.scalars(query.order_by(Restaurant.name))
    return [RestaurantRead.model_validate(restaurant) for restaurant in restaurants]


@router.get("/menu/popular", summary="Хиты продаж")
async def popular(
    session: SessionDep,
    tenant: TenantDep,
    restaurant_id: Annotated[UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
) -> list[DishRead]:
    return await menu_service.get_popular(session, tenant.id, restaurant_id, limit)


@router.get("/menu/related", summary="С этим покупают")
async def related(
    session: SessionDep,
    tenant: TenantDep,
    dish_id: Annotated[UUID, Query()],
    restaurant_id: Annotated[UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=12)] = 8,
) -> list[DishRead]:
    return await menu_service.get_related(session, tenant.id, dish_id, restaurant_id, limit)


@router.get("/menu", summary="Каталог блюд по категориям")
async def get_menu(
    session: SessionDep,
    tenant: TenantDep,
    restaurant_id: Annotated[UUID | None, Query()] = None,
) -> MenuRead:
    return await menu_service.get_menu(session, tenant.id, restaurant_id)


@router.get("/delivery/zones", summary="Контуры зон доставки для карты")
async def delivery_zones(
    session: SessionDep,
    tenant: TenantDep,
    city_id: Annotated[UUID | None, Query()] = None,
) -> list[DeliveryZoneRead]:
    """Куда сеть возит. Показываем на карте выбора адреса, чтобы гость не гадал.

    Отдаём весь город целиком: зон немного, а с ними карта отвечает на вопрос
    «а ко мне приедете?» до того, как гость его задаст.
    """
    query = select(DeliveryZone).where(
        DeliveryZone.tenant_id == tenant.id, DeliveryZone.is_active.is_(True)
    )
    if city_id is not None:
        query = query.where(DeliveryZone.city_id == city_id)

    zones = await session.scalars(query.order_by(DeliveryZone.sort_order))

    return [
        DeliveryZoneRead(
            id=zone.id,
            name=zone.name,
            outline=zone.outline,
            color=zone.color,
            delivery_price_kopecks=zone.delivery_price_kopecks,
            min_order_kopecks=zone.min_order_kopecks,
            delivery_minutes=zone.delivery_minutes,
        )
        for zone in zones
    ]


@router.get("/delivery/coverage", summary="Общая граница доставки")
async def delivery_coverage(
    session: SessionDep,
    tenant: TenantDep,
    city_id: Annotated[UUID | None, Query()] = None,
) -> list[list[list[float]]]:
    """Внешний контур всех зон одним силуэтом — для карты выбора адреса."""
    query = select(DeliveryZone.outline).where(
        DeliveryZone.tenant_id == tenant.id, DeliveryZone.is_active.is_(True)
    )
    if city_id is not None:
        query = query.where(DeliveryZone.city_id == city_id)

    outlines = list(await session.scalars(query))
    return delivery_service.coverage(outlines)


@router.get("/delivery/resolve", summary="Кто везёт на этот адрес")
async def resolve_delivery(
    session: SessionDep,
    tenant: TenantDep,
    latitude: Annotated[float, Query(ge=-90, le=90)],
    longitude: Annotated[float, Query(ge=-180, le=180)],
    city_id: Annotated[UUID | None, Query()] = None,
) -> DeliveryResolve:
    match = await delivery_service.resolve(session, tenant, latitude, longitude, city_id)
    if match is None:
        return DeliveryResolve(covered=False)

    zone = match.zone
    restaurant = match.restaurant

    # Минимум зависит от дня недели, а часы доставки — от ресторана
    now = datetime.now(UTC).astimezone(ZoneInfo(tenant.timezone))
    weekend = now.weekday() >= 4
    minimum = zone.min_order_kopecks
    if weekend and zone.min_order_weekend_kopecks is not None:
        minimum = zone.min_order_weekend_kopecks

    opens = restaurant.delivery_opens_at
    closes = restaurant.delivery_closes_at
    open_now = True if opens is None or closes is None else opens <= now.time() <= closes

    return DeliveryResolve(
        covered=not restaurant.is_paused,
        restaurant=RestaurantRead.model_validate(restaurant),
        zone_id=zone.id,
        zone_name=zone.name,
        delivery_price_kopecks=zone.delivery_price_kopecks,
        min_order_kopecks=minimum,
        free_delivery_from_kopecks=zone.free_delivery_from_kopecks,
        delivery_minutes=zone.delivery_minutes,
        delivery_opens_at=opens,
        delivery_closes_at=closes,
        delivery_open_now=open_now,
        paused_reason=restaurant.pause_reason if restaurant.is_paused else None,
    )
