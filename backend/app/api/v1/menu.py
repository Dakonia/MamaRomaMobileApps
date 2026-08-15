from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import SessionDep, TenantDep
from app.models.geo import City, Restaurant
from app.schemas.menu import CityRead, DishRead, MenuRead, RestaurantRead
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


@router.get("/menu", summary="Каталог блюд по категориям")
async def get_menu(
    session: SessionDep,
    tenant: TenantDep,
    restaurant_id: Annotated[UUID | None, Query()] = None,
) -> MenuRead:
    return await menu_service.get_menu(session, tenant.id, restaurant_id)
