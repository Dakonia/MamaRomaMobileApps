from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
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
    role: Mapped[StaffRole] = mapped_column(
        enum_column(StaffRole), default=StaffRole.DELIVERY_OPERATOR
    )
    is_active: Mapped[bool] = mapped_column(default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    # Только отклонения от набора роли: {"guests.points": true, "zones.edit": false}.
    # Полный список прав тут не храним — иначе каждая новая ручка потребовала бы
    # миграции по всем заведённым сотрудникам
    permissions: Mapped[dict[str, bool]] = mapped_column(JSONB, default=dict)

    # Точки, за которые отвечает сотрудник. Пусто — вся сеть. Пока заполняется
    # только для ролей courier и restaurant, фильтрация включится вместе с ними
    restaurant_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)

    invited_by_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("staff_users.id", ondelete="SET NULL"), default=None
    )
