"""Права сотрудников админки.

Роль сама по себе ничего не значит — значение имеет то, что она пропускает
и что останавливает. Проверяем места, где ошибка стоит денег или данных:
баллы, отмена заказа, правка ресторана, ключи кассы и последний владелец сети.
"""

from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_staff, get_session
from app.core.permissions import OWNER_ONLY, Permission, permissions_for
from app.core.security import hash_password
from app.main import app
from app.models.enums import OrderStatus, OrderType, PaymentMethod, StaffRole
from app.models.geo import Restaurant
from app.models.guest import Guest
from app.models.order import Order
from app.models.staff import StaffUser

TENANT_ID = "mamaroma"


@pytest.fixture
def panel(session: AsyncSession):
    """Фабрика клиента админки: вход подменяем сотрудником нужной роли."""

    def make(role: StaffRole, overrides: dict[str, bool] | None = None) -> AsyncClient:
        staff = StaffUser(
            id=uuid4(),
            tenant_id=TENANT_ID,
            email=f"{uuid4().hex[:10]}@mamaroma-test.ru",
            password_hash="x",
            name="Тестовый сотрудник",
            role=role,
            permissions=overrides or {},
            restaurant_ids=[],
        )

        async def use_session() -> AsyncGenerator[AsyncSession]:
            yield session

        app.dependency_overrides[get_session] = use_session
        app.dependency_overrides[get_current_staff] = lambda: staff

        return AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            headers={"X-Tenant-Id": TENANT_ID},
        )

    yield make

    app.dependency_overrides.clear()


# --- набор прав ---------------------------------------------------------------


def test_role_defaults():
    operator = permissions_for(StaffRole.DELIVERY_OPERATOR)
    assert Permission.ORDERS_STATUS in operator
    assert Permission.GUESTS_VIEW in operator
    assert Permission.GUESTS_POINTS not in operator
    assert Permission.RESERVATIONS_VIEW not in operator

    marketing = permissions_for(StaffRole.MARKETING)
    assert Permission.CAMPAIGNS_SEND in marketing
    assert Permission.MENU_EDIT not in marketing


def test_owner_gets_everything_and_ignores_overrides():
    """Владельца сети нельзя отрезать от собственной админки."""
    everything = permissions_for(StaffRole.OWNER, {"orders.view": False, "guests.points": False})
    assert everything == frozenset(Permission)


def test_overrides_add_and_remove():
    granted = permissions_for(
        StaffRole.DELIVERY_OPERATOR,
        {"guests.points": True, "orders.cancel": False},
    )
    assert Permission.GUESTS_POINTS in granted
    assert Permission.ORDERS_CANCEL not in granted


def test_owner_only_cannot_be_granted_by_flag():
    """Ключи кассы и раздача доступов остаются за суперпользователем."""
    granted = permissions_for(
        StaffRole.NETWORK_MANAGER,
        {"iiko.secrets": True, "staff.manage": True},
    )
    assert not (granted & OWNER_ONLY)


def test_unknown_flag_is_ignored():
    """Снятая ручка не должна ронять вход тем, кому её когда-то настраивали."""
    granted = permissions_for(StaffRole.MARKETING, {"menu.teleport": True})
    assert Permission.CAMPAIGNS_VIEW in granted


# --- проверки на живых ручках -------------------------------------------------


async def test_operator_cannot_grant_points(panel, guest: Guest):
    async with panel(StaffRole.DELIVERY_OPERATOR) as http:
        answer = await http.post(
            f"/api/v1/admin/guests/{guest.id}/points",
            json={"points": 100_000, "comment": "себе"},
        )
    assert answer.status_code == 403


async def test_points_open_up_with_a_flag(panel, guest: Guest):
    """Тот же оператор с флагом — уже может: ради этого флаги и заводились."""
    async with panel(StaffRole.DELIVERY_OPERATOR, {"guests.points": True}) as http:
        answer = await http.post(
            f"/api/v1/admin/guests/{guest.id}/points",
            json={"points": 100, "comment": "компенсация"},
        )
    assert answer.status_code == 200


async def test_operator_pauses_restaurant_but_does_not_edit_it(panel, restaurant: Restaurant):
    async with panel(StaffRole.DELIVERY_OPERATOR) as http:
        allowed = await http.patch(
            f"/api/v1/admin/restaurants/{restaurant.id}",
            json={"has_delivery": restaurant.has_delivery},
        )
        denied = await http.patch(
            f"/api/v1/admin/restaurants/{restaurant.id}",
            json={"address": "Подменённый адрес"},
        )

    assert allowed.status_code == 200
    assert denied.status_code == 403


async def test_cancelling_an_order_needs_its_own_permission(
    panel, session: AsyncSession, restaurant: Restaurant, guest: Guest
):
    """Смена статуса и отмена — разные права: за отменой идёт возврат денег."""
    order = Order(
        tenant_id=TENANT_ID,
        guest_id=guest.id,
        restaurant_id=restaurant.id,
        number=f"T-{uuid4().hex[:6]}",
        type=OrderType.PICKUP,
        status=OrderStatus.ACCEPTED,
        contact_phone=guest.phone,
        payment_method=PaymentMethod.CASH_ON_DELIVERY,
        subtotal_kopecks=50_000,
        total_kopecks=50_000,
    )
    session.add(order)
    await session.commit()

    async with panel(StaffRole.DELIVERY_OPERATOR, {"orders.cancel": False}) as http:
        denied = await http.patch(
            f"/api/v1/admin/orders/{order.id}",
            json={"status": OrderStatus.CANCELLED.value},
        )
        allowed = await http.patch(
            f"/api/v1/admin/orders/{order.id}",
            json={"status": OrderStatus.COOKING.value},
        )

    assert denied.status_code == 403
    assert allowed.status_code == 200

    await session.execute(delete(Order).where(Order.id == order.id))
    await session.commit()


async def test_marketing_cannot_touch_the_menu(panel):
    async with panel(StaffRole.MARKETING) as http:
        answer = await http.post(
            "/api/v1/admin/categories",
            json={"name": "Проверка", "slug": "proverka"},
        )
    assert answer.status_code == 403


async def test_iiko_secret_stays_with_the_owner(panel, restaurant: Restaurant):
    async with panel(StaffRole.NETWORK_MANAGER, {"iiko.secrets": True}) as http:
        answer = await http.post(f"/api/v1/admin/iiko/bridges/{restaurant.id}/secret")
    assert answer.status_code == 403


async def test_courier_is_not_allowed_into_the_admin_panel(panel):
    """Роль заведена заранее, но веб-админка не её место."""
    async with panel(StaffRole.COURIER) as http:
        answer = await http.get("/api/v1/admin/orders")
    assert answer.status_code == 403


# --- сотрудники ---------------------------------------------------------------


@pytest.fixture
async def acting_owner(session: AsyncSession) -> AsyncGenerator[StaffUser]:
    """Временный владелец, от чьего лица ходим в ручки сотрудников."""
    row = StaffUser(
        id=uuid4(),
        tenant_id=TENANT_ID,
        email=f"{uuid4().hex[:10]}@mamaroma-test.ru",
        password_hash=hash_password("довольно длинный пароль"),
        name="Временный владелец",
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
    await session.execute(delete(StaffUser).where(StaffUser.id == row_id))
    await session.commit()


@pytest.fixture
async def staff_client(acting_owner: StaffUser) -> AsyncGenerator[AsyncClient]:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Tenant-Id": TENANT_ID},
    ) as http:
        yield http


async def test_cannot_change_own_role(staff_client: AsyncClient, acting_owner: StaffUser):
    """Иначе можно снять с себя роль и остаться в админке без доступа."""
    answer = await staff_client.patch(
        f"/api/v1/admin/staff/{acting_owner.id}",
        json={"role": StaffRole.MARKETING.value},
    )
    assert answer.status_code == 400


async def test_cannot_delete_self(staff_client: AsyncClient, acting_owner: StaffUser):
    answer = await staff_client.delete(f"/api/v1/admin/staff/{acting_owner.id}")
    assert answer.status_code == 400


async def test_last_owner_is_protected(
    staff_client: AsyncClient, acting_owner: StaffUser, session: AsyncSession
):
    """Сеть без действующего суперпользователя остаётся без доступа к самой себе."""
    others = list(
        await session.scalars(
            select(StaffUser).where(
                StaffUser.tenant_id == TENANT_ID,
                StaffUser.role == StaffRole.OWNER,
                StaffUser.is_active.is_(True),
                StaffUser.id != acting_owner.id,
            )
        )
    )

    # На время проверки временный владелец остаётся единственным действующим
    for row in others:
        row.is_active = False
    await session.commit()

    try:
        created = await staff_client.post(
            "/api/v1/admin/staff",
            json={
                "email": f"{uuid4().hex[:10]}@mamaroma-test.ru",
                "name": "Оператор смены",
                "role": StaffRole.DELIVERY_OPERATOR.value,
                "password": "довольно длинный пароль",
                "overrides": {"guests.points": True},
            },
        )
        blocked = await staff_client.patch(
            f"/api/v1/admin/staff/{acting_owner.id}",
            json={"is_active": False},
        )
    finally:
        for row in others:
            row.is_active = True
        await session.commit()

    assert created.status_code == 201
    assert created.json()["overrides"] == {"guests.points": True}
    assert "guests.points" in created.json()["permissions"]

    # Себя выключать нельзя в любом случае, а последнего владельца — тем более
    assert blocked.status_code == 400

    await session.execute(delete(StaffUser).where(StaffUser.id == UUID(created.json()["id"])))
    await session.commit()


async def test_owner_only_flags_are_refused(staff_client: AsyncClient):
    """Ключ от кассы нельзя выдать даже намеренно."""
    answer = await staff_client.post(
        "/api/v1/admin/staff",
        json={
            "email": f"{uuid4().hex[:10]}@mamaroma-test.ru",
            "name": "Управляющий",
            "role": StaffRole.NETWORK_MANAGER.value,
            "password": "довольно длинный пароль",
            "overrides": {"iiko.secrets": True},
        },
    )
    assert answer.status_code == 400
