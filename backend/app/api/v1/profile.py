from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from app.api.deps import GuestDep, SessionDep, TenantDep
from app.schemas.auth import GuestRead
from app.schemas.guest import AddressCreate, AddressRead, GuestUpdate
from app.services import guest as guest_service

router = APIRouter(tags=["Профиль"])


@router.patch("/me", summary="Изменить данные гостя")
async def update_me(payload: GuestUpdate, session: SessionDep, guest: GuestDep) -> GuestRead:
    updated = await guest_service.update_guest(session, guest, payload)
    return GuestRead.model_validate(updated)


@router.get("/addresses", summary="Адреса доставки гостя")
async def list_addresses(
    session: SessionDep, tenant: TenantDep, guest: GuestDep
) -> list[AddressRead]:
    rows = await guest_service.list_addresses(session, tenant, guest)
    return [guest_service.to_read(row) for row in rows]


@router.post("/addresses", status_code=status.HTTP_201_CREATED, summary="Добавить адрес")
async def add_address(
    payload: AddressCreate, session: SessionDep, tenant: TenantDep, guest: GuestDep
) -> AddressRead:
    try:
        address = await guest_service.add_address(session, tenant, guest, payload)
    except guest_service.GuestError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return guest_service.to_read(address)


@router.delete(
    "/addresses/{address_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить адрес",
)
async def delete_address(
    address_id: UUID, session: SessionDep, tenant: TenantDep, guest: GuestDep
) -> None:
    try:
        await guest_service.delete_address(session, tenant, guest, address_id)
    except guest_service.GuestError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
