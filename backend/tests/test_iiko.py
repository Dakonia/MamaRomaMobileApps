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

from app.models.enums import IikoHandoffStatus, OrderStatus, OrderType, PaymentMethod
from app.models.integration import IikoBridge, IikoLink, IikoOrderHandoff, IikoProduct
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


@pytest.fixture
async def mapped_dish(session: AsyncSession, tenant, dish):
    """Блюдо вместе с веткой кассы, в которой автоподбор его ищет.

    Подбор доверяет только «своей» ветке дерева: товар с тем же названием из
    заготовок или прошлогодних акций связывать нельзя.
    """
    rows = await session.execute(
        select(Dish, MenuCategory.name)
        .join(MenuCategory, MenuCategory.id == Dish.category_id)
        .where(Dish.tenant_id == tenant.id, Dish.is_active.is_(True))
    )
    for found, category in rows:
        paths = iiko_bridge.MAMAROMA_CATEGORY_GROUP_PATH_PREFIXES.get(category)
        if paths:
            return found, paths[0]

    pytest.skip("в меню нет категории с настроенной веткой кассы")


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


async def test_pustoy_sostav_ne_schitaetsya_pravkoy(
    session: AsyncSession, tenant, restaurant, dish, order
):
    """Отменённый заказ приходит без позиций — это не правка состава.

    Иначе гость видит карточку «ресторан изменил заказ» с пустым списком.
    """
    await _link(session, tenant, restaurant, dish, "code-here")

    await iiko_bridge.apply_delivery_status(
        session,
        tenant,
        restaurant.id,
        [
            {
                "orderId": str(order.id),
                "status": "Cancelled",
                "cancelledAt": datetime.now(UTC).isoformat(),
                "cancelCause": "Технический сбой",
                "items": [],
            }
        ],
    )
    await session.commit()
    await session.refresh(order)

    assert order.status is OrderStatus.CANCELLED
    assert order.iiko_cancel_cause == "Технический сбой"
    assert order.iiko_items_changed_at is None


async def test_pravka_sostava_vse_ravno_zamechaetsya(
    session: AsyncSession, tenant, restaurant, dish, order
):
    """А вот подмена позиции живого заказа — именно правка, и её видно."""
    await _link(session, tenant, restaurant, dish, "code-here")

    await iiko_bridge.apply_delivery_status(
        session,
        tenant,
        restaurant.id,
        [
            {
                "orderId": str(order.id),
                "status": "OnWay",
                "items": [{"productId": "another-code", "name": "Другое блюдо", "amount": 1}],
            }
        ],
    )
    await session.commit()
    await session.refresh(order)

    assert order.iiko_items_changed_at is not None


# ─────────────────────── заказ едет на кассу ───────────────────────


async def test_dlinnyy_korpus_ne_lomaet_adres(session: AsyncSession, tenant, order):
    """Корпус уезжает целиком: укорачивает его плагин, если касса старая.

    На сервере резать нельзя — тогда длинный корпус потерялся бы у всех точек,
    включая те, где ограничения нет.
    """
    order.address_details = {**order.address_details, "building": "корпус 12 строение 3"}
    await session.commit()

    address = (await iiko_bridge.build_order_payload(session, tenant, order))["address"]

    assert address["building"] == "корпус 12 строение 3"
    assert address["house"] == "28"


async def test_primechaniya_nesut_istochnik_i_bally(session: AsyncSession, tenant, order):
    """В примечаниях доставки видно, что заказ из приложения и что с баллами."""
    order.points_spent = 300
    order.points_earned = 55
    order.discount_kopecks = 20_000
    order.promo_code = "LETO"
    await session.commit()

    notes = (await iiko_bridge.build_order_payload(session, tenant, order))["address"][
        "additionalInfo"
    ]

    assert "Мобильное приложение" in notes
    assert "Списано баллов: 300" in notes
    assert "Начислено баллов: 55" in notes
    assert "Скидка: 200 руб по промокоду LETO" in notes


async def test_samovyvoz_uezzhaet_bez_adresa(session: AsyncSession, tenant, order):
    """Курьера нет — адрес кассе не нужен, иначе она откажет."""
    order.type = OrderType.PICKUP
    await session.commit()

    payload = await iiko_bridge.build_order_payload(session, tenant, order)

    assert payload["orderType"] == "pickup"
    assert payload["address"] == {}


async def test_dobavki_uezzhayut_s_kolichestvom_porciy(
    session: AsyncSession, tenant, restaurant, dish, order
):
    """Две пиццы с беконом — это два бекона, а не один."""
    from app.models.menu import DishExtra

    extra = await session.scalar(
        select(DishExtra).where(DishExtra.tenant_id == tenant.id).limit(1)
    )
    assert extra is not None, "в базе нет добавок — прогоните импорт"

    order.items[0].extras = [{"id": str(extra.id), "name": extra.name, "price_kopecks": 9500}]

    # Связь добавки заводим идемпотентно: прогон не должен зависеть от того,
    # чем закончился предыдущий
    link = await session.scalar(
        select(IikoLink).where(
            IikoLink.tenant_id == tenant.id,
            IikoLink.restaurant_id == restaurant.id,
            IikoLink.extra_id == extra.id,
        )
    )
    if link is None:
        link = IikoLink(
            tenant_id=tenant.id, restaurant_id=restaurant.id, extra_id=extra.id, product_id=""
        )
        session.add(link)

    link.product_id = "extra-code"
    link.modifier_group_id = "group-code"
    await session.commit()

    payload = await iiko_bridge.build_order_payload(session, tenant, order)
    modifier = payload["items"][0]["modifiers"][0]

    assert modifier["productId"] == "extra-code"
    assert modifier["groupId"] == "group-code"
    assert modifier["amount"] == 2

    await session.execute(delete(IikoLink).where(IikoLink.extra_id == extra.id))
    await session.commit()


# ─────────────────────── очередь и отчёты ───────────────────────


async def _bridge(session: AsyncSession, tenant, restaurant) -> IikoBridge:
    bridge = await session.scalar(
        select(IikoBridge).where(
            IikoBridge.tenant_id == tenant.id, IikoBridge.restaurant_id == restaurant.id
        )
    )
    if bridge is None:
        bridge = IikoBridge(
            tenant_id=tenant.id, restaurant_id=restaurant.id, secret="secret-for-tests"
        )
        session.add(bridge)
        await session.commit()
    return bridge


async def _handoff(session: AsyncSession, tenant, order) -> IikoOrderHandoff:
    handoff = IikoOrderHandoff(
        tenant_id=tenant.id,
        order_id=order.id,
        restaurant_id=order.restaurant_id,
        status=IikoHandoffStatus.SENT,
        attempts=1,
    )
    session.add(handoff)
    await session.commit()
    return handoff


async def test_zakaz_ne_otdayotsya_dvum_terminalam_srazu(
    session: AsyncSession, tenant, restaurant, order
):
    """Замок: второй опрос подряд тот же заказ не уводит.

    Иначе два терминала одной точки заведут одну доставку дважды.
    """
    await _bridge(session, tenant, restaurant)
    await iiko_bridge.enqueue_order(session, tenant, order)
    await session.commit()

    first = await iiko_bridge.take_pending(session, tenant, restaurant.id, 10)
    await session.commit()
    second = await iiko_bridge.take_pending(session, tenant, restaurant.id, 10)

    assert [row[0].id for row in first] == [order.id]
    assert second == []


async def test_bez_mosta_zakaz_v_ochered_ne_popadaet(
    session: AsyncSession, tenant, restaurant, order
):
    """Плагина у точки нет — заказ ведёт менеджер, очередь не нужна."""
    await session.execute(
        delete(IikoBridge).where(
            IikoBridge.tenant_id == tenant.id, IikoBridge.restaurant_id == restaurant.id
        )
    )
    await session.commit()

    await iiko_bridge.enqueue_order(session, tenant, order)
    await session.commit()

    waiting = await iiko_bridge.take_pending(session, tenant, restaurant.id, 10)
    assert waiting == []


async def test_ack_bez_nomera_kassy_vse_ravno_schitaet_zakaz_uehavshim(
    session: AsyncSession, tenant, restaurant, order
):
    """Касса приняла заказ, но номер не вернула — это всё равно успех.

    Иначе заказ ушёл бы на второй круг и появился бы на кухне дважды.
    """
    await _handoff(session, tenant, order)

    await iiko_bridge.ack_order(
        session,
        tenant,
        restaurant.id,
        order.id,
        accepted=True,
        iiko_order_id="",
        iiko_order_number="",
        error="",
        missing_products=[],
    )
    await session.commit()
    await session.refresh(order)

    handoff = await session.scalar(
        select(IikoOrderHandoff).where(IikoOrderHandoff.order_id == order.id)
    )
    assert handoff.status is IikoHandoffStatus.ACCEPTED
    assert order.synced_at is not None


async def test_ack_prinyatogo_zakaza_sohranyaet_avariynye_pozicii(
    session: AsyncSession, tenant, restaurant, order
):
    """Заказ уехал, но часть блюд заведена аварийной позицией — это видно.

    Менеджеру нужно поправить их руками на кассе, поэтому текст остаётся
    в очереди даже у принятого заказа.
    """
    await _handoff(session, tenant, order)

    await iiko_bridge.ack_order(
        session,
        tenant,
        restaurant.id,
        order.id,
        accepted=True,
        iiko_order_id="iiko-1",
        iiko_order_number="512",
        error="Использованы аварийные позиции: Пепперони",
        missing_products=["Пепперони"],
    )
    await session.commit()

    handoff = await session.scalar(
        select(IikoOrderHandoff).where(IikoOrderHandoff.order_id == order.id)
    )
    assert handoff.status is IikoHandoffStatus.ACCEPTED
    assert handoff.missing_products == ["Пепперони"]
    assert "аварийные" in (handoff.error or "")


async def test_nenaydennye_tovary_ne_povtoryayutsya(
    session: AsyncSession, tenant, restaurant, order
):
    """Сопоставление разъехалось — повтор ничего не изменит, ждём человека."""
    await _handoff(session, tenant, order)

    await iiko_bridge.ack_order(
        session,
        tenant,
        restaurant.id,
        order.id,
        accepted=False,
        iiko_order_id="",
        iiko_order_number="",
        error="Не найдены товары: Пепперони",
        missing_products=["Пепперони"],
    )
    await session.commit()

    handoff = await session.scalar(
        select(IikoOrderHandoff).where(IikoOrderHandoff.order_id == order.id)
    )
    assert handoff.status is IikoHandoffStatus.FAILED

    waiting = await iiko_bridge.take_pending(session, tenant, restaurant.id, 10)
    assert waiting == []


# ─────────────────────── статусы с кассы ───────────────────────


async def test_status_dopisyvaet_nomer_kassy_v_zakaz(
    session: AsyncSession, tenant, restaurant, order
):
    """Заказ завели на кассе руками — номер подтягиваем к себе.

    По нему заказ находят и на кухне, и в разговоре с гостем.
    """
    await _handoff(session, tenant, order)

    await iiko_bridge.apply_delivery_status(
        session,
        tenant,
        restaurant.id,
        [
            {
                "orderId": str(order.id),
                "iikoOrderId": "iiko-42",
                "iikoOrderNumber": "512",
                "status": "New",
            }
        ],
    )
    await session.commit()
    await session.refresh(order)

    assert order.external_id == "iiko-42"

    handoff = await session.scalar(
        select(IikoOrderHandoff).where(IikoOrderHandoff.order_id == order.id)
    )
    assert handoff.iiko_order_number == "512"


async def test_status_nahodit_zakaz_po_vidimomu_nomeru(
    session: AsyncSession, tenant, restaurant, order
):
    """Скрытый ключ мог не сохраниться — тогда ищем по номеру из внешнего поля."""
    touched = await iiko_bridge.apply_delivery_status(
        session,
        tenant,
        restaurant.id,
        [{"orderId": f"Мобильное № {order.number}", "status": "New", "confirmedAt": _now()}],
    )
    await session.commit()
    await session.refresh(order)

    assert touched == 1
    assert order.status is OrderStatus.ACCEPTED


async def test_etapy_schitayutsya_po_metkam_vremeni(
    session: AsyncSession, tenant, restaurant, order
):
    """На V8 «готовим» и «готово» дают метки времени, а не строка статуса."""
    steps = [
        ({"confirmedAt": _now()}, OrderStatus.ACCEPTED),
        ({"printedAt": _now()}, OrderStatus.COOKING),
        ({"cookingFinishedAt": _now()}, OrderStatus.READY),
        ({"sentAt": _now()}, OrderStatus.DELIVERING),
        ({"deliveredAt": _now()}, OrderStatus.COMPLETED),
    ]

    for marks, expected in steps:
        await iiko_bridge.apply_delivery_status(
            session, tenant, restaurant.id, [{"orderId": str(order.id), **marks}]
        )
        await session.commit()
        await session.refresh(order)
        assert order.status is expected, f"метки {marks} должны давать {expected}"


async def test_smena_etapa_uvedomlyaet_gostya(
    session: AsyncSession, tenant, restaurant, order, no_push
):
    """Ради этого всё и делалось: этап сдвинулся — гость об этом узнал."""
    await iiko_bridge.apply_delivery_status(
        session,
        tenant,
        restaurant.id,
        [{"orderId": str(order.id), "sentAt": _now()}],
    )
    await session.commit()

    assert len(no_push) == 1, "смена этапа должна отправлять уведомление"


async def test_povtornyy_sriz_ne_uvedomlyaet_zanovo(
    session: AsyncSession, tenant, restaurant, order, no_push
):
    """Касса шлёт срез каждые полминуты — гость не должен получать их все."""
    row = {"orderId": str(order.id), "sentAt": _now()}

    await iiko_bridge.apply_delivery_status(session, tenant, restaurant.id, [row])
    await session.commit()
    await iiko_bridge.apply_delivery_status(session, tenant, restaurant.id, [row])
    await session.commit()

    assert len(no_push) == 1


async def test_prichina_i_kommentariy_otmeny_sohranyayutsya(
    session: AsyncSession, tenant, restaurant, order
):
    """Гостю важно знать не только что отменили, но и почему."""
    await iiko_bridge.apply_delivery_status(
        session,
        tenant,
        restaurant.id,
        [
            {
                "orderId": str(order.id),
                "cancelledAt": _now(),
                "cancelCause": "Нет курьера",
                "cancelComment": "Позвонили гостю, перенесли на завтра",
            }
        ],
    )
    await session.commit()
    await session.refresh(order)

    assert order.status is OrderStatus.CANCELLED
    assert order.iiko_cancel_cause == "Нет курьера"
    assert order.iiko_cancel_comment == "Позвонили гостю, перенесли на завтра"
    assert "Нет курьера" in (order.cancel_reason or "")


async def test_problema_na_kuhne_i_kurier_vidny(
    session: AsyncSession, tenant, restaurant, order
):
    """Отметку о проблеме мы должны увидеть раньше гостя."""
    await iiko_bridge.apply_delivery_status(
        session,
        tenant,
        restaurant.id,
        [
            {
                "orderId": str(order.id),
                "status": "OnWay",
                "hasProblem": True,
                "problemComment": "Нет сдачи с 5000",
                "courierName": "Иван",
            }
        ],
    )
    await session.commit()
    await session.refresh(order)

    assert order.iiko_problem_comment == "Нет сдачи с 5000"
    assert order.iiko_courier_name == "Иван"
    assert order.iiko_status == "OnWay"


# ─────────────────────── номенклатура и сопоставление ───────────────────────


async def test_nomenklatura_zamenyaetsya_celikom(session: AsyncSession, tenant, restaurant):
    """Касса — источник правды: чего в выгрузке нет, того нет и у нас."""
    await iiko_bridge.apply_menu(
        session,
        tenant,
        restaurant.id,
        [
            {"productId": "p1", "name": "Первое", "groupPath": "КУХНЯ/ПИЦЦА"},
            {"productId": "p2", "name": "Второе", "groupPath": "КУХНЯ/ПИЦЦА"},
        ],
    )
    await session.commit()

    await iiko_bridge.apply_menu(
        session,
        tenant,
        restaurant.id,
        [{"productId": "p2", "name": "Второе", "groupPath": "КУХНЯ/ПИЦЦА"}],
    )
    await session.commit()

    left = [
        row.product_id
        for row in await session.scalars(
            select(IikoProduct).where(
                IikoProduct.tenant_id == tenant.id, IikoProduct.restaurant_id == restaurant.id
            )
        )
    ]
    assert left == ["p2"]

    await session.execute(
        delete(IikoProduct).where(IikoProduct.restaurant_id == restaurant.id)
    )
    await session.commit()


async def test_sohranenie_svyazi_i_ee_snyatie(
    session: AsyncSession, tenant, restaurant, dish
):
    """Пустой код товара означает «связь снять», а не «оставить как было»."""
    await iiko_bridge.save_links(
        session,
        tenant,
        restaurant.id,
        [{"kind": "dish", "id": str(dish.id), "product_id": "code-1"}],
    )
    await session.commit()

    link = await session.scalar(
        select(IikoLink).where(
            IikoLink.restaurant_id == restaurant.id, IikoLink.dish_id == dish.id
        )
    )
    assert link is not None and link.product_id == "code-1"

    await iiko_bridge.save_links(
        session,
        tenant,
        restaurant.id,
        [{"kind": "dish", "id": str(dish.id), "product_id": ""}],
    )
    await session.commit()

    gone = await session.scalar(
        select(IikoLink).where(
            IikoLink.restaurant_id == restaurant.id, IikoLink.dish_id == dish.id
        )
    )
    assert gone is None


async def test_dvoyniki_v_kasse_ostayutsya_cheloveku(
    session: AsyncSession, tenant, restaurant, mapped_dish
):
    """Два товара с одним названием — выбор человека: ошибка уедет на кухню."""
    dish, group_path = mapped_dish
    await session.execute(
        delete(IikoLink).where(
            IikoLink.restaurant_id == restaurant.id, IikoLink.dish_id == dish.id
        )
    )
    await iiko_bridge.apply_menu(
        session,
        tenant,
        restaurant.id,
        [
            {"productId": "same-1", "name": dish.name, "groupPath": group_path},
            {"productId": "same-2", "name": dish.name, "groupPath": group_path},
        ],
    )
    await session.commit()

    await iiko_bridge.auto_match(session, tenant, restaurant.id)
    await session.commit()

    link = await session.scalar(
        select(IikoLink).where(
            IikoLink.restaurant_id == restaurant.id, IikoLink.dish_id == dish.id
        )
    )
    assert link is None, "неоднозначное совпадение связывать нельзя"

    await session.execute(
        delete(IikoProduct).where(IikoProduct.restaurant_id == restaurant.id)
    )
    await session.commit()


async def test_avtopodbor_svyazyvaet_odnoznachnoe(
    session: AsyncSession, tenant, restaurant, mapped_dish
):
    """Одно совпадение — связываем сами, это экономит часы ручной работы."""
    dish, group_path = mapped_dish
    await session.execute(
        delete(IikoLink).where(
            IikoLink.restaurant_id == restaurant.id, IikoLink.dish_id == dish.id
        )
    )
    await iiko_bridge.apply_menu(
        session,
        tenant,
        restaurant.id,
        [{"productId": "only-one", "name": dish.name, "groupPath": group_path}],
    )
    await session.commit()

    matched, _ = await iiko_bridge.auto_match(session, tenant, restaurant.id)
    await session.commit()

    link = await session.scalar(
        select(IikoLink).where(
            IikoLink.restaurant_id == restaurant.id, IikoLink.dish_id == dish.id
        )
    )
    assert matched >= 1
    assert link is not None and link.product_id == "only-one"

    await session.execute(
        delete(IikoLink).where(IikoLink.restaurant_id == restaurant.id)
    )
    await session.execute(
        delete(IikoProduct).where(IikoProduct.restaurant_id == restaurant.id)
    )
    await session.commit()


# ─────────────────────── доступ плагина ───────────────────────


async def test_chuzhoy_sekret_ne_puskayut(session: AsyncSession, tenant, restaurant):
    """Секрет у каждой точки свой: чужим ключом чужие заказы не забрать."""
    await _bridge(session, tenant, restaurant)

    with pytest.raises(iiko_bridge.BridgeError):
        await iiko_bridge.authenticate(session, tenant, str(restaurant.id), "не тот ключ")


async def test_vyklyuchennyy_plagin_ne_rabotaet(session: AsyncSession, tenant, restaurant):
    """Выключили точку в админке — плагин перестаёт получать заказы."""
    bridge = await _bridge(session, tenant, restaurant)
    bridge.is_active = False
    await session.commit()

    with pytest.raises(iiko_bridge.BridgeError):
        await iiko_bridge.authenticate(
            session, tenant, str(restaurant.id), "secret-for-tests"
        )

    bridge.is_active = True
    await session.commit()


def _now() -> str:
    return datetime.now(UTC).isoformat()


async def test_tovar_iz_chuzhoy_vetki_ne_svyazyvaetsya(
    session: AsyncSession, tenant, restaurant, mapped_dish
):
    """Название совпало, но лежит в заготовках — это не то блюдо.

    Ровно так в кассе живут «п/ф чипс из пепперони» и «Пицца Пепперони
    в подарок»: имя похоже, продавать нельзя.
    """
    dish, _ = mapped_dish
    await session.execute(
        delete(IikoLink).where(
            IikoLink.restaurant_id == restaurant.id, IikoLink.dish_id == dish.id
        )
    )
    await iiko_bridge.apply_menu(
        session,
        tenant,
        restaurant.id,
        [
            {
                "productId": "from-stock",
                "name": dish.name,
                "groupPath": "ЗАКУСКИ (ЗАГОТОВКИ)",
            }
        ],
    )
    await session.commit()

    await iiko_bridge.auto_match(session, tenant, restaurant.id)
    await session.commit()

    link = await session.scalar(
        select(IikoLink).where(
            IikoLink.restaurant_id == restaurant.id, IikoLink.dish_id == dish.id
        )
    )
    assert link is None

    await session.execute(
        delete(IikoProduct).where(IikoProduct.restaurant_id == restaurant.id)
    )
    await session.commit()
