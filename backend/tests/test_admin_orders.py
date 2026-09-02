"""Список заказов в панели и правка состава оператором.

Список — то, с чего начинается смена: он должен считать честно и не тянуть
лишнего. Правка состава меняет деньги гостя, поэтому проверяется отдельно.
"""

from collections.abc import AsyncGenerator
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_staff, get_session
from app.main import app
from app.models.enums import OrderStatus, OrderType, PaymentMethod
from app.models.loyalty import LoyaltyAccount, LoyaltyTransaction
from app.models.menu import Dish
from app.models.order import Order, OrderItem
from app.models.staff import StaffUser
from app.services import order as order_service

TENANT_ID = "mamaroma"


@pytest.fixture
async def panel(session: AsyncSession, tenant) -> AsyncGenerator[AsyncClient]:
    """Клиент панели: вход сотрудника подменяем, проверяем сами ручки."""
    staff = await session.scalar(select(StaffUser).where(StaffUser.tenant_id == tenant.id))
    assert staff is not None, "в базе нет сотрудника — прогоните seed"

    async def use_session() -> AsyncGenerator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = use_session
    app.dependency_overrides[get_current_staff] = lambda: staff

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Tenant-Id": TENANT_ID},
    ) as http:
        yield http

    app.dependency_overrides.clear()


@pytest.fixture
async def dishes(session: AsyncSession, tenant) -> list[Dish]:
    """Два живых блюда из меню сети: на них считается вся арифметика."""
    rows = list(
        await session.scalars(
            select(Dish).where(Dish.tenant_id == tenant.id, Dish.is_active.is_(True)).limit(2)
        )
    )
    assert len(rows) == 2, "в базе меньше двух блюд — прогоните импорт меню"
    return rows


@pytest.fixture
async def order(
    session: AsyncSession, tenant, guest, restaurant, dishes: list[Dish]
) -> AsyncGenerator[Order]:
    row = Order(
        tenant_id=tenant.id,
        number=f"т-{uuid4().hex[:6]}",
        guest_id=guest.id,
        restaurant_id=restaurant.id,
        type=OrderType.DELIVERY,
        status=OrderStatus.ACCEPTED,
        payment_method=PaymentMethod.CASH_ON_DELIVERY,
        contact_phone=guest.phone,
        subtotal_kopecks=0,
        total_kopecks=0,
    )

    for dish in dishes:
        row.items.append(
            OrderItem(
                tenant_id=tenant.id,
                dish_id=dish.id,
                name=dish.name,
                unit_price_kopecks=dish.price_kopecks,
                quantity=1,
                total_kopecks=dish.price_kopecks,
            )
        )

    row.subtotal_kopecks = sum(item.total_kopecks for item in row.items)
    row.total_kopecks = row.subtotal_kopecks

    session.add(row)
    await session.commit()

    order_id = row.id
    yield row

    await session.rollback()
    await session.execute(delete(LoyaltyTransaction).where(LoyaltyTransaction.order_id == order_id))
    await session.execute(delete(OrderItem).where(OrderItem.order_id == order_id))
    await session.execute(delete(Order).where(Order.id == order_id))
    await session.commit()


async def test_snyatie_blyuda_umenshaet_schet(
    session: AsyncSession, tenant, order: Order, dishes: list[Dish]
):
    """Оператор убрал позицию — сумма пересчиталась по оставшейся."""
    await order_service.edit_items(session, tenant, order, {dishes[0].id: 1}, 5)
    await session.commit()

    assert len(order.items) == 1
    assert order.subtotal_kopecks == dishes[0].price_kopecks
    assert order.total_kopecks == dishes[0].price_kopecks


async def test_dobavlenie_i_kolichestvo(
    session: AsyncSession, tenant, order: Order, dishes: list[Dish]
):
    """Количество меняется, а сумма считается по цене из базы, не из запроса."""
    await order_service.edit_items(session, tenant, order, {dishes[0].id: 3, dishes[1].id: 1}, 5)
    await session.commit()

    expected = dishes[0].price_kopecks * 3 + dishes[1].price_kopecks
    assert order.subtotal_kopecks == expected


async def test_pustoj_sostav_ne_prinimaetsya(
    session: AsyncSession, tenant, order: Order, dishes: list[Dish]
):
    """Заказ без единого блюда — это отмена, а не правка."""
    with pytest.raises(order_service.OrderError):
        await order_service.edit_items(session, tenant, order, {dishes[0].id: 0}, 5)


async def test_lishnie_bally_vozvrashchayutsya_gostyu(
    session: AsyncSession, tenant, guest, order: Order, dishes: list[Dish]
):
    """Чек похудел — списание урезается до половины, разница уходит на счёт."""
    account = await session.scalar(
        select(LoyaltyAccount).where(LoyaltyAccount.guest_id == guest.id)
    )
    assert account is not None

    # Списываем половину от текущей суммы блюд
    order.points_spent = order.subtotal_kopecks // 100 // 2
    before = account.points_balance
    await session.commit()

    await order_service.edit_items(session, tenant, order, {dishes[0].id: 1}, 5)
    await session.commit()

    cap = order.subtotal_kopecks // 100 // 2
    assert order.points_spent <= cap
    assert account.points_balance >= before


async def test_keshbek_ot_fakticheskoj_summy(
    session: AsyncSession, tenant, order: Order, dishes: list[Dish]
):
    """Начисляем с того, что гость платит после правки."""
    await order_service.edit_items(session, tenant, order, {dishes[0].id: 1}, 10)
    await session.commit()

    assert order.points_earned == order.total_kopecks // 100 * 10 // 100


async def test_chuzhoe_blyudo_ne_prohodit(session: AsyncSession, tenant, order: Order):
    """Идентификатор из другой сети или выдуманный — отказ, а не пустая позиция."""
    with pytest.raises(order_service.OrderError):
        await order_service.edit_items(session, tenant, order, {uuid4(): 1}, 5)


async def test_kartochka_otdaet_gostya_i_sostav(panel: AsyncClient, order: Order):
    """Карточка заказа — это всё, что оператор говорит гостю по телефону."""
    response = await panel.get(f"/api/v1/admin/orders/{order.id}")

    assert response.status_code == 200
    card = response.json()
    assert card["number"] == order.number
    assert len(card["items"]) == 2
    assert "guest_phone" in card and "guest_points_balance" in card
    assert card["editable"] is True


async def test_zakrytyj_zakaz_ne_pravitsya_iz_paneli(
    panel: AsyncClient, session: AsyncSession, order: Order, dishes: list[Dish]
):
    """Заказ выполнен — деньги и баллы по нему сошлись, состав уже история."""
    order.status = OrderStatus.COMPLETED
    await session.commit()

    response = await panel.put(
        f"/api/v1/admin/orders/{order.id}/items",
        json={"items": [{"dish_id": str(dishes[0].id), "quantity": 1}]},
    )

    assert response.status_code == 400
    assert len(order.items) == 2


async def test_spisok_schitaet_vkladki(panel: AsyncClient, order: Order):
    """Счётчики вкладок считаются по всей выборке, а не по странице."""
    response = await panel.get("/api/v1/admin/orders", params={"group": "active", "limit": 1})

    assert response.status_code == 200
    page = response.json()
    assert page["counts"]["active"] >= 1
    assert page["counts"]["all"] >= page["counts"]["active"]
    assert len(page["rows"]) <= 1
    assert page["rows"][0]["positions"] > 0
