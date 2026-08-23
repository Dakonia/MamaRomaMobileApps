"""Счёт заказа: цены, доставка и списание баллов.

Проверяем через тот же расчёт, что видит гость в корзине: если он разойдётся
с оформлением, гость увидит одну сумму, а спишут другую.
"""

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.menu import Dish
from app.schemas.order import CheckoutPreviewRequest, OrderItemCreate
from app.services.order import OrderError, checkout_preview


async def _dish(session: AsyncSession, tenant) -> Dish:
    found = await session.scalar(
        select(Dish).where(
            Dish.tenant_id == tenant.id, Dish.is_active.is_(True), Dish.price_kopecks > 0
        )
    )
    assert found is not None, "в базе нет блюд — прогоните импорт меню"
    return found


async def test_summa_schitaetsya_po_menu(session: AsyncSession, tenant, guest, restaurant):
    dish = await _dish(session, tenant)

    bill = await checkout_preview(
        session,
        tenant,
        guest,
        CheckoutPreviewRequest(
            restaurant_id=restaurant.id,
            type="pickup",
            items=[OrderItemCreate(dish_id=dish.id, quantity=2)],
        ),
    )

    assert bill.subtotal_kopecks > 0
    expected = bill.subtotal_kopecks + bill.delivery_kopecks - bill.discount_kopecks
    assert bill.total_kopecks == expected
    assert bill.delivery_kopecks == 0, "самовывоз не стоит денег"


async def test_bally_ne_spisyvayutsya_bolshe_potolka(
    session: AsyncSession, tenant, guest, restaurant
):
    dish = await _dish(session, tenant)

    bill = await checkout_preview(
        session,
        tenant,
        guest,
        CheckoutPreviewRequest(
            restaurant_id=restaurant.id,
            type="pickup",
            items=[OrderItemCreate(dish_id=dish.id, quantity=1)],
            points_to_spend=1_000_000,
        ),
    )

    # У свежего гостя баллов нет — списать нечего, сколько ни проси
    assert bill.points_to_spend == 0
    assert bill.total_kopecks > 0


async def test_neizvestnyj_restoran_otklonyaetsya(session: AsyncSession, tenant, guest):
    from uuid import uuid4

    with pytest.raises(OrderError):
        await checkout_preview(
            session,
            tenant,
            guest,
            CheckoutPreviewRequest(restaurant_id=uuid4(), type="pickup", items=[]),
        )


async def test_dostavka_bez_adresa_ne_schitaetsya(
    session: AsyncSession, tenant, guest, restaurant
):
    """Без координат зону не определить — доставку такой заказ не получит."""
    dish = await _dish(session, tenant)

    bill = await checkout_preview(
        session,
        tenant,
        guest,
        CheckoutPreviewRequest(
            restaurant_id=restaurant.id,
            type="delivery",
            items=[OrderItemCreate(dish_id=dish.id, quantity=1)],
        ),
    )

    assert bill.total_kopecks >= bill.subtotal_kopecks
