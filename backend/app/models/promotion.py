from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TenantMixin, TimestampMixin, UUIDMixin


class Promotion(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Акция сети или отдельного ресторана.

    Пустой restaurant_id означает «во всех ресторанах», пустой ends_at — «бессрочно».
    """

    __tablename__ = "promotions"

    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text, default=None)
    # Короткая плашка поверх картинки: «−20%», «Новинка», «2 по цене 1»
    label: Mapped[str | None] = mapped_column(String(24), default=None)
    image_url: Mapped[str | None] = mapped_column(String(500), default=None)

    restaurant_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("restaurants.id", ondelete="CASCADE"), index=True, default=None
    )

    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)
