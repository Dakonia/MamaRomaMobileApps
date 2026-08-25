"""Ручки для плагина на кассовом терминале ресторана.

Отдельный контур авторизации: не токен гостя и не токен сотрудника, а секрет
конкретной точки в заголовке. Плагин — не человек, ему незачем логиниться.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query, status

from app.api.deps import SessionDep, TenantDep
from app.models.integration import IikoBridge
from app.schemas.integration import (
    DeliveryStatusIn,
    MenuIn,
    OrderAckIn,
    PendingOrdersOut,
    StopListIn,
    SyncResult,
)
from app.services import iiko_bridge

router = APIRouter(prefix="/integrations/iiko", tags=["Касса ресторана"])


async def _authorize(
    session: SessionDep,
    tenant: TenantDep,
    restaurant_id: str,
    secret: str,
    terminal: str | None = None,
    version: str | None = None,
) -> IikoBridge:
    try:
        bridge = await iiko_bridge.authenticate(session, tenant, restaurant_id, secret)
    except iiko_bridge.BridgeError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc

    await iiko_bridge.touch(session, bridge, terminal, version)
    return bridge


@router.get("/orders/pending", summary="Заказы, ожидающие заведения на кассе")
async def pending_orders(
    session: SessionDep,
    tenant: TenantDep,
    restaurant_id: Annotated[str, Query(alias="restaurant_id")],
    secret: Annotated[str, Header(alias="X-Iiko-Bridge-Secret")],
    header_restaurant: Annotated[str | None, Header(alias="X-Iiko-Restaurant-Id")] = None,
    terminal: Annotated[str | None, Header(alias="X-Iiko-Terminal")] = None,
    version: Annotated[str | None, Header(alias="X-Iiko-Plugin-Version")] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> PendingOrdersOut:
    bridge = await _authorize(
        session, tenant, header_restaurant or restaurant_id, secret, terminal, version
    )

    taken = await iiko_bridge.take_pending(session, tenant, bridge.restaurant_id, limit)
    orders = [await iiko_bridge.build_order_payload(session, tenant, order) for order, _ in taken]

    await session.commit()
    return PendingOrdersOut(orders=orders)


@router.post("/orders/ack", summary="Чем закончилось заведение заказов")
async def ack_orders(
    payload: OrderAckIn,
    session: SessionDep,
    tenant: TenantDep,
    secret: Annotated[str, Header(alias="X-Iiko-Bridge-Secret")],
    header_restaurant: Annotated[str | None, Header(alias="X-Iiko-Restaurant-Id")] = None,
    terminal: Annotated[str | None, Header(alias="X-Iiko-Terminal")] = None,
    version: Annotated[str | None, Header(alias="X-Iiko-Plugin-Version")] = None,
) -> SyncResult:
    bridge = await _authorize(
        session, tenant, header_restaurant or payload.restaurant_id, secret, terminal, version
    )

    for result in payload.results:
        try:
            order_id = UUID(result.order_id)
        except ValueError:
            continue

        await iiko_bridge.ack_order(
            session,
            tenant,
            bridge.restaurant_id,
            order_id,
            accepted=result.status == "accepted",
            iiko_order_id=result.iiko_order_id,
            iiko_order_number=result.iiko_order_number,
            error=result.error,
            missing_products=result.missing_products,
        )

    await session.commit()
    return SyncResult(applied=len(payload.results))


@router.post("/stop-list", summary="Что сейчас в стоп-листе ресторана")
async def stop_list(
    payload: StopListIn,
    session: SessionDep,
    tenant: TenantDep,
    secret: Annotated[str, Header(alias="X-Iiko-Bridge-Secret")],
    header_restaurant: Annotated[str | None, Header(alias="X-Iiko-Restaurant-Id")] = None,
    terminal: Annotated[str | None, Header(alias="X-Iiko-Terminal")] = None,
    version: Annotated[str | None, Header(alias="X-Iiko-Plugin-Version")] = None,
) -> SyncResult:
    bridge = await _authorize(
        session, tenant, header_restaurant or payload.restaurant_id, secret, terminal, version
    )

    added, removed = await iiko_bridge.apply_stop_list(
        session,
        tenant,
        bridge.restaurant_id,
        [item.model_dump(by_alias=True) for item in payload.items],
    )
    await session.commit()

    return SyncResult(applied=added + removed, added=added, removed=removed)


@router.post("/menu", summary="Номенклатура кассы для сопоставления блюд")
async def menu(
    payload: MenuIn,
    session: SessionDep,
    tenant: TenantDep,
    secret: Annotated[str, Header(alias="X-Iiko-Bridge-Secret")],
    header_restaurant: Annotated[str | None, Header(alias="X-Iiko-Restaurant-Id")] = None,
    terminal: Annotated[str | None, Header(alias="X-Iiko-Terminal")] = None,
    version: Annotated[str | None, Header(alias="X-Iiko-Plugin-Version")] = None,
) -> SyncResult:
    bridge = await _authorize(
        session, tenant, header_restaurant or payload.restaurant_id, secret, terminal, version
    )

    saved = await iiko_bridge.apply_menu(
        session,
        tenant,
        bridge.restaurant_id,
        [product.model_dump(by_alias=True) for product in payload.products],
    )
    await session.commit()

    return SyncResult(applied=saved)


@router.post("/delivery-status", summary="Что происходит с заказами на кухне")
async def delivery_status(
    payload: DeliveryStatusIn,
    session: SessionDep,
    tenant: TenantDep,
    secret: Annotated[str, Header(alias="X-Iiko-Bridge-Secret")],
    header_restaurant: Annotated[str | None, Header(alias="X-Iiko-Restaurant-Id")] = None,
    terminal: Annotated[str | None, Header(alias="X-Iiko-Terminal")] = None,
    version: Annotated[str | None, Header(alias="X-Iiko-Plugin-Version")] = None,
) -> SyncResult:
    bridge = await _authorize(
        session, tenant, header_restaurant or payload.restaurant_id, secret, terminal, version
    )

    touched = await iiko_bridge.apply_delivery_status(
        session,
        tenant,
        bridge.restaurant_id,
        [order.model_dump(by_alias=True) for order in payload.orders],
    )
    await session.commit()

    return SyncResult(applied=touched)
