"""Обмен с плагином на кассовом терминале ресторана.

Плагин сам приходит к нам: забирает заказы, отдаёт стоп-лист, номенклатуру
и состояние доставок. Мы к нему не стучимся — у терминала нет белого адреса,
а интернет в ресторане пропадает регулярно.
"""

import re
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenants import Tenant
from app.models.enums import (
    IikoHandoffStatus,
    LoyaltyOperation,
    OrderStatus,
    OrderType,
    PaymentMethod,
    PaymentStatus,
)
from app.models.integration import IikoBridge, IikoLink, IikoOrderHandoff, IikoProduct
from app.models.loyalty import LoyaltyAccount, LoyaltyTransaction
from app.models.menu import Dish, DishExtra, StopListEntry
from app.models.order import Order

# Столько плагину даётся на то, чтобы завести заказ и отчитаться.
# Не успел — заказ снова попадёт в выдачу, чтобы не потеряться навсегда
LOCK_MINUTES = 3

# Больше этого числа попыток не делаем: если заказ не заводится трижды,
# дело не в связи, и повторы только мешают менеджеру
MAX_ATTEMPTS = 3


class BridgeError(Exception):
    pass


async def authenticate(
    session: AsyncSession, tenant: Tenant, restaurant_id: str, secret: str
) -> IikoBridge:
    """Проверяет, что запрос пришёл от плагина этого ресторана.

    Секрет у каждой точки свой: утёк один терминал — меняем ключ ему одному.
    """
    try:
        parsed = UUID(restaurant_id)
    except (ValueError, AttributeError) as exc:
        raise BridgeError("Некорректный идентификатор ресторана") from exc

    bridge = await session.scalar(
        select(IikoBridge).where(
            IikoBridge.tenant_id == tenant.id,
            IikoBridge.restaurant_id == parsed,
        )
    )
    if bridge is None or not bridge.is_active:
        raise BridgeError("Плагин не зарегистрирован за этим рестораном")

    # Сравнение посимвольно без раннего выхода: длина и содержимое секрета
    # не должны утекать через время ответа
    if not _secrets_equal(bridge.secret, secret or ""):
        raise BridgeError("Неверный секрет")

    return bridge


def _secrets_equal(left: str, right: str) -> bool:
    import hmac

    return hmac.compare_digest(left.encode(), right.encode())


async def touch(
    session: AsyncSession, bridge: IikoBridge, terminal_name: str | None, version: str | None
) -> None:
    """Отмечает, что терминал на связи. Из этого видно, какая точка молчит."""
    bridge.last_seen_at = datetime.now(UTC)
    if terminal_name:
        bridge.terminal_name = terminal_name[:120]
    if version:
        bridge.plugin_version = version[:32]


# ─────────────────────────── заказы ───────────────────────────


async def enqueue_order(session: AsyncSession, tenant: Tenant, order: Order) -> None:
    """Ставит заказ в очередь на кассу, если у ресторана есть плагин.

    Вызывается сразу после оформления. Плагина нет — ничего не происходит,
    и менеджер ведёт заказ в админке как раньше.
    """
    bridge = await session.scalar(
        select(IikoBridge).where(
            IikoBridge.tenant_id == tenant.id,
            IikoBridge.restaurant_id == order.restaurant_id,
            IikoBridge.is_active.is_(True),
        )
    )
    if bridge is None:
        return

    session.add(
        IikoOrderHandoff(
            tenant_id=tenant.id,
            order_id=order.id,
            restaurant_id=order.restaurant_id,
            status=IikoHandoffStatus.PENDING,
        )
    )


async def take_pending(
    session: AsyncSession, tenant: Tenant, restaurant_id: UUID, limit: int
) -> list[tuple[Order, IikoOrderHandoff]]:
    """Отдаёт плагину заказы на заведение и закрывает их замком.

    Замок нужен, чтобы два опроса подряд не увели один заказ дважды.
    Не отчитался за отведённое время — заказ вернётся в выдачу сам.
    """
    now = datetime.now(UTC)

    rows = await session.execute(
        select(IikoOrderHandoff, Order)
        .join(Order, Order.id == IikoOrderHandoff.order_id)
        .where(
            IikoOrderHandoff.tenant_id == tenant.id,
            IikoOrderHandoff.restaurant_id == restaurant_id,
            IikoOrderHandoff.status.in_([IikoHandoffStatus.PENDING, IikoHandoffStatus.SENT]),
            IikoOrderHandoff.attempts < MAX_ATTEMPTS,
            (IikoOrderHandoff.locked_until.is_(None)) | (IikoOrderHandoff.locked_until < now),
        )
        .order_by(IikoOrderHandoff.created_at)
        .limit(limit)
    )

    taken: list[tuple[Order, IikoOrderHandoff]] = []
    for handoff, order in rows.all():
        handoff.status = IikoHandoffStatus.SENT
        handoff.attempts += 1
        handoff.locked_until = now + timedelta(minutes=LOCK_MINUTES)
        handoff.sent_at = now
        taken.append((order, handoff))

    return taken


async def ack_order(
    session: AsyncSession,
    tenant: Tenant,
    restaurant_id: UUID,
    order_id: UUID,
    accepted: bool,
    iiko_order_id: str,
    iiko_order_number: str,
    error: str,
    missing_products: list[str],
) -> None:
    """Записывает, чем закончилась попытка завести заказ."""
    handoff = await session.scalar(
        select(IikoOrderHandoff).where(
            IikoOrderHandoff.tenant_id == tenant.id,
            IikoOrderHandoff.restaurant_id == restaurant_id,
            IikoOrderHandoff.order_id == order_id,
        )
    )
    if handoff is None:
        return

    handoff.locked_until = None

    if accepted:
        handoff.status = IikoHandoffStatus.ACCEPTED
        handoff.accepted_at = datetime.now(UTC)
        handoff.iiko_order_id = (iiko_order_id or "")[:64] or None
        handoff.iiko_order_number = (iiko_order_number or "")[:32] or None
        handoff.error = None
        handoff.missing_products = []

        # Номер кассы кладём и в сам заказ: по нему заказ находят
        # и на кухне, и в разговоре с гостем
        order = await session.get(Order, order_id)
        if order is not None and handoff.iiko_order_id:
            order.external_id = handoff.iiko_order_id[:64]
            order.synced_at = handoff.accepted_at
        return

    handoff.error = (error or "Не удалось завести заказ")[:2000]
    handoff.missing_products = missing_products or []

    # Ненайденные товары повторять бессмысленно: пока сопоставление не поправят,
    # результат будет тот же. Сразу помечаем неудачей, чтобы менеджер увидел
    if handoff.missing_products or handoff.attempts >= MAX_ATTEMPTS:
        handoff.status = IikoHandoffStatus.FAILED
    else:
        handoff.status = IikoHandoffStatus.PENDING


# ─────────────────────────── стоп-лист ───────────────────────────


async def apply_stop_list(
    session: AsyncSession,
    tenant: Tenant,
    restaurant_id: UUID,
    items: list[dict[str, object]],
) -> tuple[int, int]:
    """Приводит стоп-лист ресторана к тому, что прислал плагин.

    Плагин присылает полный срез, а не изменения. Поэтому всё, чего в срезе нет,
    из стоп-листа снимаем: блюдо вернули в продажу — оно снова видно гостю.

    Возвращает, сколько блюд поставлено и сколько снято.
    """
    # Коды кассы → наши блюда. Несопоставленные позиции просто пропускаем:
    # это не ошибка, а ещё не заведённое соответствие
    stopped_codes = [
        str(item.get("productId") or "")
        for item in items
        if item.get("isStopped") and item.get("productId")
    ]

    dish_ids: set[UUID] = set()
    if stopped_codes:
        # Сопоставление берём этого ресторана: у другой точки под тем же кодом
        # лежит другое блюдо, и стоп ушёл бы не туда
        rows = await session.scalars(
            select(IikoLink.dish_id).where(
                IikoLink.tenant_id == tenant.id,
                IikoLink.restaurant_id == restaurant_id,
                IikoLink.dish_id.is_not(None),
                IikoLink.product_id.in_(stopped_codes),
            )
        )
        dish_ids = {dish_id for dish_id in rows.all() if dish_id is not None}

    existing = {
        entry.dish_id: entry
        for entry in await session.scalars(
            select(StopListEntry).where(
                StopListEntry.tenant_id == tenant.id,
                StopListEntry.restaurant_id == restaurant_id,
            )
        )
    }

    added = 0
    for dish_id in dish_ids - existing.keys():
        session.add(
            StopListEntry(
                tenant_id=tenant.id,
                restaurant_id=restaurant_id,
                dish_id=dish_id,
                comment="Из кассы ресторана",
            )
        )
        added += 1

    removed = 0
    for dish_id, entry in existing.items():
        if dish_id in dish_ids:
            continue
        # Руками поставленное в админке не трогаем: у него другой комментарий,
        # и снимать его должен человек, а не касса
        if entry.comment != "Из кассы ресторана":
            continue
        await session.delete(entry)
        removed += 1

    return added, removed


# ─────────────────────────── номенклатура ───────────────────────────


async def apply_menu(
    session: AsyncSession,
    tenant: Tenant,
    restaurant_id: UUID,
    products: list[dict[str, object]],
) -> int:
    """Сохраняет выгруженную номенклатуру для экрана сопоставления."""
    now = datetime.now(UTC)

    existing = {
        product.product_id: product
        for product in await session.scalars(
            select(IikoProduct).where(
                IikoProduct.tenant_id == tenant.id,
                IikoProduct.restaurant_id == restaurant_id,
            )
        )
    }

    seen: set[str] = set()
    for raw in products:
        code = str(raw.get("productId") or "").strip()
        if not code:
            continue
        seen.add(code)

        product = existing.get(code)
        if product is None:
            product = IikoProduct(
                tenant_id=tenant.id,
                restaurant_id=restaurant_id,
                product_id=code[:64],
            )
            session.add(product)

        product.name = str(raw.get("name") or "")[:200]
        product.code = (str(raw.get("code") or "") or None) and str(raw.get("code"))[:32]
        product.group_name = (str(raw.get("groupName") or "") or None) and str(
            raw.get("groupName")
        )[:160]
        product.group_path = (str(raw.get("groupPath") or "") or None) and str(
            raw.get("groupPath")
        )[:400]
        product.category = (str(raw.get("category") or "") or None) and str(raw.get("category"))[
            :120
        ]
        product.measure_unit = (str(raw.get("measureUnit") or "") or None) and str(
            raw.get("measureUnit")
        )[:32]
        product.is_active = bool(raw.get("isActive", True))
        product.has_sizes = bool(raw.get("hasSizes", False))
        product.seen_at = now

    # Товары, которых в выгрузке больше нет, удаляем: номенклатура кассы —
    # источник правды, а не накопительный список
    stale = [code for code in existing if code not in seen]
    if stale:
        await session.execute(
            delete(IikoProduct).where(
                IikoProduct.tenant_id == tenant.id,
                IikoProduct.restaurant_id == restaurant_id,
                IikoProduct.product_id.in_(stale),
            )
        )

    return len(seen)


# ─────────────────────── сборка заказа для плагина ───────────────────────


async def build_order_payload(
    session: AsyncSession, tenant: Tenant, order: Order
) -> dict[str, object]:
    """Превращает наш заказ в то, что плагин заведёт на кассе.

    Коды товаров берём из сопоставления этого ресторана: база iiko у каждой
    точки своя, и одно и то же блюдо там имеет разные коды. Блюдо без
    сопоставления уедет с пустым кодом, плагин честно ответит «товар не найден»,
    и менеджер увидит это в очереди.
    """
    links = await _links(session, tenant, order)

    items: list[dict[str, object]] = []
    for item in order.items:
        link = links.get(("dish", str(item.dish_id))) if item.dish_id else None

        modifiers = []
        for extra in item.extras or []:
            extra_link = links.get(("extra", str(extra.get("id") or "")))
            modifiers.append(
                {
                    "productId": extra_link.product_id if extra_link else "",
                    "groupId": (extra_link.modifier_group_id or "") if extra_link else "",
                    # Добавку берут на каждую порцию: две пиццы — два бекона
                    "amount": item.quantity,
                    "name": str(extra.get("name", "")),
                }
            )

        items.append(
            {
                "productId": link.product_id if link else "",
                "sizeId": (link.size_id or "") if link else "",
                "amount": item.quantity,
                "name": item.name,
                "modifiers": modifiers,
            }
        )

    return {
        "orderId": str(order.id),
        "orderNumber": order.number,
        "orderType": "pickup" if order.type is OrderType.PICKUP else "delivery",
        "phone": order.contact_phone,
        "customerName": order.contact_name or "",
        "email": "",
        "comment": order.comment or "",
        "expectedDeliveryAt": order.delivery_at.isoformat() if order.delivery_at else "",
        # Обещанный гостю срок, а не дежурное значение из настроек плагина
        "deliveryMinutes": order.delivery_minutes or 0,
        "personsCount": order.persons_count or 0,
        "marketingSource": "Мобильное приложение",
        "payment": _payment_payload(order),
        "address": _address_payload(order),
        "items": items,
    }


async def _links(
    session: AsyncSession, tenant: Tenant, order: Order
) -> dict[tuple[str, str], IikoLink]:
    """Сопоставления блюд и добавок этого заказа — только для его ресторана."""
    dish_ids = {item.dish_id for item in order.items if item.dish_id is not None}
    extra_ids = {
        UUID(str(extra["id"]))
        for item in order.items
        for extra in (item.extras or [])
        if extra.get("id")
    }

    if not dish_ids and not extra_ids:
        return {}

    rows = await session.scalars(
        select(IikoLink).where(
            IikoLink.tenant_id == tenant.id,
            IikoLink.restaurant_id == order.restaurant_id,
            (IikoLink.dish_id.in_(dish_ids)) | (IikoLink.extra_id.in_(extra_ids)),
        )
    )

    found: dict[tuple[str, str], IikoLink] = {}
    for link in rows:
        if link.dish_id is not None:
            found[("dish", str(link.dish_id))] = link
        elif link.extra_id is not None:
            found[("extra", str(link.extra_id))] = link
    return found


# Как называется способ оплаты на кассе. Гостю мы пишем иначе, а кассиру нужно
# короткое понятное слово в комментарии к заказу
_PAYMENT_LABELS = {
    PaymentMethod.CASH_ON_DELIVERY: "наличными курьеру",
    PaymentMethod.CARD_ON_DELIVERY: "картой курьеру",
    PaymentMethod.ONLINE_SBP: "онлайн, СБП",
    PaymentMethod.ONLINE_CARD: "онлайн, картой",
}


def _payment_payload(order: Order) -> dict[str, object]:
    """Деньги: чем платит гость, оплачено ли уже и из чего сложилась сумма.

    Касса считает свою цену по прайсу, поэтому итог отправляем свой: если он
    разойдётся, разбираться будут при вручении, а не потом по отчётам.
    """
    return {
        "method": order.payment_method.value,
        "methodLabel": _PAYMENT_LABELS.get(order.payment_method, order.payment_method.value),
        "isPaid": order.payment_status is PaymentStatus.SUCCEEDED,
        "status": order.payment_status.value,
        "changeFromKopecks": order.change_from_kopecks or 0,
        "subtotalKopecks": order.subtotal_kopecks,
        "deliveryKopecks": order.delivery_kopecks,
        "cutleryKopecks": order.cutlery_kopecks,
        "discountKopecks": order.discount_kopecks,
        "promoCode": order.promo_code or "",
        "promoDiscountKopecks": order.promo_discount_kopecks,
        "pointsSpent": order.points_spent,
        "totalKopecks": order.total_kopecks,
    }


def _address_payload(order: Order) -> dict[str, str]:
    """Адрес по частям.

    Строкой курьер находит дом, а квартиру, подъезд, этаж и домофон касса ждёт
    отдельными полями — их гость заполнял, когда сохранял адрес. Координаты
    намеренно не передаём: курьеры ездят по названию улицы.
    """
    if order.type is OrderType.PICKUP:
        return {}

    details = order.address_details or {}

    # Старые заказы снимка не имеют — тогда отдаём строку целиком, как раньше
    if not details:
        return {"street": order.address_text or ""} if order.address_text else {}

    return {
        "city": details.get("locality", ""),
        "street": details.get("street", ""),
        "house": details.get("house", ""),
        "building": details.get("building", ""),
        "construction": "",
        "flat": details.get("flat", ""),
        "entrance": details.get("entrance", ""),
        "floor": details.get("floor", ""),
        "doorphone": details.get("intercom", ""),
        "postalCode": details.get("postal_code", ""),
        "additionalInfo": details.get("comment", ""),
        # Полная строка на случай, если оператор смотрит одним полем
        "fullText": order.address_text or "",
    }


# ─────────────────────────── статусы доставок ───────────────────────────


async def apply_delivery_status(
    session: AsyncSession,
    tenant: Tenant,
    restaurant_id: UUID,
    orders: list[dict[str, object]],
) -> int:
    """Двигает статус заказа по тому, что происходит на кухне.

    На кассе версии V8 отдельных статусов «готовим» и «готово» нет — их дают
    временные метки заказа. Поэтому смотрим на метки, а не на строку статуса.

    Каждый сдвиг сопровождается уведомлением гостю: ради этого интеграция
    и делалась — иначе гость по-прежнему ничего не знает о своём заказе.
    """
    touched = 0

    for row in orders:
        raw_id = str(row.get("orderId") or "")
        try:
            order_id = UUID(raw_id)
        except ValueError:
            continue

        order = await session.scalar(
            select(Order).where(
                Order.id == order_id,
                Order.tenant_id == tenant.id,
                Order.restaurant_id == restaurant_id,
            )
        )
        if order is None:
            continue

        target = _status_from_marks(row)
        if target is None or target == order.status:
            continue

        if target is OrderStatus.CANCELLED:
            # Отмена приходит откуда угодно и в любой момент — она не часть
            # цепочки и правилу «только вперёд» не подчиняется
            if order.status is OrderStatus.CANCELLED:
                continue

            order.status = OrderStatus.CANCELLED
            order.cancelled_at = datetime.now(UTC)
            order.cancel_reason = (
                str(row.get("cancelCause") or "") or "Отменён рестораном на кассе"
            )[:200]
            await _return_points(session, tenant, order)
        else:
            # Назад по цепочке не двигаем: касса могла прислать старый срез,
            # а гость уже видел, что заказ в пути
            if _rank(target) <= _rank(order.status):
                continue

            order.status = target
            if target is OrderStatus.COMPLETED:
                order.completed_at = datetime.now(UTC)

        touched += 1
        await _notify(session, tenant, order)

    return touched


async def _notify(session: AsyncSession, tenant: Tenant, order: Order) -> None:
    """Уведомление гостю. Не дошло — статус всё равно остаётся смещённым."""
    from app.services import push as push_service

    try:
        await push_service.notify_order(session, tenant.id, order)
    except Exception as error:
        print(f"пуш о заказе {order.number} не ушёл: {error}")


async def _return_points(session: AsyncSession, tenant: Tenant, order: Order) -> None:
    """Возвращает списанные баллы и забирает начисленные при отмене.

    Баллы начисляются при оформлении, поэтому за отменённый заказ гость не
    должен остаться ни в плюсе, ни в минусе.
    """
    if order.points_spent == 0 and order.points_earned == 0:
        return

    account = await session.scalar(
        select(LoyaltyAccount).where(
            LoyaltyAccount.tenant_id == tenant.id,
            LoyaltyAccount.guest_id == order.guest_id,
        )
    )
    if account is None:
        return

    if order.points_spent > 0:
        account.points_balance += order.points_spent
        session.add(
            LoyaltyTransaction(
                tenant_id=tenant.id,
                account_id=account.id,
                order_id=order.id,
                operation=LoyaltyOperation.REFUND,
                points=order.points_spent,
                balance_after=account.points_balance,
                comment=f"Возврат баллов за отменённый заказ {order.number}",
            )
        )

    if order.points_earned > 0:
        account.points_balance = max(0, account.points_balance - order.points_earned)
        session.add(
            LoyaltyTransaction(
                tenant_id=tenant.id,
                account_id=account.id,
                order_id=order.id,
                operation=LoyaltyOperation.MANUAL,
                points=-order.points_earned,
                balance_after=account.points_balance,
                comment=f"Отмена кэшбэка за заказ {order.number}",
            )
        )


# Порядок этапов. Заказ движется только вперёд
_ORDER_FLOW = [
    OrderStatus.CREATED,
    OrderStatus.ACCEPTED,
    OrderStatus.COOKING,
    OrderStatus.READY,
    OrderStatus.DELIVERING,
    OrderStatus.COMPLETED,
]


def _rank(status: OrderStatus) -> int:
    try:
        return _ORDER_FLOW.index(status)
    except ValueError:
        return -1


def _status_from_marks(row: dict[str, object]) -> OrderStatus | None:
    """Какой этап показать гостю по меткам времени с кассы."""
    if row.get("cancelledAt"):
        return OrderStatus.CANCELLED
    if row.get("deliveredAt"):
        return OrderStatus.COMPLETED
    if row.get("sentAt"):
        return OrderStatus.DELIVERING
    if row.get("cookingFinishedAt"):
        return OrderStatus.READY
    # Позиции ушли на кухню — значит, готовят
    if row.get("printedAt"):
        return OrderStatus.COOKING
    if row.get("confirmedAt"):
        return OrderStatus.ACCEPTED
    return None


# ─────────────────────── сопоставление из админки ───────────────────────


async def save_links(
    session: AsyncSession,
    tenant: Tenant,
    restaurant_id: UUID,
    links: list[dict[str, object]],
) -> int:
    """Сохраняет сопоставление блюд и добавок с товарами кассы этой точки.

    Пустой код товара означает «связь снять»: менеджер стёр поле, потому что
    блюдо в этом ресторане не готовят.
    """
    saved = 0

    for raw in links:
        kind = str(raw.get("kind") or "")
        if kind not in ("dish", "extra"):
            continue

        try:
            target_id = UUID(str(raw.get("id")))
        except (ValueError, TypeError):
            continue

        product_id = str(raw.get("product_id") or "").strip()

        where = [
            IikoLink.tenant_id == tenant.id,
            IikoLink.restaurant_id == restaurant_id,
            IikoLink.dish_id == target_id if kind == "dish" else IikoLink.extra_id == target_id,
        ]
        link = await session.scalar(select(IikoLink).where(*where))

        if not product_id:
            if link is not None:
                await session.delete(link)
                saved += 1
            continue

        if link is None:
            link = IikoLink(
                tenant_id=tenant.id,
                restaurant_id=restaurant_id,
                dish_id=target_id if kind == "dish" else None,
                extra_id=target_id if kind == "extra" else None,
                product_id=product_id[:64],
            )
            session.add(link)
        else:
            link.product_id = product_id[:64]

        link.size_id = (str(raw.get("size_id") or "").strip() or None) and str(raw.get("size_id"))[
            :64
        ]
        link.modifier_group_id = (
            str(raw.get("modifier_group_id") or "").strip() or None
        ) and str(raw.get("modifier_group_id"))[:64]
        saved += 1

    return saved


def _normalize(name: str) -> str:
    """Название для сравнения.

    Регистр, «ё» и лишние пробелы значения не имеют. Скобки выбрасываем:
    в номенклатуре кассы к названию дописывают всё подряд — «(доставка от
    1500р)», «(с собой)», «(СЕТ)», — а блюдо за ними одно и то же.
    """
    cleaned = re.sub(r"[(\[].*?[)\]]", " ", name.lower().replace("ё", "е"))
    return " ".join(cleaned.split())


async def groups(
    session: AsyncSession, tenant: Tenant, restaurant_id: UUID
) -> list[dict[str, object]]:
    """Группы номенклатуры кассы со счётчиком товаров.

    В базе точки тысячи позиций: заготовки, посуда, акции прошлых лет. Меню,
    которое реально продаётся, лежит в нескольких группах — по ним и работаем.
    """
    rows = await session.execute(
        select(IikoProduct.group_name, func.count())
        .where(
            IikoProduct.tenant_id == tenant.id,
            IikoProduct.restaurant_id == restaurant_id,
            IikoProduct.is_active.is_(True),
        )
        .group_by(IikoProduct.group_name)
        .order_by(func.count().desc())
    )

    return [{"name": name or "", "products": total} for name, total in rows]


def _tokens(name: str) -> set[str]:
    """Слова названия для сравнения: короткие обрывки только мешают."""
    return {word for word in _normalize(name).split() if len(word) > 2}


def _score(ours: str, theirs: str) -> float:
    """Насколько название кассы похоже на наше блюдо.

    Считаем по общим словам, а не по буквам: «Пицца Пепперони» и «Пепперони»
    должны сойтись, а «Пицца Маргарита» и «Пицца Пепперони» — нет.
    """
    left, right = _tokens(ours), _tokens(theirs)
    if not left or not right:
        return 0.0

    common = len(left & right)
    if common == 0:
        return 0.0

    # Делим на большее множество: длинное название кассы с кучей приписок
    # не должно выигрывать только потому, что в нём много слов
    return common / max(len(left), len(right))


async def search_products(
    session: AsyncSession,
    tenant: Tenant,
    restaurant_id: UUID,
    query: str,
    only_groups: list[str] | None = None,
    limit: int = 40,
) -> list[IikoProduct]:
    """Поиск по номенклатуре кассы. Ищет сервер: в базе точки десятки тысяч позиций."""
    stmt = select(IikoProduct).where(
        IikoProduct.tenant_id == tenant.id,
        IikoProduct.restaurant_id == restaurant_id,
        IikoProduct.is_active.is_(True),
    )
    if only_groups:
        stmt = stmt.where(IikoProduct.group_name.in_(only_groups))

    needle = query.strip()
    if needle:
        stmt = stmt.where(IikoProduct.name.ilike(f"%{needle}%"))

    return list(await session.scalars(stmt.order_by(IikoProduct.name).limit(limit)))


async def suggest(
    session: AsyncSession,
    tenant: Tenant,
    restaurant_id: UUID,
    names: list[str],
    only_groups: list[str] | None = None,
    per_name: int = 3,
) -> dict[str, list[IikoProduct]]:
    """Кандидаты для каждого нашего блюда — по совпадению слов в названии.

    Считаем один раз на всю страницу: отдельный запрос на строку превратил бы
    сопоставление в ожидание.
    """
    stmt = select(IikoProduct).where(
        IikoProduct.tenant_id == tenant.id,
        IikoProduct.restaurant_id == restaurant_id,
        IikoProduct.is_active.is_(True),
    )
    if only_groups:
        stmt = stmt.where(IikoProduct.group_name.in_(only_groups))

    products = list(await session.scalars(stmt))
    found: dict[str, list[IikoProduct]] = {}

    for name in names:
        scored = [(_score(name, product.name), product) for product in products]
        best = sorted(
            (pair for pair in scored if pair[0] >= 0.5),
            key=lambda pair: (-pair[0], len(pair[1].name)),
        )[:per_name]
        if best:
            found[name] = [product for _, product in best]

    return found


async def auto_match(
    session: AsyncSession,
    tenant: Tenant,
    restaurant_id: UUID,
    only_groups: list[str] | None = None,
) -> tuple[int, int]:
    """Связывает блюда с товарами кассы по совпадению названий.

    Берём только однозначные совпадения: если в кассе два товара с одинаковым
    названием, выбор оставляем человеку — ошибка здесь уедет прямо на кухню.
    Уже сопоставленное не трогаем.

    Группы сужают поиск: без них одно и то же блюдо находится и в заготовках,
    и в прошлогодних акциях, и совпадение перестаёт быть однозначным.
    """
    query = select(IikoProduct).where(
        IikoProduct.tenant_id == tenant.id,
        IikoProduct.restaurant_id == restaurant_id,
        IikoProduct.is_active.is_(True),
    )
    if only_groups:
        query = query.where(IikoProduct.group_name.in_(only_groups))

    products: dict[str, list[str]] = {}
    for product in await session.scalars(query):
        products.setdefault(_normalize(product.name), []).append(product.product_id)

    linked_dishes = set()
    linked_extras = set()
    for link in await session.scalars(
        select(IikoLink).where(
            IikoLink.tenant_id == tenant.id, IikoLink.restaurant_id == restaurant_id
        )
    ):
        if link.dish_id:
            linked_dishes.add(link.dish_id)
        if link.extra_id:
            linked_extras.add(link.extra_id)

    matched = 0
    skipped = 0

    dishes = await session.scalars(
        select(Dish).where(Dish.tenant_id == tenant.id, Dish.is_active.is_(True))
    )
    for dish in dishes:
        if dish.id in linked_dishes:
            continue

        found = products.get(_normalize(dish.name), [])
        if len(found) != 1:
            skipped += 1
            continue

        session.add(
            IikoLink(
                tenant_id=tenant.id,
                restaurant_id=restaurant_id,
                dish_id=dish.id,
                product_id=found[0],
            )
        )
        matched += 1

    extras = await session.scalars(
        select(DishExtra).where(DishExtra.tenant_id == tenant.id, DishExtra.is_active.is_(True))
    )
    for extra in extras:
        if extra.id in linked_extras:
            continue

        found = products.get(_normalize(extra.name), [])
        if len(found) != 1:
            skipped += 1
            continue

        session.add(
            IikoLink(
                tenant_id=tenant.id,
                restaurant_id=restaurant_id,
                extra_id=extra.id,
                product_id=found[0],
            )
        )
        matched += 1

    return matched, skipped
