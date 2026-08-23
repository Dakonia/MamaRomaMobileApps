from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, ExternalSyncMixin, TenantMixin, TimestampMixin, UUIDMixin
from app.models.enums import (
    OrderStatus,
    OrderType,
    PaymentMethod,
    PaymentStatus,
    enum_column,
)
from app.models.geo import Restaurant


class Order(UUIDMixin, TenantMixin, TimestampMixin, ExternalSyncMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (UniqueConstraint("tenant_id", "number", name="uq_orders_tenant_number"),)

    number: Mapped[str] = mapped_column(String(20))

    guest_id: Mapped[UUID] = mapped_column(ForeignKey("guests.id", ondelete="RESTRICT"), index=True)
    restaurant_id: Mapped[UUID] = mapped_column(
        ForeignKey("restaurants.id", ondelete="RESTRICT"), index=True
    )

    type: Mapped[OrderType] = mapped_column(enum_column(OrderType))
    status: Mapped[OrderStatus] = mapped_column(
        enum_column(OrderStatus), default=OrderStatus.CREATED, index=True
    )

    # Снимок контактов и адреса: гость может их поменять или удалить, заказ — документ
    contact_name: Mapped[str | None] = mapped_column(String(120), default=None)
    contact_phone: Mapped[str] = mapped_column(String(20))
    address_text: Mapped[str | None] = mapped_column(String(400), default=None)
    address_latitude: Mapped[float | None] = mapped_column(Float, default=None)
    address_longitude: Mapped[float | None] = mapped_column(Float, default=None)

    # None — «как можно скорее», иначе желаемое время в UTC
    delivery_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    persons_count: Mapped[int | None] = mapped_column(default=None)
    comment: Mapped[str | None] = mapped_column(Text, default=None)

    # Сдача: с какой купюры готовить, когда платят наличными
    change_from_kopecks: Mapped[int | None] = mapped_column(default=None)

    subtotal_kopecks: Mapped[int] = mapped_column(default=0)
    delivery_kopecks: Mapped[int] = mapped_column(default=0)
    # Приборы платные: держим отдельной строкой, чтобы было видно в чеке
    cutlery_kopecks: Mapped[int] = mapped_column(default=0)
    # Скидка по промокоду и списанные баллы считаем отдельно: в чеке это разные строки
    promo_code: Mapped[str | None] = mapped_column(String(32), default=None)
    promo_discount_kopecks: Mapped[int] = mapped_column(default=0)
    discount_kopecks: Mapped[int] = mapped_column(default=0)
    points_spent: Mapped[int] = mapped_column(default=0)
    points_earned: Mapped[int] = mapped_column(default=0)
    total_kopecks: Mapped[int] = mapped_column(default=0)

    payment_method: Mapped[PaymentMethod] = mapped_column(enum_column(PaymentMethod))
    payment_status: Mapped[PaymentStatus] = mapped_column(
        enum_column(PaymentStatus), default=PaymentStatus.NOT_REQUIRED
    )
    payment_external_id: Mapped[str | None] = mapped_column(String(64), index=True, default=None)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    # lazy="selectin": карточка заказа без позиций и ресторана бессмысленна,
    # поэтому подгружаем их одним дополнительным запросом всегда
    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", lazy="selectin"
    )
    restaurant: Mapped[Restaurant] = relationship(lazy="selectin")

    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    cancel_reason: Mapped[str | None] = mapped_column(String(300), default=None)


class OrderItem(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Позиция заказа. Название и цена — снимок на момент оформления."""

    __tablename__ = "order_items"

    order_id: Mapped[UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    dish_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("dishes.id", ondelete="SET NULL"), index=True, default=None
    )

    name: Mapped[str] = mapped_column(String(200))
    # Снимок фотографии на момент заказа: блюдо потом могли переснять или убрать
    image_url: Mapped[str | None] = mapped_column(String(500), default=None)
    # Выбранные добавки снимком: [{"name": "бекон 50 гр", "price_kopecks": 9500}]
    extras: Mapped[list[dict[str, object]]] = mapped_column(JSONB, default=list)
    unit_price_kopecks: Mapped[int]
    quantity: Mapped[int] = mapped_column(default=1)
    total_kopecks: Mapped[int]

    order: Mapped[Order] = relationship(back_populates="items")
