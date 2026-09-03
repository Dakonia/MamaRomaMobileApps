"""Отправка пуш-уведомлений через службу Expo.

Токены устройств выдаёт само приложение, а доставкой занимается Expo: она
разговаривает с Firebase на Android и с APNs на iPhone. Нам остаётся собрать
сообщение и разобрать ответ — какие токены умерли, чтобы не слать в пустоту.
"""

from datetime import datetime, time
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.enums import NotificationKind, OrderStatus, OrderType
from app.models.geo import Restaurant
from app.models.guest import Device
from app.models.notification import NotificationHours, NotificationRule
from app.models.order import Order

EXPO_URL = "https://exp.host/--/api/v2/push/send"
BATCH = 90
TIMEOUT = 15

# Заготовки на случай, когда правил в базе ещё нет: сеть должна писать гостю
# с первого дня, а не после того, как менеджер зайдёт в админку.
# Здесь только то, что гостю правда важно, — «готовим» в этот список не входит
DEFAULT_RULES: dict[OrderStatus, tuple[bool, str, str]] = {
    OrderStatus.ACCEPTED: (True, "Заказ принят", "Ресторан взял ваш заказ в работу"),
    OrderStatus.COOKING: (False, "Готовим", "Повар уже занялся вашим заказом"),
    OrderStatus.READY: (True, "Заказ готов", "Уже собран и ждёт"),
    OrderStatus.DELIVERING: (True, "Курьер в пути", "Скоро будем у вас"),
    OrderStatus.COMPLETED: (
        True,
        "Приятного аппетита!",
        "Оцените заказ — это одно касание",
    ),
    OrderStatus.CANCELLED: (True, "Заказ отменён", "Загляните в приложение — расскажем почему"),
}

# Самовывоз живёт по другому расписанию: гостю ехать самому, и знать, что
# заказ пошёл на кухню, ему нужнее, чем тому, кто ждёт курьера дома.
# Всё остальное здесь то же самое, поэтому переопределяем один шаг
PICKUP_RULES: dict[OrderStatus, tuple[bool, str, str]] = {
    OrderStatus.COOKING: (True, "Готовим ваш заказ", "Можно выезжать — скоро будет готов"),
}

# Событие вне цепочки этапов: ресторан поправил состав заказа на кассе —
# убрал блюдо, которое закончилось, или заменил его. Гость должен узнать
# об этом до вручения, а не от курьера у двери
ORDER_CHANGED = "items_changed"

DEFAULT_EVENT_RULES: dict[str, tuple[bool, str, str]] = {
    ORDER_CHANGED: (
        True,
        "Заказ изменили",
        "Ресторан поправил состав — загляните в приложение",
    ),
}


async def tokens_for_guest(session: AsyncSession, tenant_id: str, guest_id: UUID) -> list[str]:
    rows = await session.scalars(
        select(Device.push_token).where(
            Device.tenant_id == tenant_id,
            Device.guest_id == guest_id,
            Device.is_active.is_(True),
        )
    )
    return list(rows)


async def _deactivate(session: AsyncSession, tenant_id: str, tokens: list[str]) -> None:
    """Устройство удалило приложение или запретило уведомления — больше не пишем."""
    if not tokens:
        return

    await session.execute(
        update(Device)
        .where(Device.tenant_id == tenant_id, Device.push_token.in_(tokens))
        .values(is_active=False)
    )
    await session.commit()


async def send(
    session: AsyncSession,
    tenant_id: str,
    tokens: list[str],
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
    kind: NotificationKind = NotificationKind.ORDER,
    image: str | None = None,
) -> int:
    """Отправляет одно сообщение на все устройства гостя. Возвращает, сколько ушло."""
    if not tokens:
        return 0

    # Android показывает гостю каналы отдельно: заказы можно оставить,
    # а рассылки выключить, не трогая первое
    channel = "orders" if kind is NotificationKind.ORDER else "promos"

    delivered = 0
    dead: list[str] = []

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        for start in range(0, len(tokens), BATCH):
            chunk = tokens[start : start + BATCH]
            messages = [
                {
                    "to": token,
                    "title": title,
                    "body": body,
                    "sound": "default",
                    "data": data or {},
                    # Заказ важнее акции: статус должен приходить сразу
                    "priority": "high",
                    "channelId": channel,
                    # Картинка в уведомлении: Android покажет её рядом с текстом
                    **({"richContent": {"image": image}} if image else {}),
                }
                for token in chunk
            ]

            try:
                response = await client.post(EXPO_URL, json=messages)
                payload = response.json()
            except (httpx.HTTPError, ValueError):
                # Служба недоступна — уведомление не главное, заказ уже принят
                continue

            for token, item in zip(chunk, payload.get("data", []), strict=False):
                if item.get("status") == "ok":
                    delivered += 1
                    continue

                if (item.get("details") or {}).get("error") == "DeviceNotRegistered":
                    dead.append(token)

    await _deactivate(session, tenant_id, dead)
    return delivered


def public_url(path: str | None) -> str | None:
    """Относительная ссылка на картинку → полная. Телефон грузит её сам."""
    if not path:
        return None
    if path.startswith("http"):
        return path
    if not settings.public_base_url:
        return None

    return f"{settings.public_base_url.rstrip('/')}{path}"


async def rule_for(
    session: AsyncSession,
    tenant_id: str,
    restaurant_id: UUID,
    event: OrderStatus,
    order_type: OrderType = OrderType.DELIVERY,
) -> tuple[bool, str, str] | None:
    """Правило шага: сначала своё у ресторана, потом общее по сети, потом заготовка.

    Заготовка зависит от того, как гость получает заказ: тому, кто едет за ним
    сам, важно знать, что готовка началась, — он собирается выходить.
    """
    rows = (
        await session.scalars(
            select(NotificationRule).where(
                NotificationRule.tenant_id == tenant_id,
                NotificationRule.event == event.value,
                # Сравнение с NULL через IN не работает: строка правила сети
                # (ресторан не задан) в такой выборке не находится вовсе,
                # и общие тексты из админки молча не применялись
                or_(
                    NotificationRule.restaurant_id == restaurant_id,
                    NotificationRule.restaurant_id.is_(None),
                ),
            )
        )
    ).all()

    # Ресторан главнее сети: у точки могут быть свои порядки
    own = next((row for row in rows if row.restaurant_id == restaurant_id), None)
    shared = next((row for row in rows if row.restaurant_id is None), None)
    rule = own or shared

    if rule is not None:
        return rule.is_enabled, rule.title, rule.body

    if order_type is OrderType.PICKUP and event in PICKUP_RULES:
        return PICKUP_RULES[event]

    return DEFAULT_RULES.get(event)


async def rule_for_event(
    session: AsyncSession, tenant_id: str, restaurant_id: UUID, event: str
) -> tuple[bool, str, str] | None:
    """То же, что rule_for, но для событий вне цепочки этапов заказа."""
    rows = (
        await session.scalars(
            select(NotificationRule).where(
                NotificationRule.tenant_id == tenant_id,
                NotificationRule.event == event,
                or_(
                    NotificationRule.restaurant_id == restaurant_id,
                    NotificationRule.restaurant_id.is_(None),
                ),
            )
        )
    ).all()

    own = next((row for row in rows if row.restaurant_id == restaurant_id), None)
    shared = next((row for row in rows if row.restaurant_id is None), None)
    rule = own or shared

    if rule is not None:
        return rule.is_enabled, rule.title, rule.body

    return DEFAULT_EVENT_RULES.get(event)


def fill(text: str, order: Order, restaurant_name: str) -> str:
    """Подстановки в тексте: номер заказа, ресторан, время доставки."""
    when = ""
    if order.delivery_at is not None:
        local = order.delivery_at.astimezone()
        when = f"{local:%H:%M}"

    return (
        text.replace("{number}", order.number)
        .replace("{restaurant}", restaurant_name)
        .replace("{time}", when)
    )


async def notify_order(session: AsyncSession, tenant_id: str, order: Order) -> int:
    """Сообщает гостю о новом статусе его заказа, если этот шаг включён."""
    rule = await rule_for(session, tenant_id, order.restaurant_id, order.status, order.type)
    if rule is None:
        return 0

    enabled, title, body = rule
    if not enabled:
        return 0

    restaurant = await session.get(Restaurant, order.restaurant_id)
    name = restaurant.name if restaurant else ""

    tokens = await tokens_for_guest(session, tenant_id, order.guest_id)

    return await send(
        session,
        tenant_id,
        tokens,
        title=fill(title, order, name),
        body=fill(body, order, name),
        # По нажатию открываем сам заказ, а не главный экран
        data={"screen": "order", "orderId": str(order.id)},
    )


async def quiet_now(session: AsyncSession, tenant_id: str, zone: ZoneInfo) -> bool:
    """Сейчас тихие часы? Рекламные сообщения ждут утра, заказы идут всегда."""
    hours = await session.scalar(
        select(NotificationHours).where(
            NotificationHours.tenant_id == tenant_id, NotificationHours.restaurant_id.is_(None)
        )
    )

    quiet_from = hours.quiet_from if hours else time(22, 0)
    quiet_to = hours.quiet_to if hours else time(10, 0)
    now = datetime.now(zone).time()

    # Тишина обычно переваливает через полночь
    if quiet_from <= quiet_to:
        return quiet_from <= now < quiet_to

    return now >= quiet_from or now < quiet_to


async def notify_event(session: AsyncSession, tenant_id: str, order: Order, event: str) -> int:
    """Сообщает гостю о событии, которого нет в цепочке этапов.

    Текст правится в админке там же, где шаги заказа: ресторану виднее,
    какими словами объяснять правку состава.
    """
    rule = await rule_for_event(session, tenant_id, order.restaurant_id, event)
    if rule is None:
        return 0

    enabled, title, body = rule
    if not enabled:
        return 0

    restaurant = await session.get(Restaurant, order.restaurant_id)
    name = restaurant.name if restaurant else ""

    tokens = await tokens_for_guest(session, tenant_id, order.guest_id)

    return await send(
        session,
        tenant_id,
        tokens,
        title=fill(title, order, name),
        body=fill(body, order, name),
        data={"screen": "order", "orderId": str(order.id)},
    )
