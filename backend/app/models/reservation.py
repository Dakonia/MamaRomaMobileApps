from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, ExternalSyncMixin, TenantMixin, TimestampMixin, UUIDMixin
from app.models.enums import ReservationStatus, enum_column
from app.models.geo import Restaurant


class Reservation(UUIDMixin, TenantMixin, TimestampMixin, ExternalSyncMixin, Base):
    __tablename__ = "reservations"

    guest_id: Mapped[UUID] = mapped_column(ForeignKey("guests.id", ondelete="RESTRICT"), index=True)
    restaurant_id: Mapped[UUID] = mapped_column(
        ForeignKey("restaurants.id", ondelete="RESTRICT"), index=True
    )

    # UTC. Локальное время считаем по таймзоне ресторана из конфига тенанта
    reserved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    duration_minutes: Mapped[int] = mapped_column(default=120)
    guests_count: Mapped[int]

    status: Mapped[ReservationStatus] = mapped_column(
        enum_column(ReservationStatus), default=ReservationStatus.REQUESTED, index=True
    )

    restaurant: Mapped[Restaurant] = relationship(lazy="selectin")

    contact_name: Mapped[str | None] = mapped_column(String(120), default=None)
    contact_phone: Mapped[str] = mapped_column(String(20))
    comment: Mapped[str | None] = mapped_column(Text, default=None)
    table_number: Mapped[str | None] = mapped_column(String(20), default=None)

    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    cancel_reason: Mapped[str | None] = mapped_column(String(300), default=None)
