from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TenantMixin, TimestampMixin, UUIDMixin


class SyncRun(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Сверка каталога с сайтом.

    Живёт в базе, а не в памяти процесса: сверка идёт минутами, админка
    показывает её ход и результат, а второй такой же запуск не пускает.
    """

    __tablename__ = "sync_runs"

    # menu, restaurants, promos
    kind: Mapped[str] = mapped_column(String(20), index=True)
    # checking — читаем сайт, ready — список готов, applying, done, failed
    status: Mapped[str] = mapped_column(String(10), default="checking")

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    # Сколько позиций сверили и не тронули — их в списке нет
    unchanged: Mapped[int] = mapped_column(default=0)
    created: Mapped[int] = mapped_column(default=0)
    updated: Mapped[int] = mapped_column(default=0)
    removed: Mapped[int] = mapped_column(default=0)

    message: Mapped[str | None] = mapped_column(Text, default=None)


class SyncChange(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Одно предлагаемое изменение: пока не применено — база не тронута."""

    __tablename__ = "sync_changes"

    run_id: Mapped[UUID] = mapped_column(
        ForeignKey("sync_runs.id", ondelete="CASCADE"), index=True
    )

    # create, update, delete
    action: Mapped[str] = mapped_column(String(10))
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(String(400), default="")
    group: Mapped[str | None] = mapped_column(String(120), default=None)

    external_id: Mapped[str] = mapped_column(String(80))
    payload: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict)

    applied: Mapped[bool] = mapped_column(default=False)
