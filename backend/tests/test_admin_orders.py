"""Список заказов в панели и правка состава оператором.

Список — то, с чего начинается смена: он должен считать честно и не тянуть
лишнего. Правка состава меняет деньги гостя, поэтому проверяется отдельно.
"""

from collections.abc import AsyncGenerator
from uuid import uuid4

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import OrderStatus, OrderType, PaymentMethod
from app.models.loyalty import LoyaltyAccount, LoyaltyTransaction
from app.models.menu import Dish
from app.models.order import Order, OrderItem
from app.services import order as order_service


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
