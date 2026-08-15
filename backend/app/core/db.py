from collections.abc import AsyncGenerator
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, MetaData, String, func
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.config import settings

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class UUIDMixin:
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TenantMixin:
    """Каждая доменная таблица несёт tenant_id — изоляция сетей с первого дня."""

    tenant_id: Mapped[str] = mapped_column(index=True)


class ExternalSyncMixin:
    """Связь с внешней системой ресторана (iiko, r_keeper).

    Пока пусто: меню ведём у себя. Когда включим синхронизацию, маппинг уже
    будет чем хранить — миграция на живых данных не потребуется.
    """

    external_id: Mapped[str | None] = mapped_column(String(64), index=True, default=None)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


engine = create_async_engine(
    str(settings.database_url),
    echo=settings.debug,
    pool_pre_ping=True,
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncGenerator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
