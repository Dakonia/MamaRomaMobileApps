from datetime import date, datetime
from uuid import UUID

from sqlalchemy import DateTime, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TenantMixin, TimestampMixin, UUIDMixin
from app.models.enums import DevicePlatform, enum_column


class Guest(UUIDMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "guests"
    __table_args__ = (UniqueConstraint("tenant_id", "phone", name="uq_guests_tenant_phone"),)

    phone: Mapped[str] = mapped_column(String(20))
    name: Mapped[str | None] = mapped_column(String(120), default=None)
    email: Mapped[str | None] = mapped_column(String(160), default=None)
    birthday: Mapped[date | None] = mapped_column(default=None)

    # ФЗ-152: момент, когда гость дал согласие на обработку персональных данных
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    consent_version: Mapped[str | None] = mapped_column(String(20), default=None)

    is_blocked: Mapped[bool] = mapped_column(default=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class GuestAddress(UUIDMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "guest_addresses"

    guest_id: Mapped[UUID] = mapped_column(ForeignKey("guests.id", ondelete="CASCADE"), index=True)
    city_id: Mapped[UUID] = mapped_column(ForeignKey("cities.id", ondelete="RESTRICT"), index=True)

    title: Mapped[str | None] = mapped_column(String(60), default=None)
    street: Mapped[str] = mapped_column(String(200))
    house: Mapped[str] = mapped_column(String(20))
    flat: Mapped[str | None] = mapped_column(String(20), default=None)
    entrance: Mapped[str | None] = mapped_column(String(20), default=None)
    floor: Mapped[str | None] = mapped_column(String(20), default=None)
    intercom: Mapped[str | None] = mapped_column(String(20), default=None)
    comment: Mapped[str | None] = mapped_column(String(300), default=None)

    latitude: Mapped[float | None] = mapped_column(Float, default=None)
    longitude: Mapped[float | None] = mapped_column(Float, default=None)
    is_default: Mapped[bool] = mapped_column(default=False)


class Device(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Устройство для пуш-уведомлений. Гость может быть ещё не авторизован."""

    __tablename__ = "devices"
    __table_args__ = (
        UniqueConstraint("tenant_id", "push_token", name="uq_devices_tenant_push_token"),
    )

    guest_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("guests.id", ondelete="CASCADE"), index=True, default=None
    )
    push_token: Mapped[str] = mapped_column(String(200))
    platform: Mapped[DevicePlatform] = mapped_column(enum_column(DevicePlatform))
    app_version: Mapped[str | None] = mapped_column(String(20), default=None)
    is_active: Mapped[bool] = mapped_column(default=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
