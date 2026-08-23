"""Общие приспособления для тестов.

Тесты ходят в ту же базу, что и разработка, но каждый работает в транзакции,
которая откатывается: следов после прогона не остаётся.
"""

import os
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

os.environ.setdefault("ENVIRONMENT", "local")

from app.api.deps import get_current_guest
from app.core.db import SessionLocal, get_session
from app.core.tenants import get_tenant
from app.main import app
from app.models.geo import City, Restaurant
from app.models.guest import Guest
from app.models.loyalty import LoyaltyAccount

TENANT_ID = "mamaroma"


@pytest.fixture
async def session() -> AsyncGenerator[AsyncSession]:
    async with SessionLocal() as db:
        yield db
        await db.rollback()


@pytest.fixture
def tenant():
    return get_tenant(TENANT_ID)


@pytest.fixture
async def guest(session: AsyncSession) -> AsyncGenerator[Guest]:
    """Свежий гость с балльным счётом. После теста удаляется вместе со счётом."""
    row = Guest(
        tenant_id=TENANT_ID,
        phone=f"+7999{uuid4().hex[:7]}",
        name="Тестовый гость",
        consent_at=datetime.now(UTC),
        consent_version="1",
    )
    session.add(row)
    await session.flush()

    account = LoyaltyAccount(
        tenant_id=TENANT_ID,
        guest_id=row.id,
        card_number=f"{uuid4().int % 1_000_000:06d}",
        tier_code="ospite",
        points_balance=0,
    )
    session.add(account)
    await session.commit()

    # Идентификатор запоминаем числом: после отката объект «протухает», и
    # обращение к его полям полезло бы в базу из синхронного кода
    guest_id = row.id

    yield row

    # Тест мог сам удалить счёт (например, проверяя удаление аккаунта) —
    # чистим через запросы, а не через объекты, чтобы это было безобидно
    await session.rollback()
    await session.execute(delete(LoyaltyAccount).where(LoyaltyAccount.guest_id == guest_id))
    await session.execute(delete(Guest).where(Guest.id == guest_id))
    await session.commit()


@pytest.fixture
async def restaurant(session: AsyncSession) -> Restaurant:
    """Первая живая точка сети: тесты опираются на импортированные данные."""
    found = await session.scalar(
        select(Restaurant).where(
            Restaurant.tenant_id == TENANT_ID, Restaurant.is_active.is_(True)
        )
    )
    assert found is not None, "в базе нет ресторанов — прогоните импорт"
    return found


@pytest.fixture
async def city(session: AsyncSession) -> City:
    found = await session.scalar(select(City).where(City.tenant_id == TENANT_ID))
    assert found is not None, "в базе нет городов — прогоните импорт"
    return found


@pytest.fixture
async def client(session: AsyncSession, guest: Guest) -> AsyncGenerator[AsyncClient]:
    """Клиент к приложению, уже «вошедший» указанным гостем."""

    async def use_session() -> AsyncGenerator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = use_session
    app.dependency_overrides[get_current_guest] = lambda: guest

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Tenant-Id": TENANT_ID},
    ) as http:
        yield http

    app.dependency_overrides.clear()
