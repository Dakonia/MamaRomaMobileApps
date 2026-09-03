"""Журнал действий сотрудников в админке."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TenantMixin, UUIDMixin
from app.models.enums import StaffRole, enum_column


class StaffAuditLog(UUIDMixin, TenantMixin, Base):
    """Кто из сотрудников что изменил.

    Имя и роль храним прямо здесь, а не только ссылкой: сотрудника могут
    уволить и удалить, а запись «начислил 50 000 баллов» должна остаться
    читаемой и после этого.
    """

    __tablename__ = "staff_audit_log"
    __table_args__ = (
        Index("ix_staff_audit_log_tenant_created", "tenant_id", "created_at"),
        Index("ix_staff_audit_log_tenant_staff", "tenant_id", "staff_id"),
        Index("ix_staff_audit_log_tenant_section", "tenant_id", "section"),
    )

    staff_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("staff_users.id", ondelete="SET NULL"), default=None
    )
    staff_name: Mapped[str] = mapped_column(String(120))
    staff_role: Mapped[StaffRole] = mapped_column(enum_column(StaffRole))

    # Раздел админки: orders, guests, menu — по нему фильтруется журнал
    section: Mapped[str] = mapped_column(String(32))
    # Название ручки из её описания: «Сменить статус заказа»
    title: Mapped[str] = mapped_column(String(160))
    method: Mapped[str] = mapped_column(String(8))
    path: Mapped[str] = mapped_column(String(200))

    # Что именно поменяли: заполняется в ручках, где ошибка стоит денег
    summary: Mapped[str | None] = mapped_column(String(300), default=None)
    object_id: Mapped[str | None] = mapped_column(String(64), default=None)

    status_code: Mapped[int] = mapped_column(default=200)
    ip: Mapped[str | None] = mapped_column(String(45), default=None)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
