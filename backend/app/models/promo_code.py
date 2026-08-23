from datetime import datetime

from sqlalchemy import DateTime, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TenantMixin, TimestampMixin, UUIDMixin
from app.models.enums import PromoCodeKind, enum_column


class PromoCode(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Промокод на скидку в заказе.

    Скидка бывает трёх видов: процент от еды, фиксированная сумма и бесплатная
    доставка. Считается всегда до баллов — сначала промокод, потом списание.
    """

    __tablename__ = "promo_codes"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_promo_codes_tenant_code"),)

    code: Mapped[str] = mapped_column(String(32), index=True)
    title: Mapped[str] = mapped_column(String(120), default="")

    kind: Mapped[PromoCodeKind] = mapped_column(enum_column(PromoCodeKind))
    # Для процента — сколько процентов, для суммы — копейки. Для доставки не нужно
    value: Mapped[int] = mapped_column(default=0)
    max_discount_kopecks: Mapped[int | None] = mapped_column(default=None)
    min_order_kopecks: Mapped[int] = mapped_column(default=0)

    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    # Сколько раз кодом вообще можно воспользоваться и сколько раз одним гостем
    usage_limit: Mapped[int | None] = mapped_column(default=None)
    per_guest_limit: Mapped[int] = mapped_column(default=1)
    used_count: Mapped[int] = mapped_column(default=0)

    is_active: Mapped[bool] = mapped_column(default=True)
