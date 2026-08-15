from datetime import datetime

from sqlalchemy import DateTime, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TenantMixin, TimestampMixin, UUIDMixin


class PhoneCode(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Код подтверждения входа. Хранится хешем: в логи и дампы утекает бесполезное."""

    __tablename__ = "phone_codes"
    __table_args__ = (Index("ix_phone_codes_tenant_phone", "tenant_id", "phone"),)

    phone: Mapped[str] = mapped_column(String(20))
    code_hash: Mapped[str] = mapped_column(String(120))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(default=0)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
