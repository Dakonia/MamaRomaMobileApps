from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import GuestDep, SessionDep, TenantDep
from app.schemas.reservation import ReservationCreate, ReservationRead, SlotRead
from app.services import reservation as reservation_service

router = APIRouter(prefix="/reservations", tags=["Бронь"])


@router.get("/slots", summary="Свободное время на дату")
async def slots(
    session: SessionDep,
    tenant: TenantDep,
    restaurant_id: Annotated[UUID, Query()],
    on_date: Annotated[date, Query(alias="date")],
) -> list[SlotRead]:
    try:
        return await reservation_service.list_slots(session, tenant, restaurant_id, on_date)
    except reservation_service.ReservationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("", status_code=status.HTTP_201_CREATED, summary="Забронировать стол")
async def create(
    payload: ReservationCreate, session: SessionDep, tenant: TenantDep, guest: GuestDep
) -> ReservationRead:
    try:
        reservation = await reservation_service.create(session, tenant, guest, payload)
    except reservation_service.ReservationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return reservation_service.to_read(reservation)


@router.get("", summary="Брони гостя")
async def index(session: SessionDep, tenant: TenantDep, guest: GuestDep) -> list[ReservationRead]:
    rows = await reservation_service.list_for_guest(session, tenant, guest)
    return [reservation_service.to_read(row) for row in rows]


@router.post("/{reservation_id}/cancel", summary="Отменить бронь")
async def cancel(
    reservation_id: UUID, session: SessionDep, tenant: TenantDep, guest: GuestDep
) -> ReservationRead:
    try:
        reservation = await reservation_service.cancel(session, tenant, guest, reservation_id)
    except reservation_service.ReservationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return reservation_service.to_read(reservation)
