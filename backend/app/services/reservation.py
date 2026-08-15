from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.tenants import Tenant
from app.models.enums import ReservationStatus
from app.models.geo import Restaurant
from app.models.guest import Guest
from app.models.reservation import Reservation
from app.schemas.reservation import ReservationCreate, ReservationRead, SlotRead

SLOT_MINUTES = 30
DEFAULT_DURATION_MINUTES = 120
MIN_LEAD_MINUTES = 30
MAX_DAYS_AHEAD = 30

ACTIVE_STATUSES = (
    ReservationStatus.REQUESTED,
    ReservationStatus.CONFIRMED,
    ReservationStatus.SEATED,
)


class ReservationError(Exception):
    pass


def _zone(tenant: Tenant) -> ZoneInfo:
    return ZoneInfo(tenant.timezone)


def _within_working_hours(restaurant: Restaurant, local: datetime) -> bool:
    opens, closes = restaurant.opens_at, restaurant.closes_at
    moment = local.time()

    # Заведение может закрываться после полуночи — тогда интервал «переваливает» через сутки
    if closes <= opens:
        return moment >= opens or moment <= closes

    # Последнюю бронь принимаем не впритык к закрытию
    last_call = (
        datetime.combine(local.date(), closes) - timedelta(minutes=DEFAULT_DURATION_MINUTES // 2)
    ).time()
    return opens <= moment <= max(opens, last_call)


async def _restaurant(session: AsyncSession, tenant: Tenant, restaurant_id: UUID) -> Restaurant:
    restaurant = await session.scalar(
        select(Restaurant).where(
            Restaurant.id == restaurant_id,
            Restaurant.tenant_id == tenant.id,
            Restaurant.is_active.is_(True),
        )
    )
    if restaurant is None:
        raise ReservationError("Ресторан не найден")
    if not restaurant.has_dine_in:
        raise ReservationError("В этом ресторане нельзя забронировать стол")
    return restaurant


async def list_slots(
    session: AsyncSession, tenant: Tenant, restaurant_id: UUID, on_date: date
) -> list[SlotRead]:
    restaurant = await _restaurant(session, tenant, restaurant_id)
    zone = _zone(tenant)
    now_local = datetime.now(zone)

    if on_date < now_local.date():
        raise ReservationError("Дата уже прошла")
    if on_date > now_local.date() + timedelta(days=MAX_DAYS_AHEAD):
        raise ReservationError(f"Бронируем не дальше чем на {MAX_DAYS_AHEAD} дней")

    slots: list[SlotRead] = []
    cursor = datetime.combine(on_date, restaurant.opens_at, tzinfo=zone)
    end = datetime.combine(on_date, restaurant.closes_at, tzinfo=zone)
    if end <= cursor:
        end += timedelta(days=1)

    while cursor < end:
        local = cursor
        available = _within_working_hours(restaurant, local) and local >= now_local + timedelta(
            minutes=MIN_LEAD_MINUTES
        )
        slots.append(
            SlotRead(
                starts_at=local.astimezone(UTC),
                label=local.strftime("%H:%M"),
                is_available=available,
            )
        )
        cursor += timedelta(minutes=SLOT_MINUTES)

    return slots


async def create(
    session: AsyncSession, tenant: Tenant, guest: Guest, payload: ReservationCreate
) -> Reservation:
    restaurant = await _restaurant(session, tenant, payload.restaurant_id)
    zone = _zone(tenant)

    reserved_at = payload.reserved_at
    if reserved_at.tzinfo is None:
        reserved_at = reserved_at.replace(tzinfo=UTC)

    now = datetime.now(UTC)
    if reserved_at < now + timedelta(minutes=MIN_LEAD_MINUTES):
        raise ReservationError(f"Бронируем минимум за {MIN_LEAD_MINUTES} минут")
    if reserved_at > now + timedelta(days=MAX_DAYS_AHEAD):
        raise ReservationError(f"Бронируем не дальше чем на {MAX_DAYS_AHEAD} дней")

    local = reserved_at.astimezone(zone)
    if not _within_working_hours(restaurant, local):
        opens = restaurant.opens_at.strftime("%H:%M")
        closes = restaurant.closes_at.strftime("%H:%M")
        raise ReservationError(f"Ресторан работает с {opens} до {closes}")

    duplicate = await session.scalar(
        select(Reservation).where(
            Reservation.tenant_id == tenant.id,
            Reservation.guest_id == guest.id,
            Reservation.reserved_at == reserved_at,
            Reservation.status.in_(ACTIVE_STATUSES),
        )
    )
    if duplicate is not None:
        raise ReservationError("У вас уже есть бронь на это время")

    reservation = Reservation(
        tenant_id=tenant.id,
        guest_id=guest.id,
        restaurant_id=restaurant.id,
        reserved_at=reserved_at,
        duration_minutes=DEFAULT_DURATION_MINUTES,
        guests_count=payload.guests_count,
        status=ReservationStatus.REQUESTED,
        contact_name=payload.contact_name or guest.name,
        contact_phone=guest.phone,
        comment=payload.comment,
    )
    session.add(reservation)
    await session.commit()
    await session.refresh(reservation)
    return reservation


async def list_for_guest(
    session: AsyncSession, tenant: Tenant, guest: Guest, limit: int = 20
) -> list[Reservation]:
    rows = await session.scalars(
        select(Reservation)
        .options(selectinload(Reservation.restaurant))
        .where(Reservation.tenant_id == tenant.id, Reservation.guest_id == guest.id)
        .order_by(Reservation.reserved_at.desc())
        .limit(limit)
    )
    return list(rows.all())


async def cancel(
    session: AsyncSession, tenant: Tenant, guest: Guest, reservation_id: UUID
) -> Reservation:
    reservation = await session.scalar(
        select(Reservation).where(
            Reservation.id == reservation_id,
            Reservation.tenant_id == tenant.id,
            Reservation.guest_id == guest.id,
        )
    )
    if reservation is None:
        raise ReservationError("Бронь не найдена")
    if reservation.status not in ACTIVE_STATUSES:
        raise ReservationError("Эту бронь уже нельзя отменить")

    reservation.status = ReservationStatus.CANCELLED
    reservation.cancelled_at = datetime.now(UTC)
    reservation.cancel_reason = "Отменена гостем"
    await session.commit()
    await session.refresh(reservation)
    return reservation


def to_read(reservation: Reservation) -> ReservationRead:
    return ReservationRead(
        id=reservation.id,
        status=reservation.status,
        restaurant_id=reservation.restaurant_id,
        restaurant_name=reservation.restaurant.name,
        reserved_at=reservation.reserved_at,
        duration_minutes=reservation.duration_minutes,
        guests_count=reservation.guests_count,
        comment=reservation.comment,
        contact_name=reservation.contact_name,
        contact_phone=reservation.contact_phone,
        created_at=reservation.created_at,
    )

