from datetime import datetime

from sqlalchemy import DateTime, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TenantMixin, TimestampMixin, UUIDMixin
from app.models.enums import StaffRole, enum_column


class StaffUser(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Сотрудник сети: вход в админку по почте и паролю."""

    __tablename__ = "staff_users"
    __table_args__ = (UniqueConstraint("tenant_id", "email", name="uq_staff_users_tenant_email"),)

    email: Mapped[str] = mapped_column(String(160))
    password_hash: Mapped[str] = mapped_column(String(120))
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[StaffRole] = mapped_column(enum_column(StaffRole), default=StaffRole.MANAGER)
    is_active: Mapped[bool] = mapped_column(default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
