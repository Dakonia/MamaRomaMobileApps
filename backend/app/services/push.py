"""Отправка пуш-уведомлений через службу Expo.

Токены устройств выдаёт само приложение, а доставкой занимается Expo: она
разговаривает с Firebase на Android и с APNs на iPhone. Нам остаётся собрать
сообщение и разобрать ответ — какие токены умерли, чтобы не слать в пустоту.
"""

from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import OrderStatus
from app.models.guest import Device
from app.models.order import Order

EXPO_URL = "https://exp.host/--/api/v2/push/send"
BATCH = 90
TIMEOUT = 15

# Что пишем гостю на каждом шаге. Пустая строка — этап технический, молчим
STATUS_TEXT: dict[OrderStatus, tuple[str, str]] = {
    OrderStatus.ACCEPTED: ("Заказ принят", "Ресторан взял ваш заказ в работу"),
    OrderStatus.COOKING: ("Готовим", "Повар уже занялся вашим заказом"),
    OrderStatus.READY: ("Заказ готов", "Курьер забирает его из ресторана"),
    OrderStatus.DELIVERING: ("Курьер в пути", "Скоро будем у вас"),
    OrderStatus.COMPLETED: ("Приятного аппетита", "Спасибо, что выбрали нас"),
    OrderStatus.CANCELLED: ("Заказ отменён", "Загляните в приложение — расскажем почему"),
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
) -> int:
    """Отправляет одно сообщение на все устройства гостя. Возвращает, сколько ушло."""
    if not tokens:
        return 0

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
                    "channelId": "orders",
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


async def notify_order(session: AsyncSession, tenant_id: str, order: Order) -> int:
    """Сообщает гостю о новом статусе его заказа."""
    text = STATUS_TEXT.get(order.status)
    if text is None:
        return 0

    tokens = await tokens_for_guest(session, tenant_id, order.guest_id)
    title, body = text

    return await send(
        session,
        tenant_id,
        tokens,
        title=f"{title} · заказ № {order.number}",
        body=body,
        # По нажатию открываем сам заказ, а не главный экран
        data={"screen": "order", "orderId": str(order.id)},
    )
