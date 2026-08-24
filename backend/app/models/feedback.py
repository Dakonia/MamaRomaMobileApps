"""Оценка заказа. Гость ставит её один раз, видит только администратор."""

from uuid import UUID

from sqlalchemy import ForeignKey, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TenantMixin, TimestampMixin, UUIDMixin


class OrderFeedback(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Отзыв о заказе: звёзды, отметки о причинах и слова гостя.

    Публичного рейтинга у нас нет — оценка нужна ресторану, а не витрине.
    Один заказ оценивается один раз: переспрашивать невежливо.
    """

    __tablename__ = "order_feedback"
    __table_args__ = (UniqueConstraint("order_id", name="uq_order_feedback_order"),)

    order_id: Mapped[UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    guest_id: Mapped[UUID] = mapped_column(ForeignKey("guests.id", ondelete="CASCADE"), index=True)
    restaurant_id: Mapped[UUID] = mapped_column(
        ForeignKey("restaurants.id", ondelete="RESTRICT"), index=True
    )

    rating: Mapped[int]
    # Отметки вроде «долго везли» или «вкусно»: по ним видно, что именно решило оценку
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list)
    comment: Mapped[str | None] = mapped_column(Text, default=None)
