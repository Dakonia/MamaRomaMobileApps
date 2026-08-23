from datetime import UTC, datetime, time
from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile, status
from sqlalchemy import delete, func, insert, or_, select

from app.api.deps import SessionDep, StaffDep, TenantDep
from app.core.db import SessionLocal
from app.core.security import create_token, normalize_phone, verify_password
from app.models.enums import CampaignStatus, OrderStatus, ReservationStatus, TriggerKind
from app.models.geo import City, DeliveryZone, Restaurant
from app.models.guest import Guest, GuestAddress
from app.models.loyalty import LoyaltyAccount, LoyaltyTransaction
from app.models.menu import (
    Dish,
    DishExtra,
    DishPrice,
    MenuCategory,
    StopListEntry,
    category_extra_links,
    dish_extra_links,
)
from app.models.notification import (
    Automation,
    Campaign,
    NotificationHours,
    NotificationRule,
)
from app.models.order import Order, OrderItem
from app.models.promo_code import PromoCode
from app.models.promotion import Promotion
from app.models.reservation import Reservation
from app.models.staff import StaffUser
from app.models.sync import SyncChange, SyncRun
from app.schemas.admin import (
    AudienceQuery,
    AutomationRead,
    AutomationWrite,
    CampaignRead,
    CampaignWrite,
    CategoryAdminRead,
    CategoryPatch,
    CategoryWrite,
    DishAdminRead,
    DishExtraAdminRead,
    DishExtraPatch,
    DishExtraWrite,
    DishPatch,
    DishWrite,
    ExtraCategoriesWrite,
    GuestAdminRead,
    GuestCardRead,
    GuestOrderRead,
    GuestPatch,
    GuestPointsRead,
    GuestReservationRead,
    GuestWrite,
    HoursRead,
    HoursWrite,
    OrderStatusWrite,
    PromoCodePatch,
    PromoCodeRead,
    PromoCodeWrite,
    ReservationStatusWrite,
    RestaurantAdminRead,
    RestaurantDishPatch,
    RestaurantDishRead,
    RestaurantPatch,
    RestaurantWrite,
    RuleRead,
    RuleWrite,
    StaffLogin,
    StaffRead,
    StaffSession,
    StopListRead,
    StopListWrite,
    ZoneCreate,
    ZonePatch,
    ZoneRead,
)
from app.schemas.order import OrderRead
from app.schemas.promotion import (
    PromotionAdminRead,
    PromotionPatch,
    PromotionWrite,
)
from app.schemas.reservation import ReservationRead
from app.schemas.sync import SyncApply, SyncChangeRead, SyncRunRead
from app.services import campaign as campaign_service
from app.services import guest as guest_service
from app.services import loyalty as loyalty_service
from app.services import media as media_service
from app.services import order as order_service
from app.services import promo_code as promo_service
from app.services import promotions as promotion_service
from app.services import push as push_service
from app.services import reservation as reservation_service
from app.services import sync as sync_service
from app.services.sync import KIND_TITLES, Change, ChangeAction, SyncKind

router = APIRouter(prefix="/admin", tags=["Админка"])


@router.post("/login", summary="Вход сотрудника")
async def login(payload: StaffLogin, session: SessionDep, tenant: TenantDep) -> StaffSession:
    staff = await session.scalar(
        select(StaffUser).where(
            StaffUser.tenant_id == tenant.id,
            StaffUser.email == payload.email.strip().lower(),
        )
    )
    if (
        staff is None
        or not staff.is_active
        or not verify_password(payload.password, staff.password_hash)
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверная почта или пароль")

    staff.last_login_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(staff)

    return StaffSession(
        access_token=create_token(staff.id, tenant.id, "staff"),
        staff=StaffRead.model_validate(staff),
    )


@router.get("/me", summary="Текущий сотрудник")
async def me(staff: StaffDep) -> StaffRead:
    return StaffRead.model_validate(staff)


@router.post("/uploads", summary="Загрузить фотографию")
async def upload(
    staff: StaffDep,
    file: Annotated[UploadFile, File()],
    folder: Annotated[str, Query(pattern=r"^[a-z-]+$")] = "dishes",
) -> dict[str, str]:
    try:
        url = media_service.save_image(await file.read(), file.content_type, folder)
    except media_service.MediaError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return {"url": url}


# ─────────────────────────── меню ───────────────────────────


@router.get("/categories", summary="Категории меню")
async def categories(
    session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> list[CategoryAdminRead]:
    counts: dict[UUID, int] = {
        row.category_id: row.total
        for row in await session.execute(
            select(Dish.category_id, func.count().label("total"))
            .where(Dish.tenant_id == tenant.id)
            .group_by(Dish.category_id)
        )
    }
    rows = await session.scalars(
        select(MenuCategory)
        .where(MenuCategory.tenant_id == tenant.id)
        .order_by(MenuCategory.sort_order, MenuCategory.name)
    )
    return [
        CategoryAdminRead(
            id=row.id,
            name=row.name,
            slug=row.slug,
            sort_order=row.sort_order,
            is_active=row.is_active,
            image_url=row.image_url,
            show_in_popular=row.show_in_popular,
            dishes_count=counts.get(row.id, 0),
        )
        for row in rows
    ]


@router.post("/categories", status_code=status.HTTP_201_CREATED, summary="Создать категорию")
async def create_category(
    payload: CategoryWrite, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> CategoryAdminRead:
    exists = await session.scalar(
        select(MenuCategory).where(
            MenuCategory.tenant_id == tenant.id, MenuCategory.slug == payload.slug
        )
    )
    if exists is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Категория с таким кодом уже есть")

    category = MenuCategory(tenant_id=tenant.id, **payload.model_dump())
    session.add(category)
    await session.commit()
    await session.refresh(category)
    return CategoryAdminRead.model_validate(category)


@router.patch("/categories/{category_id}", summary="Изменить категорию")
async def update_category(
    category_id: UUID,
    payload: CategoryPatch,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> CategoryAdminRead:
    category = await session.scalar(
        select(MenuCategory).where(
            MenuCategory.id == category_id, MenuCategory.tenant_id == tenant.id
        )
    )
    if category is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Категория не найдена")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(category, field, value)
    await session.commit()
    await session.refresh(category)
    return CategoryAdminRead.model_validate(category)


@router.delete(
    "/categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить категорию",
)
async def delete_category(
    category_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> None:
    category = await session.scalar(
        select(MenuCategory).where(
            MenuCategory.id == category_id, MenuCategory.tenant_id == tenant.id
        )
    )
    if category is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Категория не найдена")

    used = await session.scalar(
        select(func.count()).select_from(Dish).where(Dish.category_id == category_id)
    )
    if used:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"В категории {used} блюд. Сначала перенесите или удалите их",
        )

    await session.delete(category)
    await session.commit()


@router.get("/dishes", summary="Блюда")
async def dishes(
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    category_id: Annotated[UUID | None, Query()] = None,
) -> list[DishAdminRead]:
    query = select(Dish).where(Dish.tenant_id == tenant.id)
    if category_id is not None:
        query = query.where(Dish.category_id == category_id)

    rows = await session.scalars(query.order_by(Dish.sort_order, Dish.name))
    return [DishAdminRead.model_validate(row) for row in rows]


@router.post("/dishes", status_code=status.HTTP_201_CREATED, summary="Создать блюдо")
async def create_dish(
    payload: DishWrite, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> DishAdminRead:
    category = await session.scalar(
        select(MenuCategory).where(
            MenuCategory.id == payload.category_id, MenuCategory.tenant_id == tenant.id
        )
    )
    if category is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Категория не найдена")

    dish = Dish(tenant_id=tenant.id, **payload.model_dump())
    session.add(dish)
    await session.commit()
    await session.refresh(dish)
    return DishAdminRead.model_validate(dish)


@router.patch("/dishes/{dish_id}", summary="Изменить блюдо")
async def update_dish(
    dish_id: UUID,
    payload: DishPatch,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> DishAdminRead:
    dish = await session.scalar(select(Dish).where(Dish.id == dish_id, Dish.tenant_id == tenant.id))
    if dish is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Блюдо не найдено")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(dish, field, value)
    await session.commit()
    await session.refresh(dish)
    return DishAdminRead.model_validate(dish)


@router.delete(
    "/dishes/{dish_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить блюдо"
)
async def delete_dish(
    dish_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> None:
    dish = await session.scalar(
        select(Dish).where(Dish.id == dish_id, Dish.tenant_id == tenant.id)
    )
    if dish is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Блюдо не найдено")

    # В заказах остаётся снимок названия и цены, поэтому удаление истории не рушит
    await session.delete(dish)
    await session.commit()


# ─────────────────────────── стоп-лист ───────────────────────────


@router.get("/stop-list", summary="Что сейчас в стоп-листе")
async def stop_list(session: SessionDep, tenant: TenantDep, staff: StaffDep) -> list[StopListRead]:
    now = datetime.now(UTC)
    rows = (
        await session.execute(
            select(StopListEntry, Restaurant.name, Dish.name)
            .join(Restaurant, Restaurant.id == StopListEntry.restaurant_id)
            .join(Dish, Dish.id == StopListEntry.dish_id)
            .where(
                StopListEntry.tenant_id == tenant.id,
                or_(StopListEntry.until.is_(None), StopListEntry.until > now),
            )
            .order_by(Restaurant.name, Dish.name)
        )
    ).all()

    return [
        StopListRead(
            id=entry.id,
            restaurant_id=entry.restaurant_id,
            restaurant_name=restaurant_name,
            dish_id=entry.dish_id,
            dish_name=dish_name,
            until=entry.until,
            comment=entry.comment,
        )
        for entry, restaurant_name, dish_name in rows
    ]


@router.post("/stop-list", status_code=status.HTTP_201_CREATED, summary="Поставить в стоп-лист")
async def add_to_stop_list(
    payload: StopListWrite, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> dict[str, str]:
    exists = await session.scalar(
        select(StopListEntry).where(
            StopListEntry.tenant_id == tenant.id,
            StopListEntry.restaurant_id == payload.restaurant_id,
            StopListEntry.dish_id == payload.dish_id,
        )
    )
    if exists is not None:
        exists.until = payload.until
        exists.comment = payload.comment
    else:
        session.add(StopListEntry(tenant_id=tenant.id, **payload.model_dump()))

    await session.commit()
    return {"status": "ok"}


@router.delete(
    "/stop-list/{entry_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Убрать из стоп-листа"
)
async def remove_from_stop_list(
    entry_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> None:
    entry = await session.scalar(
        select(StopListEntry).where(
            StopListEntry.id == entry_id, StopListEntry.tenant_id == tenant.id
        )
    )
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Записи нет")

    await session.delete(entry)
    await session.commit()


# ─────────────────────────── заказы и брони ───────────────────────────


@router.get("/orders", summary="Заказы сети")
async def orders(
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    active_only: Annotated[bool, Query()] = True,
) -> list[OrderRead]:
    query = select(Order).where(Order.tenant_id == tenant.id)
    if active_only:
        query = query.where(Order.status.notin_([OrderStatus.COMPLETED, OrderStatus.CANCELLED]))

    rows = await session.scalars(query.order_by(Order.created_at.desc()).limit(100))
    return [order_service.to_read(row) for row in rows]


@router.patch("/orders/{order_id}", summary="Сменить статус заказа")
async def set_order_status(
    order_id: UUID,
    payload: OrderStatusWrite,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> OrderRead:
    order = await session.scalar(
        select(Order).where(Order.id == order_id, Order.tenant_id == tenant.id)
    )
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заказ не найден")

    now = datetime.now(UTC)
    order.status = payload.status
    if payload.status is OrderStatus.COMPLETED:
        order.completed_at = now
    if payload.status is OrderStatus.CANCELLED:
        order.cancelled_at = now
        order.cancel_reason = payload.cancel_reason or "Отменён рестораном"

    await session.commit()
    await session.refresh(order)

    # Пуш гостю: уведомление не должно ломать смену статуса, поэтому молча
    # переживаем любую ошибку доставки
    try:
        await push_service.notify_order(session, tenant.id, order)
    except Exception as error:
        print(f"пуш о заказе {order.number} не ушёл: {error}")

    return order_service.to_read(order)


@router.get("/reservations", summary="Брони сети")
async def reservations(
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    active_only: Annotated[bool, Query()] = True,
) -> list[ReservationRead]:
    query = select(Reservation).where(Reservation.tenant_id == tenant.id)
    if active_only:
        query = query.where(Reservation.status.in_(reservation_service.ACTIVE_STATUSES))

    rows = await session.scalars(query.order_by(Reservation.reserved_at).limit(100))
    return [reservation_service.to_read(row) for row in rows]


@router.patch("/reservations/{reservation_id}", summary="Сменить статус брони")
async def set_reservation_status(
    reservation_id: UUID,
    payload: ReservationStatusWrite,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> ReservationRead:
    reservation = await session.scalar(
        select(Reservation).where(
            Reservation.id == reservation_id, Reservation.tenant_id == tenant.id
        )
    )
    if reservation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Бронь не найдена")

    now = datetime.now(UTC)
    reservation.status = payload.status
    if payload.table_number is not None:
        reservation.table_number = payload.table_number
    if payload.status is ReservationStatus.CONFIRMED:
        reservation.confirmed_at = now
    if payload.status is ReservationStatus.CANCELLED:
        reservation.cancelled_at = now
        reservation.cancel_reason = payload.cancel_reason or "Отменена рестораном"

    await session.commit()
    await session.refresh(reservation)
    return reservation_service.to_read(reservation)


# ─────────────────────────── акции ───────────────────────────


def _promotion_read(promotion: Promotion) -> PromotionAdminRead:
    read = promotion_service.to_read(promotion)
    return PromotionAdminRead(
        **read.model_dump(),
        sort_order=promotion.sort_order,
        is_active=promotion.is_active,
    )


def _measure_photo(promotion: Promotion) -> None:
    """Запоминаем пропорцию картинки, чтобы приложение не резало кадр."""
    size = media_service.dimensions(promotion.image_url)
    promotion.image_width, promotion.image_height = size if size else (None, None)


async def _link_restaurants(
    session: SessionDep, tenant_id: str, promotion: Promotion, ids: list[UUID]
) -> None:
    """Пустой список означает «во всех ресторанах сети»."""
    if not ids:
        promotion.restaurants = []
        return

    rows = await session.scalars(
        select(Restaurant).where(Restaurant.tenant_id == tenant_id, Restaurant.id.in_(ids))
    )
    promotion.restaurants = list(rows)


@router.get("/promotions", summary="Все акции")
async def promotions(
    session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> list[PromotionAdminRead]:
    rows = await session.scalars(
        select(Promotion)
        .where(Promotion.tenant_id == tenant.id)
        .order_by(Promotion.sort_order, Promotion.created_at.desc())
    )
    return [_promotion_read(row) for row in rows]


@router.post("/promotions", status_code=status.HTTP_201_CREATED, summary="Создать акцию")
async def create_promotion(
    payload: PromotionWrite, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> PromotionAdminRead:
    fields = payload.model_dump()
    restaurant_ids = fields.pop("restaurant_ids")

    promotion = Promotion(tenant_id=tenant.id, **fields)
    _measure_photo(promotion)
    session.add(promotion)
    await _link_restaurants(session, tenant.id, promotion, restaurant_ids)

    await session.commit()
    await session.refresh(promotion)
    return _promotion_read(promotion)


@router.patch("/promotions/{promotion_id}", summary="Изменить акцию")
async def update_promotion(
    promotion_id: UUID,
    payload: PromotionPatch,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> PromotionAdminRead:
    promotion = await session.scalar(
        select(Promotion).where(Promotion.id == promotion_id, Promotion.tenant_id == tenant.id)
    )
    if promotion is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Акция не найдена")

    fields = payload.model_dump(exclude_unset=True)
    restaurant_ids = fields.pop("restaurant_ids", None)

    for field, value in fields.items():
        setattr(promotion, field, value)
    _measure_photo(promotion)

    if restaurant_ids is not None:
        await _link_restaurants(session, tenant.id, promotion, restaurant_ids)

    await session.commit()
    await session.refresh(promotion)
    return _promotion_read(promotion)


@router.delete(
    "/promotions/{promotion_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить акцию",
)
async def delete_promotion(
    promotion_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> None:
    promotion = await session.scalar(
        select(Promotion).where(Promotion.id == promotion_id, Promotion.tenant_id == tenant.id)
    )
    if promotion is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Акция не найдена")

    media_service.delete_image(promotion.image_url)
    await session.delete(promotion)
    await session.commit()


# --- Рестораны ---------------------------------------------------------------


@router.get("/restaurants", summary="Рестораны сети")
async def admin_restaurants(
    session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> list[RestaurantAdminRead]:
    rows = await session.scalars(
        select(Restaurant).where(Restaurant.tenant_id == tenant.id).order_by(Restaurant.name)
    )
    return [RestaurantAdminRead.model_validate(row) for row in rows]


@router.post("/restaurants", status_code=status.HTTP_201_CREATED, summary="Создать ресторан")
async def create_restaurant(
    payload: RestaurantWrite, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> RestaurantAdminRead:
    city = await session.scalar(
        select(City).where(City.id == payload.city_id, City.tenant_id == tenant.id)
    )
    if city is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Город не найден")

    restaurant = Restaurant(tenant_id=tenant.id, **payload.model_dump())
    session.add(restaurant)
    await session.commit()
    await session.refresh(restaurant)
    return RestaurantAdminRead.model_validate(restaurant)


@router.patch("/restaurants/{restaurant_id}", summary="Изменить ресторан")
async def update_restaurant(
    restaurant_id: UUID,
    payload: RestaurantPatch,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> RestaurantAdminRead:
    restaurant = await session.scalar(
        select(Restaurant).where(
            Restaurant.id == restaurant_id, Restaurant.tenant_id == tenant.id
        )
    )
    if restaurant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ресторан не найден")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(restaurant, field, value)

    # Сняли с паузы — причина больше не нужна, иначе она всплывёт в следующий раз
    if restaurant.is_paused is False:
        restaurant.pause_reason = None

    await session.commit()
    await session.refresh(restaurant)
    return RestaurantAdminRead.model_validate(restaurant)


@router.delete(
    "/restaurants/{restaurant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить ресторан",
)
async def delete_restaurant(
    restaurant_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> None:
    restaurant = await session.scalar(
        select(Restaurant).where(
            Restaurant.id == restaurant_id, Restaurant.tenant_id == tenant.id
        )
    )
    if restaurant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ресторан не найден")

    orders_count = await session.scalar(
        select(func.count()).select_from(Order).where(Order.restaurant_id == restaurant_id)
    )
    if orders_count:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"У ресторана {orders_count} заказов — историю нельзя терять. "
            "Отключите его галочкой «Работает»",
        )

    await session.delete(restaurant)
    await session.commit()


# --- Гости -------------------------------------------------------------------


@router.get("/guests", summary="Гости сети")
async def admin_guests(
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    search: Annotated[str | None, Query(max_length=120)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[GuestAdminRead]:
    # Заказы и баллы считаем в том же запросе: иначе список из полусотни гостей
    # превращается в полторы сотни обращений к базе
    orders = (
        select(
            Order.guest_id.label("guest_id"),
            func.count(Order.id).label("orders_count"),
            func.coalesce(func.sum(Order.total_kopecks), 0).label("spent"),
        )
        .where(Order.tenant_id == tenant.id)
        .group_by(Order.guest_id)
        .subquery()
    )

    query = (
        select(Guest, orders.c.orders_count, orders.c.spent, LoyaltyAccount)
        .outerjoin(orders, orders.c.guest_id == Guest.id)
        .outerjoin(LoyaltyAccount, LoyaltyAccount.guest_id == Guest.id)
        .where(Guest.tenant_id == tenant.id)
    )

    if search:
        pattern = f"%{search.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(Guest.name).like(pattern),
                Guest.phone.like(pattern),
                func.lower(Guest.email).like(pattern),
                LoyaltyAccount.card_number.like(pattern),
            )
        )

    rows = await session.execute(
        query.order_by(Guest.created_at.desc()).limit(limit).offset(offset)
    )

    result: list[GuestAdminRead] = []
    for guest, orders_count, spent, account in rows.all():
        card = GuestAdminRead.model_validate(guest)
        card.orders_count = orders_count or 0
        card.spent_kopecks = spent or 0
        if account is not None:
            tier = loyalty_service.tier_by_code(tenant, account.tier_code)
            card.tier_title = tier.title
            card.points_balance = account.points_balance
            card.card_number = account.card_number
        result.append(card)

    return result


async def _guest_or_404(session: SessionDep, tenant: TenantDep, guest_id: UUID) -> Guest:
    guest = await session.scalar(
        select(Guest).where(Guest.id == guest_id, Guest.tenant_id == tenant.id)
    )
    if guest is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Гость не найден")
    return guest


@router.get("/guests/{guest_id}", summary="Карточка гостя")
async def guest_card(
    guest_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> GuestCardRead:
    guest = await _guest_or_404(session, tenant, guest_id)

    order_rows = await session.execute(
        select(Order, Restaurant.name)
        .join(Restaurant, Restaurant.id == Order.restaurant_id)
        .where(Order.tenant_id == tenant.id, Order.guest_id == guest_id)
        .order_by(Order.created_at.desc())
        .limit(50)
    )

    orders: list[GuestOrderRead] = []
    for order, restaurant_name in order_rows.all():
        items = await session.scalars(
            select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.name)
        )
        orders.append(
            GuestOrderRead(
                id=order.id,
                number=order.number,
                created_at=order.created_at,
                type=order.type.value,
                status=order.status.value,
                restaurant_name=restaurant_name,
                address_text=order.address_text,
                total_kopecks=order.total_kopecks,
                items=[f"{item.name} × {item.quantity}" for item in items],
            )
        )

    reservation_rows = await session.execute(
        select(Reservation, Restaurant.name)
        .join(Restaurant, Restaurant.id == Reservation.restaurant_id)
        .where(Reservation.tenant_id == tenant.id, Reservation.guest_id == guest_id)
        .order_by(Reservation.reserved_at.desc())
        .limit(50)
    )

    address_rows = await session.scalars(
        select(GuestAddress)
        .where(GuestAddress.tenant_id == tenant.id, GuestAddress.guest_id == guest_id)
        .order_by(GuestAddress.is_default.desc(), GuestAddress.created_at.desc())
    )

    account = await loyalty_service.get_account(session, tenant, guest_id)
    points: list[GuestPointsRead] = []
    if account is not None:
        transactions = await session.scalars(
            select(LoyaltyTransaction)
            .where(LoyaltyTransaction.account_id == account.id)
            .order_by(LoyaltyTransaction.created_at.desc())
            .limit(50)
        )
        points = [
            GuestPointsRead(
                created_at=row.created_at,
                operation=row.operation.value,
                points=row.points,
                comment=row.comment,
            )
            for row in transactions
        ]

    card = GuestAdminRead.model_validate(guest)
    card.orders_count = len(orders)
    card.spent_kopecks = sum(order.total_kopecks for order in orders)
    if account is not None:
        tier = loyalty_service.tier_by_code(tenant, account.tier_code)
        card.tier_title = tier.title
        card.points_balance = account.points_balance
        card.card_number = account.card_number

    return GuestCardRead(
        guest=card,
        addresses=[guest_service.to_read(row) for row in address_rows],
        orders=orders,
        reservations=[
            GuestReservationRead(
                id=reservation.id,
                reserved_at=reservation.reserved_at,
                guests_count=reservation.guests_count,
                status=reservation.status.value,
                restaurant_name=restaurant_name,
            )
            for reservation, restaurant_name in reservation_rows.all()
        ],
        points=points,
    )


@router.post("/guests", status_code=status.HTTP_201_CREATED, summary="Завести гостя")
async def create_guest(
    payload: GuestWrite, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> GuestAdminRead:
    try:
        phone = normalize_phone(payload.phone)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    existing = await session.scalar(
        select(Guest).where(Guest.tenant_id == tenant.id, Guest.phone == phone)
    )
    if existing is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Гость с таким номером уже есть")

    guest = Guest(
        tenant_id=tenant.id,
        phone=phone,
        name=payload.name,
        email=str(payload.email) if payload.email else None,
        birthday=payload.birthday,
        gender=payload.gender,
        consent_at=datetime.now(UTC),
        consent_version="1",
    )
    session.add(guest)
    await session.flush()
    await loyalty_service.open_account(session, tenant, guest.id)
    await session.commit()
    await session.refresh(guest)
    return GuestAdminRead.model_validate(guest)


@router.patch("/guests/{guest_id}", summary="Изменить гостя")
async def update_guest(
    guest_id: UUID,
    payload: GuestPatch,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> GuestAdminRead:
    guest = await _guest_or_404(session, tenant, guest_id)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(guest, field, str(value) if field == "email" and value is not None else value)

    await session.commit()
    await session.refresh(guest)
    return GuestAdminRead.model_validate(guest)


@router.delete(
    "/guests/{guest_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить гостя"
)
async def delete_guest(
    guest_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> None:
    """Удаление по требованию гостя (ФЗ-152 и правила сторов). Заказы держат ссылку
    на гостя, поэтому при наличии истории удалять запрещаем — сначала обезличивание."""
    guest = await _guest_or_404(session, tenant, guest_id)

    orders_count = await session.scalar(
        select(func.count()).select_from(Order).where(Order.guest_id == guest_id)
    )
    if orders_count:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"У гостя {orders_count} заказов. Удалить нельзя — заблокируйте профиль",
        )

    await session.delete(guest)
    await session.commit()


# --- Зоны доставки -----------------------------------------------------------


@router.get("/zones", summary="Зоны доставки")
async def admin_zones(
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    city_id: Annotated[UUID | None, Query()] = None,
) -> list[ZoneRead]:
    query = (
        select(DeliveryZone, Restaurant.name)
        .join(Restaurant, Restaurant.id == DeliveryZone.restaurant_id)
        .where(DeliveryZone.tenant_id == tenant.id)
        .order_by(DeliveryZone.sort_order, DeliveryZone.name)
    )
    if city_id is not None:
        query = query.where(DeliveryZone.city_id == city_id)

    result: list[ZoneRead] = []
    for zone, restaurant_name in (await session.execute(query)).all():
        row = ZoneRead.model_validate(zone)
        row.restaurant_name = restaurant_name
        result.append(row)
    return result


@router.post("/zones", status_code=status.HTTP_201_CREATED, summary="Добавить зону")
async def create_zone(
    payload: ZoneCreate,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> ZoneRead:
    restaurant = await session.scalar(
        select(Restaurant).where(
            Restaurant.id == payload.restaurant_id, Restaurant.tenant_id == tenant.id
        )
    )
    if restaurant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ресторан не найден")

    zone = DeliveryZone(tenant_id=tenant.id, **payload.model_dump())
    session.add(zone)
    await session.commit()
    await session.refresh(zone)

    row = ZoneRead.model_validate(zone)
    row.restaurant_name = restaurant.name
    return row


@router.patch("/zones/{zone_id}", summary="Изменить зону")
async def update_zone(
    zone_id: UUID,
    payload: ZonePatch,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> ZoneRead:
    zone = await session.scalar(
        select(DeliveryZone).where(
            DeliveryZone.id == zone_id, DeliveryZone.tenant_id == tenant.id
        )
    )
    if zone is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Зона не найдена")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(zone, field, value)

    await session.commit()
    await session.refresh(zone)

    restaurant = await session.scalar(select(Restaurant).where(Restaurant.id == zone.restaurant_id))
    row = ZoneRead.model_validate(zone)
    row.restaurant_name = restaurant.name if restaurant else ""
    return row


@router.delete("/zones/{zone_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить зону")
async def delete_zone(
    zone_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> None:
    zone = await session.scalar(
        select(DeliveryZone).where(
            DeliveryZone.id == zone_id, DeliveryZone.tenant_id == tenant.id
        )
    )
    if zone is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Зона не найдена")

    await session.delete(zone)
    await session.commit()


# --- Меню конкретного ресторана ---------------------------------------------


@router.get("/restaurants/{restaurant_id}/menu", summary="Меню ресторана")
async def restaurant_menu(
    restaurant_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> list[RestaurantDishRead]:
    rows = await session.execute(
        select(Dish, MenuCategory.name)
        .join(MenuCategory, MenuCategory.id == Dish.category_id)
        .where(Dish.tenant_id == tenant.id, Dish.is_active.is_(True))
        .order_by(MenuCategory.sort_order, Dish.sort_order, Dish.name)
    )

    overrides = {
        row.dish_id: row
        for row in await session.scalars(
            select(DishPrice).where(
                DishPrice.tenant_id == tenant.id, DishPrice.restaurant_id == restaurant_id
            )
        )
    }
    stopped = set(
        await session.scalars(
            select(StopListEntry.dish_id).where(
                StopListEntry.tenant_id == tenant.id,
                StopListEntry.restaurant_id == restaurant_id,
            )
        )
    )

    result: list[RestaurantDishRead] = []
    for dish, category_name in rows.all():
        override = overrides.get(dish.id)
        result.append(
            RestaurantDishRead(
                dish_id=dish.id,
                name=dish.name,
                category_name=category_name,
                base_price_kopecks=dish.price_kopecks,
                price_kopecks=override.price_kopecks if override else dish.price_kopecks,
                is_available=override.is_available if override else True,
                in_stop_list=dish.id in stopped,
            )
        )
    return result


@router.put("/restaurants/{restaurant_id}/menu", summary="Изменить меню ресторана")
async def update_restaurant_menu(
    restaurant_id: UUID,
    payload: RestaurantDishPatch,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> RestaurantDishRead:
    dish = await session.scalar(
        select(Dish).where(Dish.id == payload.dish_id, Dish.tenant_id == tenant.id)
    )
    if dish is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Блюдо не найдено")

    override = await session.scalar(
        select(DishPrice).where(
            DishPrice.tenant_id == tenant.id,
            DishPrice.restaurant_id == restaurant_id,
            DishPrice.dish_id == payload.dish_id,
        )
    )

    # Своя цена совпала с общей и блюдо продаётся — строка-исключение не нужна
    plain = payload.is_available and payload.price_kopecks in (None, dish.price_kopecks)

    if plain:
        if override is not None:
            await session.delete(override)
    elif override is None:
        session.add(
            DishPrice(
                tenant_id=tenant.id,
                restaurant_id=restaurant_id,
                dish_id=payload.dish_id,
                price_kopecks=payload.price_kopecks or dish.price_kopecks,
                is_available=payload.is_available,
            )
        )
    else:
        override.price_kopecks = payload.price_kopecks or dish.price_kopecks
        override.is_available = payload.is_available

    await session.commit()

    category = await session.scalar(
        select(MenuCategory.name).where(MenuCategory.id == dish.category_id)
    )
    return RestaurantDishRead(
        dish_id=dish.id,
        name=dish.name,
        category_name=category or "",
        base_price_kopecks=dish.price_kopecks,
        price_kopecks=(
            dish.price_kopecks if plain else (payload.price_kopecks or dish.price_kopecks)
        ),
        is_available=payload.is_available,
        in_stop_list=False,
    )


# ─────────────────────── обновление с сайта ───────────────────────


def _sync_read(run: SyncRun, changes: list[SyncChange] | None = None) -> SyncRunRead:
    return SyncRunRead(
        id=run.id,
        kind=run.kind,
        title=KIND_TITLES.get(cast(SyncKind, run.kind), run.kind),
        status=run.status,
        started_at=run.started_at,
        finished_at=run.finished_at,
        applied_at=run.applied_at,
        unchanged=run.unchanged,
        created=run.created,
        updated=run.updated,
        removed=run.removed,
        message=run.message,
        changes=[SyncChangeRead.model_validate(change) for change in (changes or [])],
    )


async def _check_site(run_id: UUID, tenant_id: str, kind: SyncKind) -> None:
    """Читает сайт и складывает предлагаемые изменения. База не меняется."""
    async with SessionLocal() as session:
        run = await session.get(SyncRun, run_id)
        if run is None:
            return

        try:
            plan = await sync_service.plan(kind)
        except Exception as error:
            run.status = "failed"
            run.message = f"{type(error).__name__}: {error}"[:500]
        else:
            for change in plan.changes:
                session.add(
                    SyncChange(
                        tenant_id=tenant_id,
                        run_id=run.id,
                        action=change.action,
                        title=change.title[:200],
                        summary=change.summary[:400],
                        group=change.group,
                        external_id=change.external_id,
                        payload=change.payload,
                        applied=False,
                    )
                )

            run.status = "ready"
            run.unchanged = plan.unchanged
            run.message = "\n".join(plan.notes)[:2000] or None

        run.finished_at = datetime.now(UTC)
        await session.commit()


async def _apply_changes(run_id: UUID, kind: SyncKind, change_ids: list[UUID]) -> None:
    async with SessionLocal() as session:
        run = await session.get(SyncRun, run_id)
        if run is None:
            return

        rows = list(
            await session.scalars(
                select(SyncChange).where(
                    SyncChange.run_id == run_id, SyncChange.id.in_(change_ids)
                )
            )
        )

        try:
            report = await sync_service.apply(
                kind,
                [
                    Change(
                        external_id=row.external_id,
                        title=row.title,
                        action=cast(ChangeAction, row.action),
                        summary=row.summary,
                        payload=dict(row.payload),
                        group=row.group,
                    )
                    for row in rows
                ],
            )
        except Exception as error:
            run.status = "failed"
            run.message = f"{type(error).__name__}: {error}"[:500]
        else:
            run.status = "done"
            run.created = report.created
            run.updated = report.updated
            run.removed = report.removed
            if report.notes:
                run.message = "\n".join(report.notes)[:2000]

            for row in rows:
                row.applied = True

        run.applied_at = datetime.now(UTC)
        await session.commit()


async def _load_run(session: SessionDep, run: SyncRun) -> SyncRunRead:
    changes = list(
        await session.scalars(
            select(SyncChange)
            .where(SyncChange.run_id == run.id)
            .order_by(SyncChange.group, SyncChange.title)
        )
    )
    return _sync_read(run, changes)


@router.get("/sync", summary="Последние сверки с сайтом")
async def sync_runs(session: SessionDep, tenant: TenantDep, staff: StaffDep) -> list[SyncRunRead]:
    latest: list[SyncRunRead] = []

    for kind in KIND_TITLES:
        run = await session.scalar(
            select(SyncRun)
            .where(SyncRun.tenant_id == tenant.id, SyncRun.kind == kind)
            .order_by(SyncRun.started_at.desc())
            .limit(1)
        )
        if run is not None:
            latest.append(await _load_run(session, run))

    return latest


@router.post("/sync/{kind}", summary="Сверить раздел с сайтом")
async def start_sync(
    kind: SyncKind,
    tasks: BackgroundTasks,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> SyncRunRead:
    running = await session.scalar(
        select(SyncRun).where(
            SyncRun.tenant_id == tenant.id,
            SyncRun.kind == kind,
            SyncRun.status.in_(["checking", "applying"]),
        )
    )
    if running is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Эта сверка уже идёт")

    # Прошлый список больше не нужен: сайт мог поменяться
    old = await session.scalars(
        select(SyncRun).where(SyncRun.tenant_id == tenant.id, SyncRun.kind == kind)
    )
    for previous in old:
        await session.delete(previous)

    run = SyncRun(
        tenant_id=tenant.id, kind=kind, status="checking", started_at=datetime.now(UTC)
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)

    tasks.add_task(_check_site, run.id, tenant.id, kind)
    return _sync_read(run)


@router.post("/sync/{run_id}/apply", summary="Записать выбранные изменения")
async def apply_sync(
    run_id: UUID,
    payload: SyncApply,
    tasks: BackgroundTasks,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> SyncRunRead:
    run = await session.scalar(
        select(SyncRun).where(SyncRun.id == run_id, SyncRun.tenant_id == tenant.id)
    )
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сверка не найдена")
    if run.status not in {"ready", "done"}:
        raise HTTPException(status.HTTP_409_CONFLICT, "Список изменений ещё не готов")
    if not payload.change_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Не выбрано ни одного изменения")

    run.status = "applying"
    await session.commit()

    tasks.add_task(_apply_changes, run.id, cast(SyncKind, run.kind), payload.change_ids)
    return await _load_run(session, run)


@router.delete(
    "/sync/{run_id}/changes/{change_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Убрать изменение из списка",
)
async def drop_change(
    run_id: UUID, change_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> None:
    change = await session.scalar(
        select(SyncChange).where(
            SyncChange.id == change_id,
            SyncChange.run_id == run_id,
            SyncChange.tenant_id == tenant.id,
        )
    )
    if change is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Изменение не найдено")

    await session.delete(change)
    await session.commit()


# ─────────────────────────── промокоды ───────────────────────────


@router.get("/promo-codes", summary="Промокоды")
async def promo_codes(
    session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> list[PromoCodeRead]:
    rows = await session.scalars(
        select(PromoCode)
        .where(PromoCode.tenant_id == tenant.id)
        .order_by(PromoCode.is_active.desc(), PromoCode.created_at.desc())
    )
    return [PromoCodeRead.model_validate(row) for row in rows]


@router.post("/promo-codes", status_code=status.HTTP_201_CREATED, summary="Создать промокод")
async def create_promo_code(
    payload: PromoCodeWrite, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> PromoCodeRead:
    code = promo_service.normalize(payload.code)
    exists = await session.scalar(
        select(PromoCode).where(PromoCode.tenant_id == tenant.id, PromoCode.code == code)
    )
    if exists is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Такой промокод уже есть")

    promo = PromoCode(tenant_id=tenant.id, **{**payload.model_dump(), "code": code})
    session.add(promo)
    await session.commit()
    await session.refresh(promo)
    return PromoCodeRead.model_validate(promo)


@router.patch("/promo-codes/{promo_id}", summary="Изменить промокод")
async def update_promo_code(
    promo_id: UUID,
    payload: PromoCodePatch,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> PromoCodeRead:
    promo = await session.scalar(
        select(PromoCode).where(PromoCode.id == promo_id, PromoCode.tenant_id == tenant.id)
    )
    if promo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Промокод не найден")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(promo, field, promo_service.normalize(value) if field == "code" else value)

    await session.commit()
    await session.refresh(promo)
    return PromoCodeRead.model_validate(promo)


@router.delete(
    "/promo-codes/{promo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить промокод",
)
async def delete_promo_code(
    promo_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> None:
    promo = await session.scalar(
        select(PromoCode).where(PromoCode.id == promo_id, PromoCode.tenant_id == tenant.id)
    )
    if promo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Промокод не найден")

    await session.delete(promo)
    await session.commit()


# ─────────────────────────── добавки к блюдам ───────────────────────────


async def _extra_read(session: SessionDep, extra: DishExtra) -> DishExtraAdminRead:
    total = await session.scalar(
        select(func.count())
        .select_from(dish_extra_links)
        .where(dish_extra_links.c.extra_id == extra.id)
    )
    categories = await session.scalars(
        select(category_extra_links.c.category_id).where(
            category_extra_links.c.extra_id == extra.id
        )
    )
    return DishExtraAdminRead(
        id=extra.id,
        name=extra.name,
        price_kopecks=extra.price_kopecks,
        is_active=extra.is_active,
        dishes_count=total or 0,
        category_ids=list(categories),
    )


@router.get("/extras", summary="Справочник добавок")
async def extras(
    session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> list[DishExtraAdminRead]:
    counts = {
        row.extra_id: row.total
        for row in await session.execute(
            select(dish_extra_links.c.extra_id, func.count().label("total")).group_by(
                dish_extra_links.c.extra_id
            )
        )
    }

    sections: dict[UUID, list[UUID]] = {}
    for row in await session.execute(select(category_extra_links)):
        sections.setdefault(row.extra_id, []).append(row.category_id)

    rows = await session.scalars(
        select(DishExtra).where(DishExtra.tenant_id == tenant.id).order_by(DishExtra.name)
    )
    return [
        DishExtraAdminRead(
            id=row.id,
            name=row.name,
            price_kopecks=row.price_kopecks,
            is_active=row.is_active,
            dishes_count=counts.get(row.id, 0),
            category_ids=sections.get(row.id, []),
        )
        for row in rows
    ]


@router.post("/extras", status_code=status.HTTP_201_CREATED, summary="Создать добавку")
async def create_extra(
    payload: DishExtraWrite, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> DishExtraAdminRead:
    extra = DishExtra(tenant_id=tenant.id, **payload.model_dump())
    session.add(extra)
    await session.commit()
    await session.refresh(extra)
    return await _extra_read(session, extra)


@router.patch("/extras/{extra_id}", summary="Изменить добавку")
async def update_extra(
    extra_id: UUID,
    payload: DishExtraPatch,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> DishExtraAdminRead:
    extra = await session.scalar(
        select(DishExtra).where(DishExtra.id == extra_id, DishExtra.tenant_id == tenant.id)
    )
    if extra is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Добавка не найдена")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(extra, field, value)
    await session.commit()
    await session.refresh(extra)
    return await _extra_read(session, extra)


@router.put("/extras/{extra_id}/categories", summary="Разделы, где предлагается добавка")
async def set_extra_categories(
    extra_id: UUID,
    payload: ExtraCategoriesWrite,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> DishExtraAdminRead:
    extra = await session.scalar(
        select(DishExtra).where(DishExtra.id == extra_id, DishExtra.tenant_id == tenant.id)
    )
    if extra is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Добавка не найдена")

    # Привязку к разделу пишем напрямую: коллекция у чужой модели тянет
    # ленивую подгрузку и рвётся на await
    await session.execute(
        delete(category_extra_links).where(category_extra_links.c.extra_id == extra.id)
    )
    if payload.category_ids:
        rows = await session.scalars(
            select(MenuCategory.id).where(
                MenuCategory.tenant_id == tenant.id, MenuCategory.id.in_(payload.category_ids)
            )
        )
        links = [{"category_id": category_id, "extra_id": extra.id} for category_id in rows]
        if links:
            await session.execute(insert(category_extra_links), links)

    await session.commit()
    return await _extra_read(session, extra)


@router.delete(
    "/extras/{extra_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить добавку"
)
async def delete_extra(
    extra_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> None:
    extra = await session.scalar(
        select(DishExtra).where(DishExtra.id == extra_id, DishExtra.tenant_id == tenant.id)
    )
    if extra is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Добавка не найдена")

    await session.delete(extra)
    await session.commit()


# --- Уведомления -------------------------------------------------------------


@router.get("/notifications/rules", summary="Правила уведомлений по шагам заказа")
async def notification_rules(
    session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> list[RuleRead]:
    """Что сохранено в базе плюс заготовки для шагов, которых там ещё нет."""
    saved = list(
        await session.scalars(
            select(NotificationRule).where(NotificationRule.tenant_id == tenant.id)
        )
    )
    known = {(row.restaurant_id, row.event) for row in saved}
    result = [RuleRead.model_validate(row) for row in saved]

    for event, (enabled, title, body) in push_service.DEFAULT_RULES.items():
        if (None, event.value) in known:
            continue
        result.append(
            RuleRead(event=event.value, is_enabled=enabled, title=title, body=body)
        )

    # Порядок шагов заказа, а не алфавитный: менеджер читает их сверху вниз
    order = [event.value for event in push_service.DEFAULT_RULES]
    result.sort(key=lambda row: order.index(row.event) if row.event in order else len(order))
    return result


@router.put("/notifications/rules", summary="Изменить правило шага")
async def save_notification_rule(
    payload: RuleWrite, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> RuleRead:
    rule = await session.scalar(
        select(NotificationRule).where(
            NotificationRule.tenant_id == tenant.id,
            NotificationRule.event == payload.event,
            NotificationRule.restaurant_id.is_(payload.restaurant_id)
            if payload.restaurant_id is None
            else NotificationRule.restaurant_id == payload.restaurant_id,
        )
    )

    if rule is None:
        rule = NotificationRule(
            tenant_id=tenant.id, event=payload.event, restaurant_id=payload.restaurant_id
        )
        session.add(rule)

    rule.is_enabled = payload.is_enabled
    rule.title = payload.title
    rule.body = payload.body

    await session.commit()
    await session.refresh(rule)
    return RuleRead.model_validate(rule)


@router.get("/notifications/hours", summary="Тихие часы и частота рассылок")
async def notification_hours(
    session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> HoursRead:
    hours = await session.scalar(
        select(NotificationHours).where(
            NotificationHours.tenant_id == tenant.id, NotificationHours.restaurant_id.is_(None)
        )
    )
    if hours is None:
        return HoursRead(quiet_from=time(22, 0), quiet_to=time(10, 0), weekly_limit=2)

    return HoursRead.model_validate(hours)


@router.put("/notifications/hours", summary="Изменить тихие часы")
async def save_notification_hours(
    payload: HoursWrite, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> HoursRead:
    hours = await session.scalar(
        select(NotificationHours).where(
            NotificationHours.tenant_id == tenant.id, NotificationHours.restaurant_id.is_(None)
        )
    )
    if hours is None:
        hours = NotificationHours(tenant_id=tenant.id)
        session.add(hours)

    hours.quiet_from = payload.quiet_from
    hours.quiet_to = payload.quiet_to
    hours.weekly_limit = payload.weekly_limit

    await session.commit()
    await session.refresh(hours)
    return HoursRead.model_validate(hours)


@router.get("/campaigns", summary="Рассылки")
async def campaigns(session: SessionDep, tenant: TenantDep, staff: StaffDep) -> list[CampaignRead]:
    rows = await session.scalars(
        select(Campaign).where(Campaign.tenant_id == tenant.id).order_by(Campaign.created_at.desc())
    )
    return [CampaignRead.model_validate(row) for row in rows]


@router.post("/campaigns", status_code=status.HTTP_201_CREATED, summary="Создать рассылку")
async def create_campaign(
    payload: CampaignWrite, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> CampaignRead:
    campaign = Campaign(tenant_id=tenant.id, **payload.model_dump())

    # Охват считаем сразу: менеджеру важно видеть его и у черновика
    campaign.planned_count = await campaign_service.preview_size(
        session, tenant, campaign.audience
    )
    # Указано время — рассылка ждёт его, иначе остаётся черновиком
    if campaign.scheduled_at is not None:
        campaign.status = CampaignStatus.SCHEDULED

    session.add(campaign)
    await session.commit()
    await session.refresh(campaign)
    return CampaignRead.model_validate(campaign)


@router.patch("/campaigns/{campaign_id}", summary="Изменить рассылку")
async def update_campaign(
    campaign_id: UUID,
    payload: CampaignWrite,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> CampaignRead:
    campaign = await session.scalar(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.tenant_id == tenant.id)
    )
    if campaign is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Рассылка не найдена")

    for field, value in payload.model_dump().items():
        setattr(campaign, field, value)

    campaign.planned_count = await campaign_service.preview_size(
        session, tenant, campaign.audience
    )

    if campaign.status in (CampaignStatus.DRAFT, CampaignStatus.SCHEDULED):
        campaign.status = (
            CampaignStatus.SCHEDULED if campaign.scheduled_at else CampaignStatus.DRAFT
        )

    await session.commit()
    await session.refresh(campaign)
    return CampaignRead.model_validate(campaign)


@router.post("/campaigns/audience", summary="Сколько гостей попадёт в рассылку")
async def campaign_audience(
    payload: AudienceQuery, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> dict[str, int]:
    """Не только число, но и разбор: почему остальные не получат."""
    return await campaign_service.reach_report(session, tenant, payload.audience)


@router.post("/campaigns/{campaign_id}/send", summary="Отправить рассылку сейчас")
async def send_campaign_now(
    campaign_id: UUID,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    force: Annotated[bool, Query()] = False,
) -> CampaignRead:
    campaign = await session.scalar(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.tenant_id == tenant.id)
    )
    if campaign is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Рассылка не найдена")

    await campaign_service.send_campaign(session, tenant, campaign, force=force)
    await session.refresh(campaign)
    return CampaignRead.model_validate(campaign)


@router.get("/automations", summary="Сценарии")
async def automations(
    session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> list[AutomationRead]:
    rows = await session.scalars(
        select(Automation).where(Automation.tenant_id == tenant.id).order_by(Automation.trigger)
    )
    return [AutomationRead.model_validate(row) for row in rows]


@router.put("/automations", summary="Изменить сценарий")
async def save_automation(
    payload: AutomationWrite, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> AutomationRead:
    rule = await session.scalar(
        select(Automation).where(
            Automation.tenant_id == tenant.id, Automation.trigger == payload.trigger
        )
    )
    if rule is None:
        rule = Automation(tenant_id=tenant.id, trigger=TriggerKind(payload.trigger))
        session.add(rule)

    rule.is_enabled = payload.is_enabled
    rule.title = payload.title
    rule.body = payload.body
    rule.target = payload.target
    rule.params = payload.params

    await session.commit()
    await session.refresh(rule)
    return AutomationRead.model_validate(rule)
