"""Оценка доставленного заказа.

Отзыв видит только персонал, поэтому здесь важны не тексты, а правила: оценить
можно свой заказ, только после доставки и только один раз.
"""

from collections.abc import AsyncGenerator

import pytest
from httpx import AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import OrderStatus, OrderType, PaymentMethod
from app.models.feedback import OrderFeedback
from app.models.order import Order


@pytest.fixture
async def order(session: AsyncSession, tenant, guest, restaurant) -> AsyncGenerator[Order]:
    row = Order(
        tenant_id=tenant.id,
        number="240824-0001",
        guest_id=guest.id,
        restaurant_id=restaurant.id,
        type=OrderType.DELIVERY,
        status=OrderStatus.COMPLETED,
        payment_method=PaymentMethod.CASH_ON_DELIVERY,
        contact_phone=guest.phone,
        subtotal_kopecks=100_000,
        total_kopecks=100_000,
    )
    session.add(row)
    await session.commit()

    order_id = row.id
    yield row

    await session.rollback()
    await session.execute(delete(OrderFeedback).where(OrderFeedback.order_id == order_id))
    await session.execute(delete(Order).where(Order.id == order_id))
    await session.commit()


async def test_ocenka_sohranyaetsya(client: AsyncClient, order: Order):
    response = await client.post(
        f"/api/v1/orders/{order.id}/feedback",
        json={"rating": 5, "tags": ["Быстро", "Вкусно"], "comment": "Спасибо!"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["rating"] == 5
    assert body["tags"] == ["Быстро", "Вкусно"]


async def test_ocenit_dvazhdy_nelzya(client: AsyncClient, order: Order):
    """Спрашиваем один раз: повтор отклоняем, а не переписываем прежний отзыв."""
    first = await client.post(
        f"/api/v1/orders/{order.id}/feedback", json={"rating": 5, "tags": [], "comment": None}
    )
    assert first.status_code == 201

    second = await client.post(
        f"/api/v1/orders/{order.id}/feedback", json={"rating": 1, "tags": [], "comment": None}
    )
    assert second.status_code == 409


async def test_nedostavlennyj_zakaz_ne_ocenivaetsya(
    client: AsyncClient, session: AsyncSession, order: Order
):
    order.status = OrderStatus.DELIVERING
    await session.commit()

    response = await client.post(
        f"/api/v1/orders/{order.id}/feedback", json={"rating": 5, "tags": [], "comment": None}
    )

    assert response.status_code == 400


async def test_chuzhoj_zakaz_ne_najden(client: AsyncClient, session: AsyncSession, order: Order):
    """Чужой заказ для гостя не существует — это 404, а не «нельзя»."""
    from uuid import uuid4

    response = await client.post(
        f"/api/v1/orders/{uuid4()}/feedback", json={"rating": 5, "tags": [], "comment": None}
    )

    assert response.status_code == 404


async def test_v_kartochke_vidno_chto_ocenen(client: AsyncClient, order: Order):
    """Приложение по этому полю понимает, спрашивать оценку или нет."""
    before = await client.get(f"/api/v1/orders/{order.id}")
    assert before.json()["feedback_left"] is False

    await client.post(
        f"/api/v1/orders/{order.id}/feedback", json={"rating": 4, "tags": [], "comment": None}
    )

    after = await client.get(f"/api/v1/orders/{order.id}")
    assert after.json()["feedback_left"] is True


async def test_ocenka_vne_diapazona(client: AsyncClient, order: Order):
    response = await client.post(
        f"/api/v1/orders/{order.id}/feedback", json={"rating": 6, "tags": [], "comment": None}
    )

    assert response.status_code == 422
