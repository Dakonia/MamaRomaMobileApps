"""Связь с кассой ресторана.

Здесь ошибка стоит дороже всего: заказ уедет не в тот ресторан, не с тем
блюдом или не уедет вовсе, а гость будет ждать. Поэтому проверяем то, что
касается денег и кухни: сопоставление своё у каждой точки, отмена доходит
до гостя, адрес не теряет квартиру.
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import OrderStatus, OrderType, PaymentMethod
from app.models.integration import IikoLink
from app.models.loyalty import LoyaltyAccount
from app.models.menu import Dish, MenuCategory
from app.models.order import Order, OrderItem
from app.services import iiko_bridge


@pytest.fixture
async def dish(session: AsyncSession, tenant):
    """Любое живое блюдо сети: сопоставление проверяем на настоящем."""
    found = await session.scalar(
        select(Dish)
        .join(MenuCategory, MenuCategory.id == Dish.category_id)
        .where(Dish.tenant_id == tenant.id, Dish.is_active.is_(True))
        .limit(1)
    )
    assert found is not None, "в базе нет блюд — прогоните импорт"
    return found


@pytest.fixture
async def order(session: AsyncSession, tenant, guest, restaurant, dish):
    row = Order(
        tenant_id=tenant.id,
        number=f"iiko-{uuid4().hex[:6]}",
        guest_id=guest.id,
        restaurant_id=restaurant.id,
        type=OrderType.DELIVERY,
        status=OrderStatus.CREATED,
        payment_method=PaymentMethod.CASH_ON_DELIVERY,
        contact_phone=guest.phone,
        address_text="Санкт-Петербург, Невский пр., 28, кв. 55",
        address_details={
            "street": "Невский пр.",
            "house": "28",
            "flat": "55",
            "entrance": "3",
            "floor": "4",
            "intercom": "55К",
            "locality": "Санкт-Петербург",
        },
        delivery_minutes=45,
        persons_count=2,
        subtotal_kopecks=100_000,
        total_kopecks=110_000,
        change_from_kopecks=200_000,
        items=[
            OrderItem(
                tenant_id=tenant.id,
                dish_id=dish.id,
                name=dish.name,
                extras=[],
                unit_price_kopecks=50_000,
                quantity=2,
                total_kopecks=100_000,
            )
        ],
    )
    session.add(row)
    await session.commit()

    order_id = row.id
    yield row

    await session.rollback()
    await session.execute(delete(Order).where(Order.id == order_id))
    await session.commit()


async def _link(session: AsyncSession, tenant, restaurant, dish, product_id: str) -> IikoLink:
    """Сопоставление блюда с товаром кассы конкретной точки."""
    link = await session.scalar(
        select(IikoLink).where(
            IikoLink.tenant_id == tenant.id,
            IikoLink.restaurant_id == restaurant.id,
            IikoLink.dish_id == dish.id,
        )
    )
    if link is None:
        link = IikoLink(
            tenant_id=tenant.id,
            restaurant_id=restaurant.id,
            dish_id=dish.id,
            product_id=product_id,
        )
        session.add(link)
    else:
        link.product_id = product_id

    await session.commit()
    return link


async def test_kod_tovara_beretsya_iz_sopostavleniya_etoy_tochki(
    session: AsyncSession, tenant, restaurant, dish, order
):
    """База iiko у каждого ресторана своя: код берём тот, что заведён здесь."""
    await _link(session, tenant, restaurant, dish, "product-of-this-point")

    payload = await iiko_bridge.build_order_payload(session, tenant, order)

    assert payload["items"][0]["productId"] == "product-of-this-point"
    assert payload["items"][0]["amount"] == 2


async def test_bez_sopostavleniya_kod_pustoy(
    session: AsyncSession, tenant, restaurant, dish, order
):
    """Не сопоставили — заказ уедет с пустым кодом, и плагин честно откажет."""
    await session.execute(
        delete(IikoLink).where(
            IikoLink.tenant_id == tenant.id,
            IikoLink.restaurant_id == restaurant.id,
            IikoLink.dish_id == dish.id,
        )
    )
    await session.commit()

    payload = await iiko_bridge.build_order_payload(session, tenant, order)

    assert payload["items"][0]["productId"] == ""


async def test_adres_uezzhaet_po_chastyam(session: AsyncSession, tenant, order):
    """Квартира, подъезд, этаж и домофон — отдельными полями, иначе курьер их не увидит."""
    payload = await iiko_bridge.build_order_payload(session, tenant, order)
    address = payload["address"]

    assert address["street"] == "Невский пр."
    assert address["house"] == "28"
    assert address["flat"] == "55"
    assert address["entrance"] == "3"
    assert address["floor"] == "4"
    assert address["doorphone"] == "55К"


async def test_dengi_i_srok_uezzhayut_na_kassu(session: AsyncSession, tenant, order):
    """Кассир должен видеть, чем платят, сколько сдачи и наш итог."""
    payload = await iiko_bridge.build_order_payload(session, tenant, order)

    assert payload["deliveryMinutes"] == 45
    assert payload["personsCount"] == 2
    assert payload["payment"]["method"] == "cash_on_delivery"
    assert payload["payment"]["isPaid"] is False
    assert payload["payment"]["changeFromKopecks"] == 200_000
    assert payload["payment"]["totalKopecks"] == 110_000


async def test_otmena_s_kassy_dohodit_do_gostya(
    session: AsyncSession, tenant, restaurant, order
):
    """Отмена не часть цепочки этапов, и правило «только вперёд» её не гасит."""
    order.status = OrderStatus.COOKING
    await session.commit()

    touched = await iiko_bridge.apply_delivery_status(
        session,
        tenant,
        restaurant.id,
        [{"orderId": str(order.id), "cancelledAt": datetime.now(UTC).isoformat()}],
    )
    await session.commit()
    await session.refresh(order)

    assert touched == 1
    assert order.status is OrderStatus.CANCELLED
    assert order.cancelled_at is not None


async def test_pri_otmene_bally_vozvrashayutsya(
    session: AsyncSession, tenant, guest, restaurant, order
):
    """За отменённый заказ гость не должен остаться ни в плюсе, ни в минусе."""
    account = await session.scalar(
        select(LoyaltyAccount).where(
            LoyaltyAccount.tenant_id == tenant.id, LoyaltyAccount.guest_id == guest.id
        )
    )
    assert account is not None

    account.points_balance = 100
    order.points_spent = 300
    order.points_earned = 50
    await session.commit()

    await iiko_bridge.apply_delivery_status(
        session,
        tenant,
        restaurant.id,
        [{"orderId": str(order.id), "cancelledAt": datetime.now(UTC).isoformat()}],
    )
    await session.commit()
    await session.refresh(account)

    # 100 + 300 списанных вернули − 50 начисленных забрали
    assert account.points_balance == 350


async def test_status_nazad_ne_dvigaetsya(session: AsyncSession, tenant, restaurant, order):
    """Старый срез с кассы не должен возвращать гостя на шаг назад."""
    order.status = OrderStatus.DELIVERING
    await session.commit()

    touched = await iiko_bridge.apply_delivery_status(
        session,
        tenant,
        restaurant.id,
        [{"orderId": str(order.id), "confirmedAt": datetime.now(UTC).isoformat()}],
    )
    await session.refresh(order)

    assert touched == 0
    assert order.status is OrderStatus.DELIVERING


async def test_stop_list_smotrit_na_sopostavlenie_svoey_tochki(
    session: AsyncSession, tenant, restaurant, dish
):
    """Стоп с кодом чужой кассы не должен гасить блюдо в этом ресторане."""
    await _link(session, tenant, restaurant, dish, "code-here")

    added, _ = await iiko_bridge.apply_stop_list(
        session,
        tenant,
        restaurant.id,
        [{"productId": "code-of-another-point", "isStopped": True}],
    )
    await session.commit()

    assert added == 0

    added, _ = await iiko_bridge.apply_stop_list(
        session, tenant, restaurant.id, [{"productId": "code-here", "isStopped": True}]
    )
    await session.commit()

    assert added == 1

    # Снимаем стоп за собой: следующий прогон должен начинать с чистого листа
    await iiko_bridge.apply_stop_list(session, tenant, restaurant.id, [])
    await session.commit()
