from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenants import Tenant
from app.models.geo import City
from app.models.guest import Guest, GuestAddress
from app.schemas.guest import AddressCreate, AddressRead, GuestUpdate


class GuestError(Exception):
    pass


def address_text(address: GuestAddress) -> str:
    parts = [f"{address.street}, {address.house}"]
    if address.flat:
        parts.append(f"кв. {address.flat}")
    if address.entrance:
        parts.append(f"подъезд {address.entrance}")
    if address.floor:
        parts.append(f"этаж {address.floor}")
    return ", ".join(parts)


def to_read(address: GuestAddress) -> AddressRead:
    return AddressRead(
        id=address.id,
        city_id=address.city_id,
        title=address.title,
        street=address.street,
        house=address.house,
        flat=address.flat,
        entrance=address.entrance,
        floor=address.floor,
        intercom=address.intercom,
        comment=address.comment,
        is_default=address.is_default,
        full_text=address_text(address),
    )


async def update_guest(session: AsyncSession, guest: Guest, payload: GuestUpdate) -> Guest:
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(guest, field, str(value) if field == "email" and value is not None else value)
    await session.commit()
    await session.refresh(guest)
    return guest


async def list_addresses(session: AsyncSession, tenant: Tenant, guest: Guest) -> list[GuestAddress]:
    rows = await session.scalars(
        select(GuestAddress)
        .where(GuestAddress.tenant_id == tenant.id, GuestAddress.guest_id == guest.id)
        .order_by(GuestAddress.is_default.desc(), GuestAddress.created_at.desc())
    )
    return list(rows.all())


async def _clear_default(session: AsyncSession, tenant: Tenant, guest: Guest) -> None:
    await session.execute(
        update(GuestAddress)
        .where(GuestAddress.tenant_id == tenant.id, GuestAddress.guest_id == guest.id)
        .values(is_default=False)
    )


async def add_address(
    session: AsyncSession, tenant: Tenant, guest: Guest, payload: AddressCreate
) -> GuestAddress:
    city = await session.scalar(
        select(City).where(City.id == payload.city_id, City.tenant_id == tenant.id)
    )
    if city is None:
        raise GuestError("Город не найден")

    existing = await list_addresses(session, tenant, guest)
    make_default = payload.is_default or not existing

    if make_default:
        await _clear_default(session, tenant, guest)

    address = GuestAddress(
        tenant_id=tenant.id,
        guest_id=guest.id,
        **payload.model_dump(exclude={"is_default"}),
        is_default=make_default,
    )
    session.add(address)
    await session.commit()
    await session.refresh(address)
    return address


async def delete_address(
    session: AsyncSession, tenant: Tenant, guest: Guest, address_id: UUID
) -> None:
    address = await session.scalar(
        select(GuestAddress).where(
            GuestAddress.id == address_id,
            GuestAddress.tenant_id == tenant.id,
            GuestAddress.guest_id == guest.id,
        )
    )
    if address is None:
        raise GuestError("Адрес не найден")

    await session.delete(address)
    await session.commit()
