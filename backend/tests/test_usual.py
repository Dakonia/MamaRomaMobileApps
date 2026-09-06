"""Полка «как обычно»: что гость берёт из раза в раз.

Обещание у полки сильное — «вы это обычно берёте», — и подвести она может
двумя способами: показать случайное блюдо, взятое однажды, или предложить то,
чего сегодня нет на кухне. Проверяем оба.
"""

from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import OrderStatus, OrderType, PaymentMethod
from app.models.menu import Dish, StopListEntry
from app.models.order import Order, OrderItem
from app.services import menu as menu_service


@pytest.fixture
async def dishes(session: AsyncSession, tenant) -> list[Dish]:
    rows = list(
        await session.scalars(
            select(Dish)
            .where(Dish.tenant_id == tenant.id, Dish.is_active.is_(True))
            .order_by(Dish.name)
            .limit(3)
        )
    )
    assert len(rows) == 3, "в базе меньше трёх блюд — прогоните импорт меню"
    return rows


@pytest.fixture
async def made(session: AsyncSession, tenant, guest, restaurant) -> AsyncGenerator[list[UUID]]:
    """Заказы гостя, которые заводит сам тест. Убираем их за собой."""
    created: list[UUID] = []

    yield created

    await session.rollback()
    await session.execute(delete(OrderItem).where(OrderItem.order_id.in_(created)))
    await session.execute(delete(Order).where(Order.id.in_(created)))
    await session.commit()


async def place(
    session: AsyncSession,
    tenant,
    guest,
    restaurant,
    made: list[UUID],
    dishes: list[Dish],
    status: OrderStatus = OrderStatus.COMPLETED,
) -> Order:
    order = Order(
        tenant_id=tenant.id,
        number=f"о-{uuid4().hex[:6]}",
        guest_id=guest.id,
        restaurant_id=restaurant.id,
        type=OrderType.DELIVERY,
        status=status,
        payment_method=PaymentMethod.CASH_ON_DELIVERY,
        contact_phone=guest.phone,
        subtotal_kopecks=0,
        total_kopecks=0,
    )

    for dish in dishes:
        order.items.append(
            OrderItem(
                tenant_id=tenant.id,
                dish_id=dish.id,
                name=dish.name,
                unit_price_kopecks=dish.price_kopecks,
                quantity=1,
                total_kopecks=dish.price_kopecks,
            )
        )

    session.add(order)
    await session.commit()
    made.append(order.id)
    return order


async def test_odnogo_zakaza_malo(session: AsyncSession, tenant, guest, restaurant, made, dishes):
    """Взял один раз — это не «обычно»."""
    await place(session, tenant, guest, restaurant, made, [dishes[0]])

    shelf = await menu_service.get_usual(session, tenant.id, guest.id)

    assert shelf == []


async def test_dva_zakaza_delayut_privychku(
    session: AsyncSession, tenant, guest, restaurant, made, dishes
):
    """Одно и то же дважды — уже привычка, её и показываем."""
    await place(session, tenant, guest, restaurant, made, [dishes[0]])
    await place(session, tenant, guest, restaurant, made, [dishes[0], dishes[1]])

    shelf = await menu_service.get_usual(session, tenant.id, guest.id)

    assert [row.id for row in shelf] == [dishes[0].id]


async def test_chastoe_vperedi(session: AsyncSession, tenant, guest, restaurant, made, dishes):
    """Что берут чаще, то и выше на полке."""
    for _ in range(3):
        await place(session, tenant, guest, restaurant, made, [dishes[0], dishes[1]])
    await place(session, tenant, guest, restaurant, made, [dishes[1]])

    shelf = await menu_service.get_usual(session, tenant.id, guest.id)

    assert [row.id for row in shelf] == [dishes[1].id, dishes[0].id]


async def test_otmenennyj_zakaz_ne_schitaetsya(
    session: AsyncSession, tenant, guest, restaurant, made, dishes
):
    """Отменённый заказ гость не ел — в привычку он не идёт."""
    await place(session, tenant, guest, restaurant, made, [dishes[0]])
    await place(session, tenant, guest, restaurant, made, [dishes[0]], status=OrderStatus.CANCELLED)

    shelf = await menu_service.get_usual(session, tenant.id, guest.id)

    assert shelf == []


async def test_stop_list_ubiraet_s_polki(
    session: AsyncSession, tenant, guest, restaurant, made, dishes
):
    """Обещать «как обычно» и упереться в стоп-лист — обиднее всего."""
    await place(session, tenant, guest, restaurant, made, [dishes[0]])
    await place(session, tenant, guest, restaurant, made, [dishes[0]])

    stop = StopListEntry(tenant_id=tenant.id, restaurant_id=restaurant.id, dish_id=dishes[0].id)
    session.add(stop)
    await session.commit()

    try:
        shelf = await menu_service.get_usual(
            session, tenant.id, guest.id, restaurant_id=restaurant.id
        )
        assert shelf == []
    finally:
        await session.delete(stop)
        await session.commit()


async def test_chuzhie_zakazy_ne_vidny(
    session: AsyncSession, tenant, guest, restaurant, made, dishes
):
    """Полка личная: соседские привычки на ней не появляются."""
    await place(session, tenant, guest, restaurant, made, [dishes[0]])
    await place(session, tenant, guest, restaurant, made, [dishes[0]])

    shelf = await menu_service.get_usual(session, tenant.id, uuid4())

    assert shelf == []
