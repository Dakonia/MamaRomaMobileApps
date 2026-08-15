from datetime import time
from uuid import UUID

from sqlalchemy import Float, ForeignKey, String, Text, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, ExternalSyncMixin, TenantMixin, TimestampMixin, UUIDMixin


class City(UUIDMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "cities"
    __table_args__ = (UniqueConstraint("tenant_id", "slug", name="uq_cities_tenant_slug"),)

    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(60))
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Moscow")
    is_active: Mapped[bool] = mapped_column(default=True)
    sort_order: Mapped[int] = mapped_column(default=0)


class Restaurant(UUIDMixin, TenantMixin, TimestampMixin, ExternalSyncMixin, Base):
    __tablename__ = "restaurants"

    city_id: Mapped[UUID] = mapped_column(ForeignKey("cities.id", ondelete="RESTRICT"), index=True)

    name: Mapped[str] = mapped_column(String(160))
    address: Mapped[str] = mapped_column(String(300))
    metro: Mapped[str | None] = mapped_column(String(120), default=None)
    phone: Mapped[str | None] = mapped_column(String(24), default=None)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)

    opens_at: Mapped[time] = mapped_column(Time)
    closes_at: Mapped[time] = mapped_column(Time)

    has_delivery: Mapped[bool] = mapped_column(default=True)
    has_pickup: Mapped[bool] = mapped_column(default=True)
    has_dine_in: Mapped[bool] = mapped_column(default=True)

    delivery_price_kopecks: Mapped[int] = mapped_column(default=0)
    delivery_min_order_kopecks: Mapped[int] = mapped_column(default=0)
    free_delivery_from_kopecks: Mapped[int | None] = mapped_column(default=None)

    description: Mapped[str | None] = mapped_column(Text, default=None)
    image_url: Mapped[str | None] = mapped_column(String(500), default=None)
    is_active: Mapped[bool] = mapped_column(default=True)
