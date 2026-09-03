"""Уведомления: правила шагов, тихие часы и подбор аудитории.

Самая свежая часть, и самая опасная: ошибка здесь либо оставит гостя без
сообщения о заказе, либо разбудит всю базу ночью.
"""

from datetime import UTC, datetime, time, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import CampaignStatus, NotificationKind, OrderStatus
from app.models.guest import Device
from app.models.notification import Campaign, NotificationHours, NotificationRule
from app.services import campaign as campaign_service
from app.services import push as push_service


async def _set_rule(
    session: AsyncSession, tenant, restaurant_id, event: OrderStatus, **values: object
) -> None:
    """Правило заводим или правим: в базе оно одно на пару «ресторан плюс шаг»."""
    from sqlalchemy import select

    rule = await session.scalar(
        select(NotificationRule).where(
            NotificationRule.tenant_id == tenant.id,
            NotificationRule.event == event.value,
            NotificationRule.restaurant_id.is_(None)
            if restaurant_id is None
            else NotificationRule.restaurant_id == restaurant_id,
        )
    )
    if rule is None:
        rule = NotificationRule(
            tenant_id=tenant.id, restaurant_id=restaurant_id, event=event.value,
            is_enabled=True, title="", body="",
        )
        session.add(rule)

    for field, value in values.items():
        setattr(rule, field, value)

    await session.commit()


async def test_pravilo_restorana_glavnee_setevogo(
    session: AsyncSession, tenant, restaurant
):
    """У точки могут быть свои порядки: её правило перекрывает общее."""
    await _set_rule(
        session, tenant, None, OrderStatus.READY,
        is_enabled=True, title="Общий заголовок", body="Общий текст",
    )
    await _set_rule(
        session, tenant, restaurant.id, OrderStatus.READY,
        is_enabled=False, title="Своё", body="Своё",
    )

    rule = await push_service.rule_for(session, tenant.id, restaurant.id, OrderStatus.READY)

    assert rule is not None
    enabled, title, _ = rule
    assert enabled is False, "выключенное правило ресторана должно побеждать"
    assert title == "Своё"


async def test_bez_pravil_rabotayut_zagotovki(session: AsyncSession, tenant, restaurant):
    """Пока менеджер не зашёл в админку, гость всё равно получает главное."""
    rule = await push_service.rule_for(session, tenant.id, restaurant.id, OrderStatus.DELIVERING)

    assert rule is not None
    enabled, title, _ = rule
    assert enabled is True
    assert "пути" in title.lower()


async def test_shag_gotovim_po_umolchaniyu_molchit(session: AsyncSession, tenant, restaurant):
    """«Готовим» гостю мало что даёт — по умолчанию на нём не пишем."""
    rule = await push_service.rule_for(session, tenant.id, restaurant.id, OrderStatus.COOKING)

    assert rule is not None
    assert rule[0] is False


async def test_podstanovki_v_tekste(session: AsyncSession, tenant, restaurant, guest):
    """Номер заказа и ресторан подставляются в текст."""
    from app.models.enums import OrderType, PaymentMethod
    from app.models.order import Order

    order = Order(
        tenant_id=tenant.id,
        number="260824-1234",
        guest_id=guest.id,
        restaurant_id=restaurant.id,
        type=OrderType.DELIVERY,
        status=OrderStatus.READY,
        payment_method=PaymentMethod.CASH_ON_DELIVERY,
        contact_phone=guest.phone,
        subtotal_kopecks=100_000,
        total_kopecks=100_000,
    )

    text = push_service.fill("Заказ № {number} из {restaurant}", order, restaurant.name)

    assert "260824-1234" in text
    assert restaurant.name in text


async def _set_hours(session: AsyncSession, tenant, quiet_from: time, quiet_to: time) -> None:
    """Тихие часы в базе одни на сеть: заводим или правим существующие."""
    from sqlalchemy import select

    hours = await session.scalar(
        select(NotificationHours).where(
            NotificationHours.tenant_id == tenant.id, NotificationHours.restaurant_id.is_(None)
        )
    )
    if hours is None:
        hours = NotificationHours(tenant_id=tenant.id, restaurant_id=None)
        session.add(hours)

    hours.quiet_from = quiet_from
    hours.quiet_to = quiet_to
    await session.commit()


async def test_tihie_chasy_perevalivayut_cherez_polnoch(session: AsyncSession, tenant):
    """Тишина с вечера до утра — обычный случай, и он не должен ломаться."""
    await _set_hours(session, tenant, time(22, 0), time(10, 0))

    zone = ZoneInfo(tenant.timezone)
    now = datetime.now(zone).time()
    quiet = await push_service.quiet_now(session, tenant.id, zone)

    expected = now >= time(22, 0) or now < time(10, 0)
    assert quiet is expected


async def test_rassylka_ne_uhodit_v_tihie_chasy(session: AsyncSession, tenant):
    """Ночью реклама ждёт утра и объясняет почему."""
    # Тишина круглые сутки: так проверка не зависит от времени прогона
    await _set_hours(session, tenant, time(0, 0), time(23, 59))

    campaign = Campaign(
        tenant_id=tenant.id,
        name="Ночная",
        title="Акция",
        body="Текст",
        kind=NotificationKind.MARKETING,
        status=CampaignStatus.DRAFT,
        target={},
        audience={},
    )
    session.add(campaign)
    await session.commit()

    sent = await campaign_service.send_campaign(session, tenant, campaign)

    assert sent == 0
    assert campaign.error is not None
    assert "тихие часы" in campaign.error.lower()


async def test_v_auditoriyu_popadayut_tolko_soglasnye(
    session: AsyncSession, tenant, guest
):
    """Отписался от акций — в рассылку не попадает, даже с включёнными пушами."""
    session.add(
        Device(
            tenant_id=tenant.id,
            guest_id=guest.id,
            push_token=f"ExponentPushToken[{uuid4().hex[:16]}]",
            platform="android",
            is_active=True,
        )
    )
    await session.commit()

    before = await campaign_service.preview_size(session, tenant, {})

    guest.marketing_opt_in = False
    await session.commit()

    after = await campaign_service.preview_size(session, tenant, {})

    assert after == before - 1


async def test_bez_ustroystva_v_auditoriyu_ne_popast(session: AsyncSession, tenant, guest):
    """Гость без включённых уведомлений в охват не входит: слать некуда."""
    report = await campaign_service.reach_report(session, tenant, {})

    assert report["guests"] >= 1
    assert report["count"] <= report["with_push"]


async def test_davno_ne_zakazyval_beret_tolko_byvshih_gostey(
    session: AsyncSession, tenant, guest
):
    """Молчун — это тот, кто заказывал раньше. Новичок в сценарий не попадает."""
    quiet = await campaign_service._inactive_guests(session, tenant, days=30)

    assert guest.id not in {row.id for row in quiet}


async def test_den_rozhdeniya_nahodit_po_date(session: AsyncSession, tenant, guest):
    """Сценарий ищет по дню и месяцу, год рождения значения не имеет."""
    # День считаем по часам ресторана: ночью московская дата и дата UTC разные,
    # и тест на часах сервера падал бы каждую ночь
    target = (datetime.now(ZoneInfo(tenant.timezone)) + timedelta(days=3)).date()
    guest.birthday = target.replace(year=1990)
    await session.commit()

    found = await campaign_service._birthday_guests(session, tenant, days_before=3)

    assert guest.id in {row.id for row in found}


async def test_zabytaya_korzina_napominaet_odin_raz(session: AsyncSession, tenant, guest):
    """Про одну и ту же корзину пишем один раз, пока её не изменили."""
    from app.models.notification import CartSnapshot

    session.add(
        CartSnapshot(
            tenant_id=tenant.id,
            guest_id=guest.id,
            positions=3,
            total_kopecks=180_000,
            changed_at=datetime.now(UTC) - timedelta(hours=5),
        )
    )
    await session.commit()

    first = await campaign_service._abandoned_carts(session, tenant, hours=2)
    second = await campaign_service._abandoned_carts(session, tenant, hours=2)

    assert guest.id in {row.id for row in first}
    assert second == [], "второй раз про ту же корзину не напоминаем"


async def test_svezhaya_korzina_ne_schitaetsya_zabytoy(session: AsyncSession, tenant, guest):
    """Гость собирает заказ прямо сейчас — беспокоить его рано."""
    from app.models.notification import CartSnapshot

    session.add(
        CartSnapshot(
            tenant_id=tenant.id,
            guest_id=guest.id,
            positions=2,
            total_kopecks=90_000,
            changed_at=datetime.now(UTC),
        )
    )
    await session.commit()

    found = await campaign_service._abandoned_carts(session, tenant, hours=2)

    assert guest.id not in {row.id for row in found}


async def test_sgorayushchie_bally_ne_bespokoyat_iz_za_meloch(
    session: AsyncSession, tenant, guest
):
    """Ради десятка баллов гостя не тревожим."""
    found = await campaign_service._points_expiring(session, tenant, days_before=7)

    # У свежего гостя баллов нет вовсе — в выборку он попасть не должен
    assert guest.id not in {row.id for row in found}


async def test_pravilo_seti_primenyaetsya(session: AsyncSession, tenant, restaurant):
    """Правило без ресторана — общее для сети, и оно должно находиться.

    Сравнение с NULL через IN его не находило: тексты, заданные в админке
    для всей сети, молча не применялись, и гость получал заготовку из кода.
    """
    from sqlalchemy import delete

    # У точки может остаться своё правило от соседнего теста, а оно главнее
    await session.execute(
        delete(NotificationRule).where(
            NotificationRule.tenant_id == tenant.id,
            NotificationRule.event == OrderStatus.READY.value,
            NotificationRule.restaurant_id == restaurant.id,
        )
    )
    await _set_rule(
        session,
        tenant,
        None,
        OrderStatus.READY,
        title="Общий заголовок",
        body="Общий текст",
    )

    rule = await push_service.rule_for(session, tenant.id, restaurant.id, OrderStatus.READY)

    assert rule is not None
    assert rule[1] == "Общий заголовок"


def test_imya_gostya_ne_uhodit_v_tekst_pisma():
    """Шаблоны с {name} чистятся: персональные данные не идут через Apple и Google."""
    assert campaign_service.without_name("С днём рождения, {name}!") == "С днём рождения!"
    assert campaign_service.without_name("Скучаем, {name}") == "Скучаем"
    assert campaign_service.without_name("{name}, ваша корзина ждёт") == "Ваша корзина ждёт"
    assert campaign_service.without_name("{name}") == ""
    assert campaign_service.without_name("Баллы скоро сгорят") == "Баллы скоро сгорят"
