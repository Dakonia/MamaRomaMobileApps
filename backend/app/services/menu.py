from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.menu import Dish, DishExtra, DishPrice, MenuCategory, StopListEntry
from app.models.order import OrderItem
from app.schemas.menu import DishExtraRead, DishRead, MenuCategoryRead, MenuRead


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


async def _not_sold(session: AsyncSession, tenant_id: str, restaurant_id: UUID) -> set[UUID]:
    """Блюда, которых в этом ресторане нет в принципе — не путать со стоп-листом."""
    rows = await session.scalars(
        select(DishPrice.dish_id).where(
            DishPrice.tenant_id == tenant_id,
            DishPrice.restaurant_id == restaurant_id,
            DishPrice.is_available.is_(False),
        )
    )
    return set(rows.all())


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


# Стоп-лист — единственная причина, которую видно в меню: блюдо есть,
# но сегодня закончилось. Остальное просто не показываем
STOPPED = "Закончилось сегодня"

# Что обычно берут к блюдам этого раздела. Из всего списка помечаем
# две-три подходящие добавки — вместо полусотни равных строк гость видит совет
RECOMMENDED: dict[str, tuple[str, ...]] = {
    "pizza": ("моцарелла", "бекон", "пеперони", "грибы"),
    "pasta": ("пармезан", "соус песто", "грибы", "бекон"),
    "rizotto": ("пармезан", "грибы", "черри"),
    "meet": ("соус барбекю", "соус горгонзола", "грибы"),
    "gril": ("соус барбекю", "соус песто", "зелень"),
    "garniry": ("соус сыр пицца", "соус барбекю", "зелень"),
    "hleb": ("соус пицца", "чеснок", "пармезан"),
    "salad": ("пармезан", "черри", "руккола"),
    "soup": ("зелень", "пармезан", "сметана"),
    "desert": ("мороженое", "соус шоколадный", "соус малиновый"),
}
RECOMMENDED_LIMIT = 3


async def get_menu(
    session: AsyncSession,
    tenant_id: str,
    restaurant_id: UUID | None = None,
) -> MenuRead:
    """Каталог сети. С указанным рестораном — с его ценами и стоп-листом.

    Снятое с продажи блюдо в меню не показываем вовсе: в каждом ресторане свой
    набор, и «нет в этом ресторане» гостю ничего не объясняет. А стоп-лист —
    состояние на сегодня, его показываем внизу категории с подписью.
    """
    categories = (
        await session.scalars(
            select(MenuCategory)
            .where(MenuCategory.tenant_id == tenant_id, MenuCategory.is_active.is_(True))
            .order_by(MenuCategory.sort_order, MenuCategory.name)
        )
    ).all()

    dishes = (
        await session.scalars(
            select(Dish).where(Dish.tenant_id == tenant_id).order_by(Dish.sort_order, Dish.name)
        )
    ).all()

    overrides: dict[UUID, int] = {}
    stopped: set[UUID] = set()
    not_sold: set[UUID] = set()
    if restaurant_id is not None:
        overrides = await _price_overrides(session, tenant_id, restaurant_id)
        stopped = await _stopped_dishes(session, tenant_id, restaurant_id)
        not_sold = await _not_sold(session, tenant_id, restaurant_id)

    slugs = {category.id: category.slug for category in categories}
    # Добавки раздела достаются каждому его блюду
    shared = {category.id: list(category.extras) for category in categories}
    by_category: dict[UUID, list[DishRead]] = {}
    for dish in dishes:
        # Выключенных и не продающихся здесь в меню нет совсем
        if not dish.is_active or dish.id in not_sold:
            continue

        reason = STOPPED if dish.id in stopped else None

        by_category.setdefault(dish.category_id, []).append(
            DishRead(
                id=dish.id,
                category_id=dish.category_id,
                name=dish.name,
                description=dish.description,
                composition=dish.composition,
                image_url=dish.image_url,
                image_blurhash=dish.image_blurhash,
                price_kopecks=overrides.get(dish.id, dish.price_kopecks),
                weight_grams=dish.weight_grams,
                volume_ml=dish.volume_ml,
                calories=dish.calories,
                proteins_g=dish.proteins_g,
                fats_g=dish.fats_g,
                carbs_g=dish.carbs_g,
                is_spicy=dish.is_spicy,
                is_vegetarian=dish.is_vegetarian,
                is_new=dish.is_new,
                is_available=reason is None,
                unavailable_reason=reason,
                extras=_extras_for(
                    dish, slugs.get(dish.category_id, ""), shared.get(dish.category_id, [])
                ),
            )
        )

    # Закончившиеся — в конец категории, порядок внутри групп сохраняем
    for rows in by_category.values():
        rows.sort(key=lambda row: not row.is_available)

    return MenuRead(
        restaurant_id=restaurant_id,
        categories=[
            MenuCategoryRead(
                id=category.id,
                name=category.name,
                slug=category.slug,
                image_url=category.image_url,
                image_blurhash=category.image_blurhash,
                dishes=by_category.get(category.id, []),
            )
            for category in categories
            if by_category.get(category.id)
        ],
    )


def _extras_for(
    dish: Dish, category_slug: str, shared: list[DishExtra]
) -> list[DishExtraRead]:
    """Добавки блюда и его раздела по алфавиту, у подходящих — отметка «советуем»."""
    hints = RECOMMENDED.get(category_slug, ())

    seen: dict[UUID, DishExtra] = {}
    for extra in [*dish.extras, *shared]:
        if extra.is_active:
            seen.setdefault(extra.id, extra)
    active = list(seen.values())

    advised: list[UUID] = []
    for hint in hints:
        for extra in active:
            if hint in extra.name.lower() and extra.id not in advised:
                advised.append(extra.id)
                break
        if len(advised) >= RECOMMENDED_LIMIT:
            break

    return [
        DishExtraRead(
            id=extra.id,
            name=extra.name,
            price_kopecks=extra.price_kopecks,
            is_recommended=extra.id in advised,
        )
        for extra in sorted(active, key=lambda row: row.name.lower())
    ]


def _to_read(dish: Dish, price: int, available: bool) -> DishRead:
    return DishRead(
        id=dish.id,
        category_id=dish.category_id,
        name=dish.name,
        description=dish.description,
        composition=dish.composition,
        image_url=dish.image_url,
        image_blurhash=dish.image_blurhash,
        price_kopecks=price,
        weight_grams=dish.weight_grams,
        volume_ml=dish.volume_ml,
        calories=dish.calories,
        proteins_g=dish.proteins_g,
        fats_g=dish.fats_g,
        carbs_g=dish.carbs_g,
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

    # Разделы, которые сеть не хочет видеть на этой полке, отсекаем сразу —
    # и у хитов по продажам, и у списка, которым полка добирается
    hidden = select(MenuCategory.id).where(
        MenuCategory.tenant_id == tenant_id, MenuCategory.show_in_popular.is_(False)
    )

    query = select(Dish).where(
        Dish.tenant_id == tenant_id,
        Dish.is_active.is_(True),
        Dish.image_url.is_not(None),
        Dish.category_id.notin_(hidden),
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


async def get_related(
    session: AsyncSession,
    tenant_id: str,
    dish_id: UUID,
    restaurant_id: UUID | None = None,
    limit: int = 8,
) -> list[DishRead]:
    """«С этим покупают»: сначала то, что реально брали в тех же заказах.

    Пока заказов мало, добираем соседями по категории — полка не должна пустовать.
    """
    orders_with_dish = select(OrderItem.order_id).where(
        OrderItem.tenant_id == tenant_id, OrderItem.dish_id == dish_id
    )

    together = (
        await session.execute(
            select(OrderItem.dish_id, func.sum(OrderItem.quantity).label("sold"))
            .where(
                OrderItem.tenant_id == tenant_id,
                OrderItem.order_id.in_(orders_with_dish),
                OrderItem.dish_id.is_not(None),
                OrderItem.dish_id != dish_id,
            )
            .group_by(OrderItem.dish_id)
            .order_by(desc("sold"))
            .limit(limit)
        )
    ).all()
    ordered_ids = [row.dish_id for row in together if row.dish_id is not None]

    base = select(Dish).where(
        Dish.tenant_id == tenant_id,
        Dish.is_active.is_(True),
        Dish.id != dish_id,
        Dish.image_url.is_not(None),
    )

    dishes: list[Dish] = []
    if ordered_ids:
        dishes = list((await session.scalars(base.where(Dish.id.in_(ordered_ids)))).all())
        position = {value: index for index, value in enumerate(ordered_ids)}
        dishes.sort(key=lambda dish: position.get(dish.id, len(position)))

    if len(dishes) < limit:
        source = await session.scalar(
            select(Dish).where(Dish.id == dish_id, Dish.tenant_id == tenant_id)
        )
        taken = [dish.id for dish in dishes]
        neighbours = base.where(Dish.id.notin_(taken or [UUID(int=0)]))
        if source is not None:
            neighbours = neighbours.where(Dish.category_id == source.category_id)

        filler = (
            await session.scalars(
                neighbours.order_by(Dish.sort_order, Dish.name).limit(limit - len(dishes))
            )
        ).all()
        dishes = [*dishes, *filler]

    overrides: dict[UUID, int] = {}
    stopped: set[UUID] = set()
    if restaurant_id is not None:
        overrides = await _price_overrides(session, tenant_id, restaurant_id)
        stopped = await _stopped_dishes(session, tenant_id, restaurant_id)

    return [
        _to_read(dish, overrides.get(dish.id, dish.price_kopecks), dish.id not in stopped)
        for dish in dishes[:limit]
    ]
