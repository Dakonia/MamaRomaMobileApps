import secrets
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenants import Tenant
from app.models.auth import PhoneCode
from app.models.geo import City
from app.models.guest import Device, Guest, GuestAddress
from app.models.loyalty import LoyaltyAccount, LoyaltyTransaction
from app.models.order import Order
from app.models.reservation import Reservation
from app.schemas.guest import AddressCreate, AddressRead, AddressUpdate, GuestUpdate
from app.services import address_book, geo


class GuestError(Exception):
    pass


def address_text(address: GuestAddress) -> str:
    house = address.house if not address.building else f"{address.house} {address.building}"
    # Населённый пункт пишем, только если он отличается от города доставки:
    # «Кудрово, ул Столичная, 5 к 2» курьеру понятнее, чем просто улица
    head = f"{address.locality}, " if address.locality else ""
    parts = [f"{head}{address.street}, {house}"]
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
        building=address.building,
        flat=address.flat,
        entrance=address.entrance,
        floor=address.floor,
        intercom=address.intercom,
        comment=address.comment,
        is_default=address.is_default,
        full_text=address_text(address),
        latitude=address.latitude,
        longitude=address.longitude,
        locality=address.locality,
        metro=address.metro,
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


async def _standardize(
    session: AsyncSession, city: City, fields: dict[str, Any]
) -> dict[str, Any]:
    """
    Приводим адрес к справочному виду: чиним опечатки в улице, добираем индекс,
    район и точные координаты дома. Если сервис молчит — сохраняем как есть,
    гость не должен упираться в чужую недоступность.
    """
    regions = city.suggest_regions
    # Город доставки в запрос не подставляем: для адреса в Кудрово он только мешает.
    # Область поиска и так задана кодами КЛАДР, а населённый пункт приходит из подсказки
    parts = [
        fields["locality"] or city.name,
        fields["street"],
        fields["house"],
        fields["building"] or "",
    ]
    text = ", ".join(part for part in parts if part)
    found = await address_book.search(session, text, regions, limit=1)
    clean = found[0] if found else await geo.standardize(text, regions)
    if clean is None:
        return {}

    if clean.street:
        fields["street"] = clean.street
    if clean.house:
        fields["house"] = clean.house
    if clean.building:
        fields["building"] = clean.building
    if fields.get("latitude") is None:
        fields["latitude"] = clean.latitude
        fields["longitude"] = clean.longitude

    fields["locality"] = clean.city if clean.city and clean.city != city.name else None

    return {
        "fias_id": clean.fias_id,
        "postal_code": clean.postal_code,
        "city_district": clean.city_district,
        "metro": clean.metro,
        "geo_precision": clean.geo_precision,
    }


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

    fields = payload.model_dump(exclude={"is_default"})
    fields["building"] = geo.normalize_building(fields["building"] or "") or None
    extra = await _standardize(session, city, fields)

    address = GuestAddress(
        tenant_id=tenant.id,
        guest_id=guest.id,
        **fields,
        **extra,
        is_default=make_default,
    )
    session.add(address)
    await session.commit()
    await session.refresh(address)
    return address


async def update_address(
    session: AsyncSession,
    tenant: Tenant,
    guest: Guest,
    address_id: UUID,
    payload: AddressUpdate,
) -> GuestAddress:
    address = await session.scalar(
        select(GuestAddress).where(
            GuestAddress.id == address_id,
            GuestAddress.tenant_id == tenant.id,
            GuestAddress.guest_id == guest.id,
        )
    )
    if address is None:
        raise GuestError("Адрес не найден")

    fields = payload.model_dump(exclude_unset=True)
    make_default = fields.pop("is_default", None)

    if "building" in fields:
        fields["building"] = geo.normalize_building(fields["building"] or "") or None

    for field, value in fields.items():
        setattr(address, field, value)

    # Основной адрес может быть только один: снимаем отметку с остальных
    if make_default:
        await _clear_default(session, tenant, guest)
        address.is_default = True

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


async def delete_account(session: AsyncSession, tenant: Tenant, guest: Guest) -> None:
    """Удаляет аккаунт гостя: требование Apple и право на забвение по ФЗ-152.

    Личные данные стираем полностью — адреса, устройства, баллы, брони, имя,
    телефон, почту. Сами заказы остаются: это первичные документы, их нельзя
    удалять по 54-ФЗ. Но и в них личного не остаётся — имя, телефон, адрес и
    комментарий вычищаются, у заказа остаётся только состав и сумма.
    """
    accounts = (
        await session.scalars(
            select(LoyaltyAccount.id).where(
                LoyaltyAccount.tenant_id == tenant.id, LoyaltyAccount.guest_id == guest.id
            )
        )
    ).all()

    if accounts:
        await session.execute(
            delete(LoyaltyTransaction).where(LoyaltyTransaction.account_id.in_(accounts))
        )

    for model in (LoyaltyAccount, GuestAddress, Device, Reservation):
        await session.execute(
            delete(model).where(model.tenant_id == tenant.id, model.guest_id == guest.id)
        )

    await session.execute(
        delete(PhoneCode).where(PhoneCode.tenant_id == tenant.id, PhoneCode.phone == guest.phone)
    )

    await session.execute(
        update(Order)
        .where(Order.tenant_id == tenant.id, Order.guest_id == guest.id)
        .values(
            contact_name=None,
            contact_phone="",
            address_text=None,
            address_latitude=None,
            address_longitude=None,
            comment=None,
        )
    )

    # Номер телефона освобождаем: по нему гость сможет завести аккаунт заново
    guest.phone = f"deleted-{secrets.token_hex(5)}"
    guest.name = None
    guest.email = None
    guest.birthday = None
    guest.gender = None
    guest.consent_at = None
    guest.consent_version = None
    guest.last_seen_at = None
    guest.deleted_at = datetime.now(UTC)
    guest.is_blocked = True

    await session.commit()
