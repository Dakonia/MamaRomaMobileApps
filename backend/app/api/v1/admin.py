import secrets
from datetime import UTC, date, datetime, time
from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile, status
from sqlalchemy import delete, func, insert, literal_column, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import SessionDep, StaffDep, TenantDep
from app.core import cache
from app.core.config import settings
from app.core.db import SessionLocal
from app.core.security import create_token, hash_password, normalize_phone, verify_password
from app.core.tenants import Tenant
from app.models.enums import (
    CampaignStatus,
    IikoHandoffStatus,
    LoyaltyOperation,
    OrderStatus,
    OrderType,
    ReservationStatus,
    TriggerKind,
)
from app.models.feedback import OrderFeedback
from app.models.geo import City, DeliveryZone, Restaurant
from app.models.guest import Guest, GuestAddress
from app.models.integration import IikoBridge, IikoLink, IikoOrderHandoff, IikoProduct
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
    BridgeRow,
    BridgeSecret,
    BridgeToggle,
    CampaignRead,
    CampaignWrite,
    CategoryAdminRead,
    CategoryPatch,
    CategoryWrite,
    CopyLinksResult,
    DishAdminRead,
    DishExtraAdminRead,
    DishExtraPatch,
    DishExtraWrite,
    DishPatch,
    DishWrite,
    ExtraCategoriesWrite,
    ExtraDishesWrite,
    FeedbackRow,
    FeedbackSummary,
    GuestAdminRead,
    GuestCardRead,
    GuestFeedbackRead,
    GuestOrderItemRead,
    GuestOrderRead,
    GuestPatch,
    GuestPointsAdjust,
    GuestPointsRead,
    GuestReservationRead,
    GuestWrite,
    HandoffRow,
    HoursRead,
    HoursWrite,
    IikoProductRow,
    LinkBatch,
    LinkRow,
    MatchResult,
    MenuBranchRow,
    MenuTreeRead,
    MenuTreeWrite,
    OrderCard,
    OrderCardItem,
    OrderItemsWrite,
    OrderPage,
    OrderRow,
    OrderStatusWrite,
    ProductGroupRow,
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
from app.schemas.integration import SyncResult
from app.schemas.promotion import (
    PromotionAdminRead,
    PromotionPatch,
    PromotionWrite,
)
from app.schemas.reservation import ReservationRead
from app.schemas.sync import SyncApply, SyncChangeRead, SyncRunRead
from app.services import campaign as campaign_service
from app.services import guest as guest_service
from app.services import iiko_bridge
from app.services import loyalty as loyalty_service
from app.services import media as media_service
from app.services import order as order_service
from app.services import promo_code as promo_service
from app.services import promotions as promotion_service
from app.services import push as push_service
from app.services import reservation as reservation_service
from app.services import sync as sync_service
from app.services.sync import KIND_TITLES, Change, ChangeAction, SyncKind

# Хеш-заглушка для несуществующей почты: сверять с ним столько же долго,
# сколько с настоящим паролем
DUMMY_HASH = hash_password("no-such-account")

router = APIRouter(prefix="/admin", tags=["Админка"])


@router.post("/login", summary="Вход сотрудника")
async def login(payload: StaffLogin, session: SessionDep, tenant: TenantDep) -> StaffSession:
    email = payload.email.strip().lower()
    attempts_key = f"staff-login:{tenant.id}:{email}"

    # Перебор пароля останавливаем по числу попыток на учётную запись
    attempts = await cache.hits(attempts_key, settings.staff_login_window_seconds)
    if attempts > settings.staff_login_attempts:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Слишком много попыток входа. Попробуйте через несколько минут",
        )

    staff = await session.scalar(
        select(StaffUser).where(StaffUser.tenant_id == tenant.id, StaffUser.email == email)
    )

    # Пароль сверяем даже для несуществующей почты: иначе ответ на чужой адрес
    # приходит заметно быстрее, и по времени ответа можно собрать список
    # заведённых учётных записей
    correct = verify_password(payload.password, staff.password_hash if staff else DUMMY_HASH)

    if staff is None or not staff.is_active or not correct:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверная почта или пароль")

    await cache.forget(attempts_key)

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


# Какие состояния попадают в каждую вкладку списка
ORDER_GROUPS: dict[str, list[OrderStatus]] = {
    "active": [
        OrderStatus.CREATED,
        OrderStatus.PAID,
        OrderStatus.ACCEPTED,
        OrderStatus.COOKING,
        OrderStatus.READY,
        OrderStatus.DELIVERING,
    ],
    "done": [OrderStatus.COMPLETED],
    "cancelled": [OrderStatus.CANCELLED],
}


@router.get("/orders", summary="Заказы сети")
async def orders(
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    group: Annotated[str, Query(pattern="^(active|done|cancelled|all)$")] = "active",
    restaurant_id: Annotated[UUID | None, Query()] = None,
    order_type: Annotated[OrderType | None, Query()] = None,
    search: Annotated[str, Query(max_length=60)] = "",
    date_from: Annotated[date | None, Query()] = None,
    date_to: Annotated[date | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> OrderPage:
    """Список заказов постранично, со счётчиками по вкладкам.

    Сеть растёт до двадцати пяти ресторанов, и «все заказы одним списком» здесь
    не живут: за день их станут тысячи. Поэтому и отбор, и счёт строк, и число
    позиций считает база, а не приложение.
    """
    positions = (
        select(func.count(OrderItem.id))
        .where(OrderItem.order_id == Order.id)
        .correlate(Order)
        .scalar_subquery()
    )

    query = (
        select(Order, Guest.name, Guest.phone, Restaurant.name, positions)
        .join(Guest, Guest.id == Order.guest_id)
        .join(Restaurant, Restaurant.id == Order.restaurant_id)
        .where(Order.tenant_id == tenant.id)
    )

    # Условия, общие для вкладок: по ним же считаются счётчики
    if restaurant_id is not None:
        query = query.where(Order.restaurant_id == restaurant_id)
    if order_type is not None:
        query = query.where(Order.type == order_type)
    if date_from is not None:
        query = query.where(Order.created_at >= datetime.combine(date_from, time.min, UTC))
    if date_to is not None:
        query = query.where(Order.created_at < datetime.combine(date_to, time.max, UTC))

    if search.strip():
        needle = f"%{search.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(Order.number).like(needle),
                func.lower(Order.contact_phone).like(needle),
                func.lower(Guest.phone).like(needle),
                func.lower(Guest.name).like(needle),
                func.lower(Order.address_text).like(needle),
            )
        )

    counts_rows = await session.execute(
        select(Order.status, func.count())
        .select_from(query.subquery().alias("filtered"))
        .join(Order, Order.id == literal_column("filtered.id"))
        .group_by(Order.status)
    )
    by_status = {status.value: count for status, count in counts_rows.all()}

    counts = {
        name: sum(by_status.get(status.value, 0) for status in statuses)
        for name, statuses in ORDER_GROUPS.items()
    }
    counts["all"] = sum(by_status.values())
    # Плюс разбивка по состояниям: панели нужны «готовы» и «в пути» по всей
    # сети, а не по той полусотне строк, что уместилась на экране
    counts.update({status.value: by_status.get(status.value, 0) for status in OrderStatus})

    if group != "all":
        query = query.where(Order.status.in_(ORDER_GROUPS[group]))

    rows = (
        await session.execute(
            query.order_by(Order.created_at.desc()).limit(limit).offset(offset)
        )
    ).all()

    return OrderPage(
        total=counts[group],
        counts=counts,
        rows=[
            OrderRow(
                id=order.id,
                number=order.number,
                status=order.status,
                type=order.type,
                created_at=order.created_at,
                delivery_at=order.delivery_at,
                completed_at=order.completed_at,
                restaurant_id=order.restaurant_id,
                restaurant_name=restaurant_name,
                guest_name=guest_name,
                guest_phone=guest_phone,
                address_text=order.address_text,
                total_kopecks=order.total_kopecks,
                points_spent=order.points_spent,
                payment_method=order.payment_method,
                payment_status=order.payment_status,
                positions=count,
                cancel_reason=order.cancel_reason,
                iiko_status=order.iiko_status,
                iiko_courier_name=order.iiko_courier_name,
                items_changed=order.iiko_items_changed_at is not None,
            )
            for order, guest_name, guest_phone, restaurant_name, count in rows
        ],
    )


async def _order_card(session: AsyncSession, tenant: Tenant, order: Order) -> OrderCard:
    """Собирает карточку заказа для панели.

    Гость и его баллы здесь не роскошь: оператор правит состав, разговаривая с
    ним по телефону, и должен видеть, чем этот разговор кончится для баланса.
    """
    guest = await session.get(Guest, order.guest_id)
    account = await session.scalar(
        select(LoyaltyAccount).where(
            LoyaltyAccount.tenant_id == tenant.id, LoyaltyAccount.guest_id == order.guest_id
        )
    )
    orders_count = await session.scalar(
        select(func.count(Order.id)).where(
            Order.tenant_id == tenant.id,
            Order.guest_id == order.guest_id,
            Order.status == OrderStatus.COMPLETED,
        )
    )

    return OrderCard(
        id=order.id,
        number=order.number,
        status=order.status,
        type=order.type,
        created_at=order.created_at,
        delivery_at=order.delivery_at,
        completed_at=order.completed_at,
        restaurant_id=order.restaurant_id,
        restaurant_name=order.restaurant.name,
        restaurant_phone=order.restaurant.phone,
        guest_id=order.guest_id,
        guest_name=guest.name if guest else None,
        guest_phone=guest.phone if guest else order.contact_phone,
        contact_phone=order.contact_phone,
        guest_points_balance=account.points_balance if account else 0,
        guest_orders_count=orders_count or 0,
        address_text=order.address_text,
        comment=order.comment,
        cancel_reason=order.cancel_reason,
        persons_count=order.persons_count,
        change_from_kopecks=order.change_from_kopecks,
        payment_method=order.payment_method,
        payment_status=order.payment_status,
        subtotal_kopecks=order.subtotal_kopecks,
        delivery_kopecks=order.delivery_kopecks,
        cutlery_kopecks=order.cutlery_kopecks,
        promo_code=order.promo_code,
        promo_discount_kopecks=order.promo_discount_kopecks,
        discount_kopecks=order.discount_kopecks,
        total_kopecks=order.total_kopecks,
        points_spent=order.points_spent,
        points_earned=order.points_earned,
        iiko_status=order.iiko_status,
        iiko_courier_name=order.iiko_courier_name,
        iiko_problem_comment=order.iiko_problem_comment,
        iiko_items_changed_at=order.iiko_items_changed_at,
        items=[OrderCardItem.model_validate(item) for item in order.items],
        changes=await iiko_bridge.describe_changes(session, tenant, order),
        editable=order.status not in (OrderStatus.COMPLETED, OrderStatus.CANCELLED),
    )


@router.get("/orders/{order_id}", summary="Карточка заказа")
async def order_card(
    order_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> OrderCard:
    order = await session.scalar(
        select(Order).where(Order.id == order_id, Order.tenant_id == tenant.id)
    )
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заказ не найден")

    return await _order_card(session, tenant, order)


@router.put("/orders/{order_id}/items", summary="Изменить состав заказа")
async def edit_order_items(
    order_id: UUID,
    payload: OrderItemsWrite,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> OrderCard:
    """Правка состава оператором: снять блюдо, изменить количество, добавить.

    Закрытые заказы не трогаем: там уже сошлись деньги и баллы, и менять состав
    задним числом означало бы переписывать историю.
    """
    order = await session.scalar(
        select(Order).where(Order.id == order_id, Order.tenant_id == tenant.id)
    )
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заказ не найден")

    if order.status in (OrderStatus.COMPLETED, OrderStatus.CANCELLED):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Заказ уже закрыт — состав менять нельзя"
        )

    account = await session.scalar(
        select(LoyaltyAccount).where(
            LoyaltyAccount.tenant_id == tenant.id, LoyaltyAccount.guest_id == order.guest_id
        )
    )
    percent = (
        loyalty_service.tier_by_code(tenant, account.tier_code).cashback_percent if account else 0
    )

    try:
        await order_service.edit_items(
            session,
            tenant,
            order,
            {item.dish_id: item.quantity for item in payload.items},
            percent,
        )
    except order_service.OrderError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    await session.commit()
    await session.refresh(order)

    return await _order_card(session, tenant, order)


@router.patch("/orders/{order_id}", summary="Сменить статус заказа")
async def set_order_status(
    order_id: UUID,
    payload: OrderStatusWrite,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> OrderCard:
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

    return await _order_card(session, tenant, order)


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
            func.max(Order.created_at).label("last_order_at"),
        )
        .where(Order.tenant_id == tenant.id)
        .group_by(Order.guest_id)
        .subquery()
    )

    feedbacks = (
        select(
            OrderFeedback.guest_id.label("guest_id"),
            func.count(OrderFeedback.id).label("feedback_count"),
            func.avg(OrderFeedback.rating).label("average_rating"),
        )
        .where(OrderFeedback.tenant_id == tenant.id)
        .group_by(OrderFeedback.guest_id)
        .subquery()
    )

    query = (
        select(
            Guest,
            orders.c.orders_count,
            orders.c.spent,
            orders.c.last_order_at,
            feedbacks.c.feedback_count,
            feedbacks.c.average_rating,
            LoyaltyAccount,
        )
        .outerjoin(orders, orders.c.guest_id == Guest.id)
        .outerjoin(feedbacks, feedbacks.c.guest_id == Guest.id)
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
    for (
        guest,
        orders_count,
        spent,
        last_order_at,
        feedback_count,
        average_rating,
        account,
    ) in rows.all():
        card = GuestAdminRead.model_validate(guest)
        card.orders_count = orders_count or 0
        card.spent_kopecks = spent or 0
        card.last_order_at = last_order_at
        card.feedback_count = feedback_count or 0
        card.average_rating = float(average_rating) if average_rating is not None else None
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
    order_pairs = list(order_rows.all())
    order_ids = [order.id for order, _restaurant_name in order_pairs]

    items_by_order: dict[UUID, list[GuestOrderItemRead]] = {order_id: [] for order_id in order_ids}
    if order_ids:
        item_rows = await session.scalars(
            select(OrderItem)
            .where(OrderItem.tenant_id == tenant.id, OrderItem.order_id.in_(order_ids))
            .order_by(OrderItem.created_at, OrderItem.name)
        )
        for item in item_rows:
            extras: list[str] = []
            for extra in item.extras or []:
                if isinstance(extra, dict):
                    name = extra.get("name")
                    if name:
                        extras.append(str(name))
                else:
                    extras.append(str(extra))
            items_by_order.setdefault(item.order_id, []).append(
                GuestOrderItemRead(
                    id=item.id,
                    name=item.name,
                    quantity=item.quantity,
                    total_kopecks=item.total_kopecks,
                    extras=extras,
                )
            )

    feedback_rows = await session.execute(
        select(OrderFeedback, Order.number, Restaurant.name)
        .join(Order, Order.id == OrderFeedback.order_id)
        .join(Restaurant, Restaurant.id == OrderFeedback.restaurant_id)
        .where(OrderFeedback.tenant_id == tenant.id, OrderFeedback.guest_id == guest_id)
        .order_by(OrderFeedback.created_at.desc())
        .limit(50)
    )
    feedbacks = [
        GuestFeedbackRead(
            id=feedback.id,
            order_id=feedback.order_id,
            order_number=order_number,
            restaurant_name=restaurant_name,
            rating=feedback.rating,
            tags=feedback.tags or [],
            comment=feedback.comment,
            created_at=feedback.created_at,
        )
        for feedback, order_number, restaurant_name in feedback_rows.all()
    ]
    feedback_by_order_id = {feedback.order_id: feedback for feedback in feedbacks}

    orders: list[GuestOrderRead] = []
    for order, restaurant_name in order_pairs:
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
                delivery_kopecks=order.delivery_kopecks,
                discount_kopecks=order.discount_kopecks,
                points_spent=order.points_spent,
                points_earned=order.points_earned,
                promo_code=order.promo_code,
                persons_count=order.persons_count,
                comment=order.comment,
                items=items_by_order.get(order.id, []),
                feedback=feedback_by_order_id.get(order.id),
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

    order_count, order_spent, last_order_at = (
        await session.execute(
            select(
                func.count(Order.id),
                func.coalesce(func.sum(Order.total_kopecks), 0),
                func.max(Order.created_at),
            ).where(Order.tenant_id == tenant.id, Order.guest_id == guest_id)
        )
    ).one()
    feedback_count, average_rating = (
        await session.execute(
            select(func.count(OrderFeedback.id), func.avg(OrderFeedback.rating)).where(
                OrderFeedback.tenant_id == tenant.id,
                OrderFeedback.guest_id == guest_id,
            )
        )
    ).one()

    card = GuestAdminRead.model_validate(guest)
    card.orders_count = order_count or 0
    card.spent_kopecks = order_spent or 0
    card.last_order_at = last_order_at
    card.feedback_count = feedback_count or 0
    card.average_rating = float(average_rating) if average_rating is not None else None
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
        feedbacks=feedbacks,
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


@router.post("/guests/{guest_id}/points", summary="Начислить или списать баллы")
async def adjust_guest_points(
    guest_id: UUID,
    payload: GuestPointsAdjust,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> GuestPointsRead:
    await _guest_or_404(session, tenant, guest_id)
    if payload.points == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Укажите количество баллов")

    account = await loyalty_service.get_account(session, tenant, guest_id)
    if account is None:
        account = await loyalty_service.open_account(session, tenant, guest_id)

    balance_after = account.points_balance + payload.points
    if balance_after < 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя списать больше текущего баланса")

    account.points_balance = balance_after
    transaction = LoyaltyTransaction(
        tenant_id=tenant.id,
        account_id=account.id,
        operation=LoyaltyOperation.MANUAL,
        points=payload.points,
        balance_after=balance_after,
        comment=payload.comment
        or ("Ручное начисление в админке" if payload.points > 0 else "Ручное списание в админке"),
    )
    session.add(transaction)
    await session.commit()
    await session.refresh(transaction)
    return GuestPointsRead(
        created_at=transaction.created_at,
        operation=transaction.operation.value,
        points=transaction.points,
        comment=transaction.comment,
    )


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
    dishes = await session.execute(
        select(
            Dish.id,
            Dish.name,
            Dish.category_id,
            Dish.is_active,
            MenuCategory.name.label("category_name"),
        )
        .join(dish_extra_links, dish_extra_links.c.dish_id == Dish.id)
        .join(MenuCategory, MenuCategory.id == Dish.category_id)
        .where(dish_extra_links.c.extra_id == extra.id, Dish.tenant_id == extra.tenant_id)
        .order_by(MenuCategory.sort_order, Dish.sort_order, Dish.name)
    )
    return DishExtraAdminRead(
        id=extra.id,
        name=extra.name,
        price_kopecks=extra.price_kopecks,
        is_active=extra.is_active,
        dishes_count=total or 0,
        category_ids=list(categories),
        linked_dishes=[
            {
                "id": row.id,
                "name": row.name,
                "category_id": row.category_id,
                "category_name": row.category_name,
                "is_active": row.is_active,
            }
            for row in dishes
        ],
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

    linked_dishes: dict[UUID, list[dict[str, object]]] = {}
    linked_rows = await session.execute(
        select(
            dish_extra_links.c.extra_id,
            Dish.id,
            Dish.name,
            Dish.category_id,
            Dish.is_active,
            MenuCategory.name.label("category_name"),
        )
        .join(Dish, Dish.id == dish_extra_links.c.dish_id)
        .join(MenuCategory, MenuCategory.id == Dish.category_id)
        .where(Dish.tenant_id == tenant.id)
        .order_by(MenuCategory.sort_order, Dish.sort_order, Dish.name)
    )
    for row in linked_rows:
        linked_dishes.setdefault(row.extra_id, []).append(
            {
                "id": row.id,
                "name": row.name,
                "category_id": row.category_id,
                "category_name": row.category_name,
                "is_active": row.is_active,
            }
        )

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
            linked_dishes=linked_dishes.get(row.id, []),
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


@router.put("/extras/{extra_id}/dishes", summary="Блюда, где предлагается добавка")
async def set_extra_dishes(
    extra_id: UUID,
    payload: ExtraDishesWrite,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> DishExtraAdminRead:
    extra = await session.scalar(
        select(DishExtra).where(DishExtra.id == extra_id, DishExtra.tenant_id == tenant.id)
    )
    if extra is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Добавка не найдена")

    dish_ids = list(dict.fromkeys(payload.dish_ids))
    if dish_ids:
        existing = set(
            await session.scalars(
                select(Dish.id).where(Dish.tenant_id == tenant.id, Dish.id.in_(dish_ids))
            )
        )
        if set(dish_ids) - existing:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Часть блюд не найдена")

    await session.execute(delete(dish_extra_links).where(dish_extra_links.c.extra_id == extra.id))
    if dish_ids:
        await session.execute(
            insert(dish_extra_links),
            [{"dish_id": dish_id, "extra_id": extra.id} for dish_id in dish_ids],
        )

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

        pickup = push_service.PICKUP_RULES.get(event)
        result.append(
            RuleRead(
                event=event.value,
                is_enabled=enabled,
                title=title,
                body=body,
                pickup_enabled=pickup[0] if pickup else None,
                pickup_title=pickup[1] if pickup else None,
                pickup_body=pickup[2] if pickup else None,
            )
        )

    # События вне цепочки этапов: правка состава на кассе. Правятся там же,
    # где шаги заказа — менеджеру всё равно, как это устроено внутри
    for event_name, (enabled, title, body) in push_service.DEFAULT_EVENT_RULES.items():
        if (None, event_name) in known:
            continue
        result.append(
            RuleRead(event=event_name, is_enabled=enabled, title=title, body=body)
        )

    # Порядок шагов заказа, а не алфавитный: менеджер читает их сверху вниз
    order = [event.value for event in push_service.DEFAULT_RULES]
    order += list(push_service.DEFAULT_EVENT_RULES)
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


@router.delete(
    "/campaigns/{campaign_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить рассылку",
)
async def delete_campaign(
    campaign_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> None:
    campaign = await session.scalar(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.tenant_id == tenant.id)
    )
    if campaign is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Рассылка не найдена")

    await session.delete(campaign)
    await session.commit()


@router.post(
    "/campaigns/{campaign_id}/copy",
    status_code=status.HTTP_201_CREATED,
    summary="Копия рассылки",
)
async def copy_campaign(
    campaign_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> CampaignRead:
    """Копия — черновик: удобно повторить прошлую рассылку с новым текстом."""
    source = await session.scalar(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.tenant_id == tenant.id)
    )
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Рассылка не найдена")

    copy = Campaign(
        tenant_id=tenant.id,
        name=f"{source.name} — копия",
        title=source.title,
        body=source.body,
        image_url=source.image_url,
        kind=source.kind,
        target=dict(source.target or {}),
        audience=dict(source.audience or {}),
        planned_count=source.planned_count,
    )
    session.add(copy)
    await session.commit()
    await session.refresh(copy)

    return CampaignRead.model_validate(copy)


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


# --- Отзывы ------------------------------------------------------------------


@router.get("/feedback", summary="Отзывы о заказах")
async def feedback(
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    restaurant_id: Annotated[UUID | None, Query()] = None,
    max_rating: Annotated[int | None, Query(ge=1, le=5)] = None,
) -> list[FeedbackRow]:
    """Свежие сверху: жалобу оператор должен увидеть первой."""
    query = (
        select(OrderFeedback, Order, Restaurant, Guest)
        .join(Order, Order.id == OrderFeedback.order_id)
        .join(Restaurant, Restaurant.id == OrderFeedback.restaurant_id)
        .join(Guest, Guest.id == OrderFeedback.guest_id)
        .where(OrderFeedback.tenant_id == tenant.id)
        .order_by(OrderFeedback.created_at.desc())
        .limit(200)
    )

    if restaurant_id is not None:
        query = query.where(OrderFeedback.restaurant_id == restaurant_id)
    if max_rating is not None:
        query = query.where(OrderFeedback.rating <= max_rating)

    return [
        FeedbackRow(
            id=row.id,
            order_id=order.id,
            order_number=order.number,
            restaurant_name=restaurant.name,
            guest_name=order.contact_name or guest.name,
            guest_phone=order.contact_phone or guest.phone,
            guest_deleted=guest.deleted_at is not None,
            contact_erased=guest.deleted_at is not None and not order.contact_phone,
            rating=row.rating,
            tags=row.tags or [],
            comment=row.comment,
            created_at=row.created_at,
        )
        for row, order, restaurant, guest in (await session.execute(query)).all()
    ]


@router.get("/feedback/summary", summary="Сводка по оценкам")
async def feedback_summary(
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    restaurant_id: Annotated[UUID | None, Query()] = None,
) -> FeedbackSummary:
    query = select(OrderFeedback.rating).where(OrderFeedback.tenant_id == tenant.id)
    if restaurant_id is not None:
        query = query.where(OrderFeedback.restaurant_id == restaurant_id)

    ratings = list(await session.scalars(query))
    counts = {str(star): ratings.count(star) for star in range(1, 6)}

    return FeedbackSummary(
        average=round(sum(ratings) / len(ratings), 2) if ratings else 0.0,
        total=len(ratings),
        by_rating=counts,
    )


# ─────────────────────────── касса iiko ───────────────────────────


@router.get("/iiko/bridges", summary="Плагины по ресторанам")
async def iiko_bridges(session: SessionDep, tenant: TenantDep, staff: StaffDep) -> list[BridgeRow]:
    """Список всех точек: где плагин заведён, где молчит, сколько сопоставлено."""
    restaurants = list(
        await session.scalars(
            select(Restaurant)
            .where(Restaurant.tenant_id == tenant.id, Restaurant.is_active.is_(True))
            .order_by(Restaurant.name)
        )
    )

    bridges = {
        bridge.restaurant_id: bridge
        for bridge in await session.scalars(
            select(IikoBridge).where(IikoBridge.tenant_id == tenant.id)
        )
    }

    counters = await _iiko_counters(session, tenant.id)

    return [
        BridgeRow(
            restaurant_id=restaurant.id,
            restaurant_name=restaurant.name,
            is_registered=restaurant.id in bridges,
            is_active=bridges[restaurant.id].is_active if restaurant.id in bridges else False,
            last_seen_at=bridges[restaurant.id].last_seen_at if restaurant.id in bridges else None,
            plugin_version=(
                bridges[restaurant.id].plugin_version if restaurant.id in bridges else None
            ),
            terminal_name=(
                bridges[restaurant.id].terminal_name if restaurant.id in bridges else None
            ),
            **counters.get(restaurant.id, _EMPTY_COUNTERS),
        )
        for restaurant in restaurants
    ]


_EMPTY_COUNTERS = {
    "linked_dishes": 0,
    "linked_extras": 0,
    "unlinked_dishes": 0,
    "products": 0,
    "pending_orders": 0,
    "failed_orders": 0,
}


async def _iiko_counters(session: SessionDep, tenant_id: str) -> dict[UUID, dict[str, int]]:
    """Считает всё одним проходом на ресторан, а не запросом на строку таблицы."""
    counters: dict[UUID, dict[str, int]] = {}

    def slot(restaurant_id: UUID) -> dict[str, int]:
        return counters.setdefault(restaurant_id, dict(_EMPTY_COUNTERS))

    links = await session.execute(
        select(
            IikoLink.restaurant_id,
            func.count(IikoLink.dish_id),
            func.count(IikoLink.extra_id),
        )
        .where(IikoLink.tenant_id == tenant_id)
        .group_by(IikoLink.restaurant_id)
    )
    for restaurant_id, dishes, extras in links:
        slot(restaurant_id)["linked_dishes"] = dishes
        slot(restaurant_id)["linked_extras"] = extras

    # Сколько блюд активного меню ещё без товара кассы: именно на них
    # заказ гостя упрётся, и знать об этом надо заранее
    total_dishes = await session.scalar(
        select(func.count())
        .select_from(Dish)
        .join(MenuCategory, MenuCategory.id == Dish.category_id)
        .where(
            Dish.tenant_id == tenant_id,
            Dish.is_active.is_(True),
            MenuCategory.is_active.is_(True),
        )
    )
    for row in counters.values():
        row["unlinked_dishes"] = max(0, (total_dishes or 0) - row["linked_dishes"])

    products = await session.execute(
        select(IikoProduct.restaurant_id, func.count())
        .where(IikoProduct.tenant_id == tenant_id)
        .group_by(IikoProduct.restaurant_id)
    )
    for restaurant_id, total in products:
        slot(restaurant_id)["products"] = total

    handoffs = await session.execute(
        select(IikoOrderHandoff.restaurant_id, IikoOrderHandoff.status, func.count())
        .where(IikoOrderHandoff.tenant_id == tenant_id)
        .group_by(IikoOrderHandoff.restaurant_id, IikoOrderHandoff.status)
    )
    for restaurant_id, status_value, total in handoffs:
        if status_value is IikoHandoffStatus.FAILED:
            slot(restaurant_id)["failed_orders"] = total
        elif status_value in (IikoHandoffStatus.PENDING, IikoHandoffStatus.SENT):
            slot(restaurant_id)["pending_orders"] += total

    return counters


@router.post("/iiko/bridges/{restaurant_id}/secret", summary="Выдать или сменить ключ плагина")
async def iiko_secret(
    restaurant_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> BridgeSecret:
    """Новый ключ этой точки. Показываем один раз — сохранить его в настройках плагина."""
    restaurant = await session.scalar(
        select(Restaurant).where(
            Restaurant.id == restaurant_id, Restaurant.tenant_id == tenant.id
        )
    )
    if restaurant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ресторан не найден")

    secret = secrets.token_urlsafe(32)

    bridge = await session.scalar(
        select(IikoBridge).where(
            IikoBridge.tenant_id == tenant.id, IikoBridge.restaurant_id == restaurant_id
        )
    )
    if bridge is None:
        bridge = IikoBridge(tenant_id=tenant.id, restaurant_id=restaurant_id, secret=secret)
        session.add(bridge)
    else:
        bridge.secret = secret
        bridge.is_active = True

    await session.commit()
    return BridgeSecret(restaurant_id=restaurant_id, secret=secret)


@router.patch("/iiko/bridges/{restaurant_id}", summary="Включить или выключить плагин точки")
async def iiko_toggle(
    restaurant_id: UUID,
    payload: BridgeToggle,
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
) -> BridgeToggle:
    bridge = await session.scalar(
        select(IikoBridge).where(
            IikoBridge.tenant_id == tenant.id, IikoBridge.restaurant_id == restaurant_id
        )
    )
    if bridge is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Плагин этой точки не заведён")

    bridge.is_active = payload.is_active
    await session.commit()
    return BridgeToggle(is_active=bridge.is_active)


@router.get("/iiko/groups", summary="Группы номенклатуры кассы")
async def iiko_groups(
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    restaurant_id: Annotated[UUID, Query()],
) -> list[ProductGroupRow]:
    """В базе точки тысячи позиций — меню лежит в нескольких группах."""
    rows = await iiko_bridge.groups(session, tenant, restaurant_id)
    return [ProductGroupRow(**row) for row in rows]


@router.get("/iiko/products", summary="Номенклатура кассы этой точки")
async def iiko_products(
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    restaurant_id: Annotated[UUID, Query()],
    group: Annotated[str | None, Query()] = None,
) -> list[IikoProductRow]:
    query = (
        select(IikoProduct)
        .where(IikoProduct.tenant_id == tenant.id, IikoProduct.restaurant_id == restaurant_id)
        .order_by(IikoProduct.name)
    )
    # Без фильтра список неподъёмный: у точки бывает больше десяти тысяч позиций
    if group:
        query = query.where(
            (IikoProduct.group_path == group) | (IikoProduct.group_name == group)
        )

    rows = await session.scalars(query)

    return [
        IikoProductRow(
            product_id=row.product_id,
            name=row.name,
            code=row.code,
            group_name=row.group_name,
            group_path=row.group_path,
            product_type=row.product_type,
            price_kopecks=row.price_kopecks,
            is_active=row.is_active,
            has_sizes=row.has_sizes,
        )
        for row in rows
    ]


@router.get("/iiko/search", summary="Поиск по номенклатуре кассы")
async def iiko_search(
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    restaurant_id: Annotated[UUID, Query()],
    q: Annotated[str, Query()] = "",
    groups: Annotated[list[str] | None, Query()] = None,
) -> list[IikoProductRow]:
    """Ищет сервер: список номенклатуры целиком браузер не переживает."""
    rows = await iiko_bridge.search_products(session, tenant, restaurant_id, q, groups)

    return [
        IikoProductRow(
            product_id=row.product_id,
            name=row.name,
            code=row.code,
            group_name=row.group_name,
            group_path=row.group_path,
            product_type=row.product_type,
            price_kopecks=row.price_kopecks,
            is_active=row.is_active,
            has_sizes=row.has_sizes,
        )
        for row in rows
    ]


@router.get("/iiko/links", summary="Сопоставление блюд с товарами кассы")
async def iiko_links(
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    restaurant_id: Annotated[UUID, Query()],
    groups: Annotated[list[str] | None, Query()] = None,
) -> list[LinkRow]:
    """Все блюда и добавки сети с их сопоставлением в этом ресторане."""
    links = {
        ("dish", link.dish_id) if link.dish_id else ("extra", link.extra_id): link
        for link in await session.scalars(
            select(IikoLink).where(
                IikoLink.tenant_id == tenant.id, IikoLink.restaurant_id == restaurant_id
            )
        )
    }

    products = {
        product.product_id: product
        for product in await session.scalars(
            select(IikoProduct).where(
                IikoProduct.tenant_id == tenant.id, IikoProduct.restaurant_id == restaurant_id
            )
        )
    }
    price_overrides = {
        price.dish_id: price.price_kopecks
        for price in await session.scalars(
            select(DishPrice).where(
                DishPrice.tenant_id == tenant.id,
                DishPrice.restaurant_id == restaurant_id,
                DishPrice.is_available.is_(True),
            )
        )
    }

    rows: list[LinkRow] = []

    not_sold = select(DishPrice.dish_id).where(
        DishPrice.tenant_id == tenant.id,
        DishPrice.restaurant_id == restaurant_id,
        DishPrice.is_available.is_(False),
    )
    dishes = await session.execute(
        select(Dish, MenuCategory.name)
        .join(MenuCategory, MenuCategory.id == Dish.category_id)
        .where(
            Dish.tenant_id == tenant.id,
            Dish.is_active.is_(True),
            MenuCategory.is_active.is_(True),
            ~Dish.id.in_(not_sold),
        )
        .order_by(MenuCategory.sort_order, Dish.sort_order, Dish.name)
    )
    for dish, category in dishes:
        link = links.get(("dish", dish.id))
        product = products.get(link.product_id) if link else None
        rows.append(
            LinkRow(
                kind="dish",
                id=dish.id,
                name=dish.name,
                group=category,
                product_id=link.product_id if link else None,
                product_name=product.name if product else None,
                product_code=product.code if product else None,
                product_group_path=product.group_path if product else None,
                product_type=product.product_type if product else None,
                size_id=link.size_id if link else None,
                modifier_group_id=None,
                our_price_kopecks=price_overrides.get(dish.id, dish.price_kopecks),
                iiko_price_kopecks=product.price_kopecks if product else 0,
            )
        )

    extras = await session.scalars(
        select(DishExtra)
        .where(DishExtra.tenant_id == tenant.id, DishExtra.is_active.is_(True))
        .order_by(DishExtra.name)
    )
    for extra in extras:
        link = links.get(("extra", extra.id))
        product = products.get(link.product_id) if link else None
        rows.append(
            LinkRow(
                kind="extra",
                id=extra.id,
                name=extra.name,
                group="Добавки",
                product_id=link.product_id if link else None,
                product_name=product.name if product else None,
                product_code=product.code if product else None,
                product_group_path=product.group_path if product else None,
                product_type=product.product_type if product else None,
                size_id=link.size_id if link else None,
                modifier_group_id=link.modifier_group_id if link else None,
                our_price_kopecks=extra.price_kopecks,
                iiko_price_kopecks=product.price_kopecks if product else 0,
            )
        )

    # Подсказки — только для несопоставленных и только внутри выбранных групп:
    # по всей номенклатуре это и долго, и бессмысленно
    if groups:
        waiting = [row.name for row in rows if row.product_id is None]
        hints = await iiko_bridge.suggest(session, tenant, restaurant_id, waiting, groups)

        for row in rows:
            for product in hints.get(row.name, []):
                row.suggestions.append(
                    IikoProductRow(
                        product_id=product.product_id,
                        name=product.name,
                        code=product.code,
                        group_name=product.group_name,
                        group_path=product.group_path,
                        product_type=product.product_type,
                        price_kopecks=product.price_kopecks,
                        is_active=product.is_active,
                        has_sizes=product.has_sizes,
                    )
                )

    return rows


@router.put("/iiko/links", summary="Сохранить сопоставление")
async def iiko_save_links(
    payload: LinkBatch, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> SyncResult:
    saved = await iiko_bridge.save_links(
        session,
        tenant,
        payload.restaurant_id,
        [link.model_dump() for link in payload.links],
    )
    await session.commit()
    return SyncResult(applied=saved)


@router.post("/iiko/links/auto", summary="Сопоставить по названиям")
async def iiko_auto_links(
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    restaurant_id: Annotated[UUID, Query()],
    groups: Annotated[list[str] | None, Query()] = None,
) -> MatchResult:
    """Связывает совпадающие названия. Спорное оставляет человеку.

    Группы сужают поиск: без них блюдо находится и в заготовках, и в акциях
    прошлых лет, и совпадение перестаёт быть однозначным.
    """
    matched, skipped = await iiko_bridge.auto_match(session, tenant, restaurant_id, groups)
    await session.commit()
    return MatchResult(matched=matched, skipped=skipped)


@router.get("/iiko/queue", summary="Очередь заказов на кассу")
async def iiko_queue(
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    only_problems: Annotated[bool, Query()] = False,
) -> list[HandoffRow]:
    """Что уехало на кассу, что застряло и почему."""
    query = (
        select(IikoOrderHandoff, Order, Restaurant.name)
        .join(Order, Order.id == IikoOrderHandoff.order_id)
        .join(Restaurant, Restaurant.id == IikoOrderHandoff.restaurant_id)
        .where(IikoOrderHandoff.tenant_id == tenant.id)
        .order_by(IikoOrderHandoff.created_at.desc())
        .limit(200)
    )
    if only_problems:
        query = query.where(IikoOrderHandoff.status == IikoHandoffStatus.FAILED)

    rows = await session.execute(query)

    return [
        HandoffRow(
            order_id=order.id,
            order_number=order.number,
            restaurant_name=restaurant_name,
            status=handoff.status.value,
            attempts=handoff.attempts,
            error=handoff.error,
            missing_products=handoff.missing_products or [],
            iiko_order_number=handoff.iiko_order_number,
            created_at=handoff.created_at,
            total_kopecks=order.total_kopecks,
        )
        for handoff, order, restaurant_name in rows
    ]


@router.post("/iiko/queue/{order_id}/retry", summary="Отдать заказ на кассу заново")
async def iiko_retry(
    order_id: UUID, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> SyncResult:
    """После починки сопоставления заказ можно отправить ещё раз."""
    handoff = await session.scalar(
        select(IikoOrderHandoff).where(
            IikoOrderHandoff.tenant_id == tenant.id, IikoOrderHandoff.order_id == order_id
        )
    )
    if handoff is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заказ не стоял в очереди")

    handoff.status = IikoHandoffStatus.PENDING
    handoff.attempts = 0
    handoff.locked_until = None
    handoff.error = None
    handoff.missing_products = []

    await session.commit()
    return SyncResult(applied=1)


@router.get("/iiko/menu-tree", summary="Дерево номенклатуры сети")
async def iiko_menu_tree(
    session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> MenuTreeRead:
    """Где искать блюда каждой категории и что считать мусором.

    Настройка общая на сеть: в iiko chain товары заводят централизованно,
    поэтому ветки у точек совпадают.
    """
    tree = await iiko_bridge.menu_tree(session, tenant)

    rows = await session.execute(
        select(
            MenuCategory.id,
            MenuCategory.name,
            MenuCategory.iiko_group_paths,
            func.count(Dish.id),
        )
        .outerjoin(Dish, (Dish.category_id == MenuCategory.id) & Dish.is_active.is_(True))
        .where(MenuCategory.tenant_id == tenant.id, MenuCategory.is_active.is_(True))
        .group_by(MenuCategory.id, MenuCategory.name, MenuCategory.iiko_group_paths)
        .order_by(MenuCategory.sort_order, MenuCategory.name)
    )

    counted = await session.execute(
        select(Dish.category_id, func.count())
        .join(IikoLink, IikoLink.dish_id == Dish.id)
        .where(IikoLink.tenant_id == tenant.id)
        .group_by(Dish.category_id)
    )
    linked: dict[UUID, int] = {row[0]: row[1] for row in counted}

    return MenuTreeRead(
        branches=[
            MenuBranchRow(
                category_id=category_id,
                name=name,
                dishes=dishes,
                linked=linked.get(category_id, 0),
                iiko_group_paths=list(paths or []),
            )
            for category_id, name, paths, dishes in rows
        ],
        deny_markers=list(tree.deny_markers),
        extra_group_paths=list(tree.extra_paths),
        keep_unknown_groups=tree.keep_unknown_groups,
    )


@router.put("/iiko/menu-tree", summary="Сохранить дерево номенклатуры")
async def iiko_save_menu_tree(
    payload: MenuTreeWrite, session: SessionDep, tenant: TenantDep, staff: StaffDep
) -> SyncResult:
    saved = await iiko_bridge.save_menu_tree(
        session,
        tenant,
        [branch.model_dump() for branch in payload.branches],
        payload.deny_markers,
        payload.extra_group_paths,
        payload.keep_unknown_groups,
    )
    await session.commit()
    return SyncResult(applied=saved)


@router.post("/iiko/links/copy", summary="Перенести сопоставление на другую точку")
async def iiko_copy_links(
    session: SessionDep,
    tenant: TenantDep,
    staff: StaffDep,
    source_id: Annotated[UUID, Query()],
    target_id: Annotated[UUID, Query()],
    overwrite: Annotated[bool, Query()] = False,
) -> CopyLinksResult:
    """Настроили одну точку — остальные получают то же самое одним нажатием."""
    copied, skipped = await iiko_bridge.copy_links(
        session, tenant, source_id, target_id, overwrite
    )
    await session.commit()
    return CopyLinksResult(copied=copied, skipped=skipped)
