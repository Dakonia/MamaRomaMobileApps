from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import GuestDep, SessionDep, TenantDep
from app.models.enums import OrderStatus
from app.models.feedback import OrderFeedback
from app.models.order import Order
from app.schemas.order import (
    CheckoutLimits,
    CheckoutPreview,
    CheckoutPreviewRequest,
    FeedbackRead,
    FeedbackWrite,
    OrderChangeRead,
    OrderCreate,
    OrderRead,
)
from app.services import iiko_bridge
from app.services import order as order_service

router = APIRouter(prefix="/orders", tags=["Заказы"])


@router.get("/limits", summary="Сколько баллов можно списать с этой суммы")
async def limits(
    session: SessionDep,
    tenant: TenantDep,
    guest: GuestDep,
    subtotal_kopecks: Annotated[int, Query(ge=0)],
) -> CheckoutLimits:
    return await order_service.checkout_limits(session, tenant, guest, subtotal_kopecks)


@router.post("/preview", summary="Счёт по корзине до оформления")
async def preview(
    payload: CheckoutPreviewRequest, session: SessionDep, tenant: TenantDep, guest: GuestDep
) -> CheckoutPreview:
    try:
        return await order_service.checkout_preview(session, tenant, guest, payload)
    except order_service.OrderError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("", status_code=status.HTTP_201_CREATED, summary="Оформить заказ")
async def create(
    payload: OrderCreate, session: SessionDep, tenant: TenantDep, guest: GuestDep
) -> OrderRead:
    try:
        order = await order_service.create_order(session, tenant, guest, payload)
    except order_service.OrderError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return order_service.to_read(order)


async def _rated(session: SessionDep, order_ids: list[UUID]) -> set[UUID]:
    """Какие из заказов уже оценены: об этом приложение спрашивает у каждого списка."""
    if not order_ids:
        return set()

    rows = await session.scalars(
        select(OrderFeedback.order_id).where(OrderFeedback.order_id.in_(order_ids))
    )
    return set(rows)


@router.get("", summary="Заказы гостя")
async def index(session: SessionDep, tenant: TenantDep, guest: GuestDep) -> list[OrderRead]:
    orders = await order_service.list_orders(session, tenant, guest)
    rated = await _rated(session, [order.id for order in orders])

    return [order_service.to_read(order, order.id in rated) for order in orders]


@router.get("/{order_id}", summary="Карточка заказа")
async def show(
    order_id: UUID, session: SessionDep, tenant: TenantDep, guest: GuestDep
) -> OrderRead:
    try:
        order = await order_service.get_order(session, tenant, guest, order_id)
    except order_service.OrderError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

    rated = await _rated(session, [order.id])
    read = order_service.to_read(order, order.id in rated)

    # Что ресторан поменял в составе: считаем только здесь — в списке заказов
    # это лишние запросы, а карточку гость открывает по одной
    read.changes = [
        OrderChangeRead(
            name=row.name,
            state=row.state,
            quantity=row.quantity,
            was_quantity=row.was_quantity,
            total_kopecks=row.total_kopecks,
            image_url=row.image_url,
        )
        for row in await iiko_bridge.describe_changes(session, tenant, order)
    ]

    return read


@router.post(
    "/{order_id}/feedback",
    status_code=status.HTTP_201_CREATED,
    summary="Оценить доставленный заказ",
)
async def leave_feedback(
    order_id: UUID,
    payload: FeedbackWrite,
    session: SessionDep,
    tenant: TenantDep,
    guest: GuestDep,
) -> FeedbackRead:
    """Оценка ставится один раз и видна только администратору сети."""
    order = await session.scalar(
        select(Order).where(
            Order.id == order_id, Order.tenant_id == tenant.id, Order.guest_id == guest.id
        )
    )
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заказ не найден")

    if order.status is not OrderStatus.COMPLETED:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Заказ ещё не доставлен")

    exists = await session.scalar(
        select(OrderFeedback).where(OrderFeedback.order_id == order.id)
    )
    if exists is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Этот заказ уже оценён")

    feedback = OrderFeedback(
        tenant_id=tenant.id,
        order_id=order.id,
        guest_id=guest.id,
        restaurant_id=order.restaurant_id,
        rating=payload.rating,
        tags=payload.tags,
        comment=(payload.comment or "").strip() or None,
    )
    session.add(feedback)
    await session.commit()
    await session.refresh(feedback)

    return FeedbackRead.model_validate(feedback)
