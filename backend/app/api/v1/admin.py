from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_, select

from app.api.deps import SessionDep, StaffDep, TenantDep
from app.core.security import create_token, verify_password
from app.models.enums import OrderStatus, ReservationStatus
from app.models.geo import Restaurant
from app.models.menu import Dish, MenuCategory, StopListEntry
from app.models.order import Order
from app.models.reservation import Reservation
from app.models.staff import StaffUser
from app.schemas.admin import (
    CategoryAdminRead,
    CategoryPatch,
    CategoryWrite,
    DishAdminRead,
    DishPatch,
    DishWrite,
    OrderStatusWrite,
    ReservationStatusWrite,
    StaffLogin,
    StaffRead,
    StaffSession,
    StopListRead,
    StopListWrite,
)
from app.schemas.order import OrderRead
from app.schemas.reservation import ReservationRead
from app.services import order as order_service
from app.services import reservation as reservation_service

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
