from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TenantMixin, TimestampMixin, UUIDMixin
from app.models.enums import LoyaltyOperation, enum_column


class LoyaltyAccount(UUIDMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "loyalty_accounts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "guest_id", name="uq_loyalty_accounts_tenant_guest"),
    )

    guest_id: Mapped[UUID] = mapped_column(ForeignKey("guests.id", ondelete="CASCADE"), index=True)

    # Код уровня из tenant.loyalty.tiers — у каждой сети свои, поэтому строка, а не перечисление
    # Номер карты гостя: шесть цифр, которые он называет на кассе.
    # Штрихкод для сканера собирается из него же — см. card_barcode()
    card_number: Mapped[str] = mapped_column(String(6), index=True, default="")
    tier_code: Mapped[str] = mapped_column(String(30))
    points_balance: Mapped[int] = mapped_column(default=0)
    lifetime_spent_kopecks: Mapped[int] = mapped_column(default=0)
    tier_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class LoyaltyTransaction(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Движение баллов. points > 0 — начисление, points < 0 — списание.

    expires_at заполняется только у начислений: по нему сгорают неиспользованные
    баллы через tenant.loyalty.pointsExpireAfterDays.
    """

    __tablename__ = "loyalty_transactions"

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("loyalty_accounts.id", ondelete="CASCADE"), index=True
    )
    order_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("orders.id", ondelete="SET NULL"), index=True, default=None
    )

    operation: Mapped[LoyaltyOperation] = mapped_column(enum_column(LoyaltyOperation))
    points: Mapped[int]
    balance_after: Mapped[int]
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True, default=None
    )
    comment: Mapped[str | None] = mapped_column(String(200), default=None)
