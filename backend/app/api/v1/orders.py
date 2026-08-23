from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import GuestDep, SessionDep, TenantDep
from app.schemas.order import (
    CheckoutLimits,
    CheckoutPreview,
    CheckoutPreviewRequest,
    OrderCreate,
    OrderRead,
)
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


@router.get("", summary="Заказы гостя")
async def index(session: SessionDep, tenant: TenantDep, guest: GuestDep) -> list[OrderRead]:
    orders = await order_service.list_orders(session, tenant, guest)
    return [order_service.to_read(order) for order in orders]


@router.get("/{order_id}", summary="Карточка заказа")
async def show(
    order_id: UUID, session: SessionDep, tenant: TenantDep, guest: GuestDep
) -> OrderRead:
    try:
        order = await order_service.get_order(session, tenant, guest, order_id)
    except order_service.OrderError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return order_service.to_read(order)
