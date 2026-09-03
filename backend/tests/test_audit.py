"""Журнал действий сотрудников.

Смысл журнала в том, что запись появляется сама. Проверяем, что она есть
после изменения, что читающие запросы его не засоряют и что в денежных
местах рядом с действием стоит человеческое описание.
"""

from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_staff, get_session
from app.main import app
from app.models.audit import StaffAuditLog
from app.models.enums import StaffRole
from app.models.guest import Guest
from app.models.staff import StaffUser

TENANT_ID = "mamaroma"


@pytest.fixture
async def acting(session: AsyncSession) -> AsyncGenerator[StaffUser]:
    row = StaffUser(
        id=uuid4(),
        tenant_id=TENANT_ID,
        email=f"{uuid4().hex[:10]}@mamaroma-test.ru",
        password_hash="x",
        name="Ольга Смена",
        role=StaffRole.OWNER,
        permissions={},
        restaurant_ids=[],
    )
    session.add(row)
    await session.commit()
    row_id = row.id

    async def use_session() -> AsyncGenerator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = use_session
    app.dependency_overrides[get_current_staff] = lambda: row

    yield row

    app.dependency_overrides.clear()
    await session.rollback()
    await session.execute(delete(StaffAuditLog).where(StaffAuditLog.staff_id == row_id))
    await session.execute(delete(StaffUser).where(StaffUser.id == row_id))
    await session.commit()


@pytest.fixture
async def panel(acting: StaffUser) -> AsyncGenerator[AsyncClient]:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Tenant-Id": TENANT_ID},
    ) as http:
        yield http


async def last_entry(session: AsyncSession, staff_id: UUID) -> StaffAuditLog | None:
    """Журнал пишется своей сессией, поэтому читаем его после отката теста."""
    await session.rollback()
    return await session.scalar(
        select(StaffAuditLog)
        .where(StaffAuditLog.staff_id == staff_id)
        .order_by(StaffAuditLog.created_at.desc())
    )


async def test_nachislenie_ballov_popadaet_v_zhurnal(
    panel: AsyncClient, session: AsyncSession, acting: StaffUser, guest: Guest
):
    """Главный вопрос к журналу — кто трогал деньги гостя."""
    acting_id = acting.id
    answer = await panel.post(
        f"/api/v1/admin/guests/{guest.id}/points",
        json={"points": 500, "comment": "извинение за опоздание"},
    )
    assert answer.status_code == 200

    entry = await last_entry(session, acting_id)
    assert entry is not None
    assert entry.staff_name == "Ольга Смена"
    assert entry.section == "guests"
    assert entry.title == "Начислить или списать баллы"
    assert entry.summary is not None
    assert "500" in entry.summary
    assert "извинение за опоздание" in entry.summary


async def test_prosmotr_zhurnal_ne_zasoryaet(
    panel: AsyncClient, session: AsyncSession, acting: StaffUser
):
    """Иначе журнал за день утонет в открытых списках заказов."""
    acting_id = acting.id
    await panel.get("/api/v1/admin/orders")
    await panel.get("/api/v1/admin/guests")

    assert await last_entry(session, acting_id) is None


async def test_neudachnoe_deystvie_ne_pishetsya(
    panel: AsyncClient, session: AsyncSession, acting: StaffUser
):
    """Отказ — это не изменение: в базе ничего не поменялось."""
    acting_id = acting.id
    answer = await panel.post(
        f"/api/v1/admin/guests/{uuid4()}/points",
        json={"points": 100},
    )
    assert answer.status_code == 404
    assert await last_entry(session, acting_id) is None


async def test_zhurnal_otdaetsya_s_filtrami(
    panel: AsyncClient, session: AsyncSession, acting: StaffUser, guest: Guest
):
    await panel.post(f"/api/v1/admin/guests/{guest.id}/points", json={"points": 10})

    everything = await panel.get("/api/v1/admin/audit")
    assert everything.status_code == 200
    body = everything.json()
    assert body["total"] >= 1
    assert "guests" in body["sections"]

    mine = await panel.get(f"/api/v1/admin/audit?staff_id={acting.id}&section=guests")
    assert mine.status_code == 200
    assert all(row["staff_id"] == str(acting.id) for row in mine.json()["rows"])

    empty = await panel.get("/api/v1/admin/audit?section=iiko")
    assert empty.json()["rows"] == []
