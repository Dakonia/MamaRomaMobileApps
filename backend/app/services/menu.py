from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.menu import Dish, DishPrice, MenuCategory, StopListEntry
from app.models.order import OrderItem
from app.schemas.menu import DishRead, MenuCategoryRead, MenuRead


async def _price_overrides(
    session: AsyncSession, tenant_id: str, restaurant_id: UUID
) -> dict[UUID, int]:
    rows = await session.execute(
        select(DishPrice.dish_id, DishPrice.price_kopecks).where(
            DishPrice.tenant_id == tenant_id,
            DishPrice.restaurant_id == restaurant_id,
        )
    )
    return {row.dish_id: row.price_kopecks for row in rows}


async def _stopped_dishes(session: AsyncSession, tenant_id: str, restaurant_id: UUID) -> set[UUID]:
    now = datetime.now(UTC)
    rows = await session.scalars(
        select(StopListEntry.dish_id).where(
            StopListEntry.tenant_id == tenant_id,
            StopListEntry.restaurant_id == restaurant_id,
            or_(StopListEntry.until.is_(None), StopListEntry.until > now),
        )
    )
    return set(rows.all())


async def get_menu(
    session: AsyncSession,
    tenant_id: str,
    restaurant_id: UUID | None = None,
) -> MenuRead:
    """Каталог сети. С указанным рестораном — с его ценами и стоп-листом."""
    categories = (
        await session.scalars(
            select(MenuCategory)
            .where(MenuCategory.tenant_id == tenant_id, MenuCategory.is_active.is_(True))
            .order_by(MenuCategory.sort_order, MenuCategory.name)
        )
    ).all()

    dishes = (
        await session.scalars(
            select(Dish)
            .where(Dish.tenant_id == tenant_id, Dish.is_active.is_(True))
            .order_by(Dish.sort_order, Dish.name)
        )
    ).all()

    overrides: dict[UUID, int] = {}
    stopped: set[UUID] = set()
    if restaurant_id is not None:
        overrides = await _price_overrides(session, tenant_id, restaurant_id)
        stopped = await _stopped_dishes(session, tenant_id, restaurant_id)

    by_category: dict[UUID, list[DishRead]] = {}
    for dish in dishes:
        by_category.setdefault(dish.category_id, []).append(
            DishRead(
                id=dish.id,
                category_id=dish.category_id,
                name=dish.name,
                description=dish.description,
                composition=dish.composition,
                image_url=dish.image_url,
                price_kopecks=overrides.get(dish.id, dish.price_kopecks),
                weight_grams=dish.weight_grams,
                volume_ml=dish.volume_ml,
                calories=dish.calories,
                is_spicy=dish.is_spicy,
                is_vegetarian=dish.is_vegetarian,
                is_new=dish.is_new,
                is_available=dish.id not in stopped,
            )
        )

    return MenuRead(
        restaurant_id=restaurant_id,
        categories=[
            MenuCategoryRead(
                id=category.id,
                name=category.name,
                slug=category.slug,
                image_url=category.image_url,
                dishes=by_category.get(category.id, []),
            )
            for category in categories
            if by_category.get(category.id)
        ],
    )


def _to_read(dish: Dish, price: int, available: bool) -> DishRead:
    return DishRead(
        id=dish.id,
        category_id=dish.category_id,
        name=dish.name,
        description=dish.description,
        composition=dish.composition,
        image_url=dish.image_url,
        price_kopecks=price,
        weight_grams=dish.weight_grams,
        volume_ml=dish.volume_ml,
        calories=dish.calories,
        is_spicy=dish.is_spicy,
        is_vegetarian=dish.is_vegetarian,
        is_new=dish.is_new,
        is_available=available,
    )


async def get_popular(
    session: AsyncSession,
    tenant_id: str,
    restaurant_id: UUID | None = None,
    limit: int = 10,
) -> list[DishRead]:
    """Хиты продаж: считаем по проданным штукам из позиций заказов.

    Пока заказов мало, добираем список началом меню — чтобы полка
    не пустовала в первый день работы сети.
    """
    ranked = (
        await session.execute(
            select(OrderItem.dish_id, func.sum(OrderItem.quantity).label("sold"))
            .where(OrderItem.tenant_id == tenant_id, OrderItem.dish_id.is_not(None))
            .group_by(OrderItem.dish_id)
            .order_by(desc("sold"))
            .limit(limit)
        )
    ).all()
    ordered_ids = [row.dish_id for row in ranked if row.dish_id is not None]

    query = select(Dish).where(
        Dish.tenant_id == tenant_id,
        Dish.is_active.is_(True),
        Dish.image_url.is_not(None),
    )
    if ordered_ids:
        top = (await session.scalars(query.where(Dish.id.in_(ordered_ids)))).all()
    else:
        top = []

    if len(top) < limit:
        filler = (
            await session.scalars(
                query.where(Dish.id.notin_([dish.id for dish in top] or [UUID(int=0)]))
                .order_by(Dish.sort_order, Dish.name)
                .limit(limit - len(top))
            )
        ).all()
        dishes = [*top, *filler]
    else:
        dishes = list(top)

    if ordered_ids:
        position = {dish_id: index for index, dish_id in enumerate(ordered_ids)}
        dishes.sort(key=lambda dish: position.get(dish.id, len(position)))

    overrides: dict[UUID, int] = {}
    stopped: set[UUID] = set()
    if restaurant_id is not None:
        overrides = await _price_overrides(session, tenant_id, restaurant_id)
        stopped = await _stopped_dishes(session, tenant_id, restaurant_id)

    return [
        _to_read(dish, overrides.get(dish.id, dish.price_kopecks), dish.id not in stopped)
        for dish in dishes[:limit]
    ]
