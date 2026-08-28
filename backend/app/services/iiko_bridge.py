"""Обмен с плагином на кассовом терминале ресторана.

Плагин сам приходит к нам: забирает заказы, отдаёт стоп-лист, номенклатуру
и состояние доставок. Мы к нему не стучимся — у терминала нет белого адреса,
а интернет в ресторане пропадает регулярно.
"""

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.core.tenants import Tenant
from app.models.enums import (
    IikoHandoffStatus,
    LoyaltyOperation,
    OrderStatus,
    OrderType,
    PaymentMethod,
    PaymentStatus,
)
from app.models.integration import (
    IikoBridge,
    IikoLink,
    IikoMenuSetup,
    IikoOrderHandoff,
    IikoProduct,
)
from app.models.loyalty import LoyaltyAccount, LoyaltyTransaction
from app.models.menu import Dish, DishExtra, DishPrice, MenuCategory, StopListEntry
from app.models.order import Order
from app.services import push as push_service

# Столько плагину даётся на то, чтобы завести заказ и отчитаться.
# Не успел — заказ снова попадёт в выдачу, чтобы не потеряться навсегда
LOCK_MINUTES = 3

# Больше этого числа попыток не делаем: если заказ не заводится трижды,
# дело не в связи, и повторы только мешают менеджеру
MAX_ATTEMPTS = 3

SELLABLE_PRODUCT_TYPES = {"", "Dish", "Goods", "Modifier"}
CUTLERY_FINGERPRINT_KEY = "__cutlery__"

# Значения по умолчанию для первой настройки сети. Дальше дерево живёт
# в базе: ветки категорий — в самих категориях меню, мусорные метки — в
# настройке сети. Здесь они лежат только чтобы новому тенанту было с чего
# начать, а не чтобы кто-то правил код ради нового ресторана.
DEFAULT_DENY_MARKERS = (
    "Я СТАРОЕ",
    "АКЦИИ",
    "С СОБОЙ",
    "2 ПО ЦЕНЕ",
    "ПОДЛОЖКА",
    "КУХНЯ/ФРУКТЫ",
    "БИЗНЕС_ЛАНЧ_СТАРОЕ",
)


# Цена выше этой — заглушка кассы, а не деньги. Держим потолок, чтобы одна
# такая позиция не роняла всю выгрузку номенклатуры
MAX_PRICE_KOPECKS = 100_000_000


class BridgeError(Exception):
    pass


@dataclass(slots=True)
class MenuTree:
    """Дерево номенклатуры сети: где искать меню и что считать мусором."""

    # Ветка кассы → название нашей категории. Пусто — сеть ещё не настроена
    category_paths: dict[str, tuple[str, ...]]
    deny_markers: tuple[str, ...]
    extra_paths: tuple[str, ...]
    keep_unknown_groups: bool

    @property
    def allowed(self) -> tuple[str, ...]:
        """Все ветки, где вообще может лежать меню сети."""
        found: list[str] = []
        for paths in self.category_paths.values():
            found.extend(paths)
        found.extend(self.extra_paths)
        return tuple(dict.fromkeys(found))

    def is_denied(self, path: str) -> bool:
        upper = path.upper()
        return any(marker in upper for marker in self.deny_markers)

    def in_menu(self, path: str) -> bool:
        """Лежит ли ветка в меню сети. Дерево не настроено — берём всё."""
        if self.is_denied(path):
            return False
        if not self.allowed:
            return True
        upper = path.upper()
        return any(upper.startswith(prefix) for prefix in self.allowed)

    def fits_category(self, category_name: str, path: str) -> bool:
        """Годится ли товар этой ветки для блюда указанной категории."""
        if self.is_denied(path):
            return False

        paths = self.category_paths.get(category_name.strip())
        if not paths:
            return self.in_menu(path)

        upper = path.upper()
        return any(upper.startswith(prefix) for prefix in paths)


async def menu_tree(session: AsyncSession, tenant: Tenant) -> MenuTree:
    """Собирает дерево сети из базы.

    Ветки категорий лежат в самих категориях: так их видно там же, где меню,
    и перенос на новый ресторан не требуется — в iiko chain коды общие.
    """
    setup = await session.scalar(
        select(IikoMenuSetup).where(IikoMenuSetup.tenant_id == tenant.id)
    )

    rows = await session.execute(
        select(MenuCategory.name, MenuCategory.iiko_group_paths).where(
            MenuCategory.tenant_id == tenant.id
        )
    )

    category_paths: dict[str, tuple[str, ...]] = {}
    for name, paths in rows:
        cleaned = tuple(str(path).strip().upper() for path in (paths or []) if str(path).strip())
        if cleaned:
            category_paths[name.strip()] = cleaned

    markers = tuple(
        str(marker).strip().upper()
        # Пустой список у настроенной сети — осознанный выбор «мусорных меток
        # нет», а NULL бывает у строк, заведённых мимо приложения
        for marker in (
            setup.deny_markers if setup and setup.deny_markers is not None else DEFAULT_DENY_MARKERS
        )
        if str(marker).strip()
    )
    extras = tuple(
        str(path).strip().upper()
        for path in ((setup.extra_group_paths or ()) if setup else ())
        if str(path).strip()
    )

    return MenuTree(
        category_paths=category_paths,
        deny_markers=markers,
        extra_paths=extras,
        keep_unknown_groups=bool(setup.keep_unknown_groups) if setup else False,
    )


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
        handoff.error = (error or "")[:2000] or None
        handoff.missing_products = missing_products or []

        # Номер кассы кладём и в сам заказ: по нему заказ находят
        # и на кухне, и в разговоре с гостем
        order = await session.get(Order, order_id)
        if order is not None:
            if handoff.iiko_order_id:
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
    """Сохраняет выгруженную номенклатуру для экрана сопоставления.

    В справочнике точки десятки тысяч позиций: заготовки, посуда, акции
    прошлых лет. Храним только ветки меню сети — остальное не нужно ни для
    сопоставления, ни для стоп-листа, а место и время занимает.
    """
    now = datetime.now(UTC)
    tree = await menu_tree(session, tenant)

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
    skipped = 0
    for raw in products:
        code = str(raw.get("productId") or "").strip()
        if not code:
            continue

        path = str(raw.get("groupPath") or raw.get("groupName") or "")
        if not tree.keep_unknown_groups and not tree.in_menu(path):
            skipped += 1
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
        product.product_type = (str(raw.get("type") or "") or None) and str(raw.get("type"))[:32]
        # Деньги держим в копейках: рубли с копейками приходят дробью.
        # Потолок нужен от заглушек вроде «8 888 888 888 рублей»: такие цены
        # ставят, чтобы товар нельзя было пробить, а падать на них нельзя
        product.price_kopecks = min(round(_float(raw.get("price")) * 100), MAX_PRICE_KOPECKS)
        product.is_active = bool(raw.get("isActive", True))
        product.has_sizes = bool(raw.get("hasSizes", False))
        product.seen_at = now

    # Товары, которых в выгрузке больше нет, удаляем: номенклатура кассы —
    # источник правды, а не накопительный список
    if skipped:
        print(f"iiko: пропущено {skipped} товаров вне веток меню сети")

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
        "pointsEarned": order.points_earned,
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

    full_text = (order.address_text or "").strip()

    return {
        "city": details.get("locality", ""),
        "street": details.get("street", ""),
        "house": details.get("house", ""),
        # Плагин сам укоротит Building, если терминал работает в старом
        # формате адреса. В Line1 остаётся полный корпус.
        "building": str(details.get("building", "") or ""),
        "construction": "",
        "flat": details.get("flat", ""),
        "entrance": details.get("entrance", ""),
        "floor": details.get("floor", ""),
        "doorphone": details.get("intercom", ""),
        "postalCode": details.get("postal_code", ""),
        "comment": str(details.get("comment", "") or ""),
        "additionalInfo": _delivery_notes(order),
        # Полная строка на случай, если оператор смотрит одним полем
        "fullText": full_text,
    }


def _delivery_notes(order: Order) -> str:
    """Текст для поля «Примечания» в доставке iiko."""
    notes = ["Мобильное приложение"]
    if order.points_spent > 0:
        notes.append(f"Списано баллов: {order.points_spent}")
    if order.points_earned > 0:
        notes.append(f"Начислено баллов: {order.points_earned}")
    if order.discount_kopecks > 0:
        discount = f"Скидка: {order.discount_kopecks / 100:g} руб"
        if order.promo_code:
            discount += f" по промокоду {order.promo_code}"
        notes.append(discount)
    return ". ".join(notes)


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
        order = await _find_order_by_iiko_reference(
            session, tenant, restaurant_id, str(row.get("orderId") or "")
        )
        if order is None:
            continue

        identity_changed = await _sync_iiko_identity(session, tenant, restaurant_id, order, row)
        details_changed = await _sync_iiko_details(session, tenant, order, row)
        target = _status_from_marks(row)
        status_changed = False

        if target is None or target == order.status:
            pass
        elif target is OrderStatus.CANCELLED:
            # Отмена приходит откуда угодно и в любой момент — она не часть
            # цепочки и правилу «только вперёд» не подчиняется
            order.status = OrderStatus.CANCELLED
            order.cancelled_at = _parse_iiko_time(row.get("cancelledAt")) or datetime.now(UTC)
            order.cancel_reason = _cancel_reason(row)
            await _return_points(session, tenant, order)
            status_changed = True
        else:
            # Назад по цепочке не двигаем: касса могла прислать старый срез,
            # а гость уже видел, что заказ в пути
            if _rank(target) <= _rank(order.status):
                target = None
            else:
                order.status = target
                if target is OrderStatus.COMPLETED:
                    order.completed_at = _parse_iiko_time(row.get("deliveredAt")) or datetime.now(
                        UTC
                    )
                status_changed = True

        if not status_changed and not details_changed and not identity_changed:
            continue

        touched += 1
        if status_changed:
            await _notify(session, tenant, order)

    return touched


async def _find_order_by_iiko_reference(
    session: AsyncSession,
    tenant: Tenant,
    restaurant_id: UUID,
    reference: str,
) -> Order | None:
    """Находит заказ по скрытому UUID или по видимому номеру `Мобильное ...`."""
    text = reference.strip()
    if not text:
        return None

    try:
        order_id = UUID(text)
    except ValueError:
        order_number = _order_number_from_iiko_reference(text)
        if not order_number:
            return None
        order = await session.scalar(
            select(Order).where(
                Order.number == order_number,
                Order.tenant_id == tenant.id,
                Order.restaurant_id == restaurant_id,
            )
        )
        return order

    order = await session.scalar(
        select(Order).where(
            Order.id == order_id,
            Order.tenant_id == tenant.id,
            Order.restaurant_id == restaurant_id,
        )
    )
    return cast(Order | None, order)


def _order_number_from_iiko_reference(reference: str) -> str:
    text = reference.strip()
    lowered = text.lower()
    for prefix in ("мобильное приложение", "мобильное", "mobile"):
        if lowered.startswith(prefix):
            text = text[len(prefix) :].strip()
            break
    return text.lstrip("№#:- ").strip()[:20]


async def _sync_iiko_identity(
    session: AsyncSession,
    tenant: Tenant,
    restaurant_id: UUID,
    order: Order,
    row: dict[str, object],
) -> bool:
    """Фиксирует факт, что заказ уже существует в iiko, и дописывает его номер."""
    changed = False
    now = datetime.now(UTC)

    iiko_order_id = _text_or_none(row.get("iikoOrderId"), 64)
    iiko_order_number = _text_or_none(row.get("iikoOrderNumber"), 32)
    has_identity = bool(iiko_order_id or iiko_order_number)

    handoff = await session.scalar(
        select(IikoOrderHandoff).where(
            IikoOrderHandoff.tenant_id == tenant.id,
            IikoOrderHandoff.restaurant_id == restaurant_id,
            IikoOrderHandoff.order_id == order.id,
        )
    )

    confirmed_by_handoff = False
    if handoff is not None:
        if handoff.status is not IikoHandoffStatus.ACCEPTED:
            handoff.status = IikoHandoffStatus.ACCEPTED
            handoff.locked_until = None
            handoff.error = None
            handoff.missing_products = []
            confirmed_by_handoff = True
            changed = True
        if handoff.accepted_at is None:
            handoff.accepted_at = now
            changed = True
        if iiko_order_id and handoff.iiko_order_id != iiko_order_id:
            handoff.iiko_order_id = iiko_order_id
            changed = True
        if iiko_order_number and handoff.iiko_order_number != iiko_order_number:
            handoff.iiko_order_number = iiko_order_number
            changed = True

    if iiko_order_id and order.external_id != iiko_order_id:
        order.external_id = iiko_order_id
        changed = True
    if order.synced_at is None and (has_identity or confirmed_by_handoff):
        order.synced_at = now
        changed = True

    return changed


async def _sync_iiko_details(
    session: AsyncSession, tenant: Tenant, order: Order, row: dict[str, object]
) -> bool:
    """Сохраняет факты iiko, даже если гостевой этап заказа не изменился."""
    changed = False
    now = datetime.now(UTC)

    def assign(attr: str, value: object) -> None:
        nonlocal changed
        if getattr(order, attr) != value:
            setattr(order, attr, value)
            changed = True

    assign("iiko_status", _text_or_none(row.get("status"), 40))
    assign("iiko_problem_comment", _text_or_none(row.get("problemComment"), 2000))
    assign("iiko_courier_name", _text_or_none(row.get("courierName"), 120))
    assign("iiko_cancel_cause", _text_or_none(row.get("cancelCause"), 300))
    assign("iiko_cancel_comment", _text_or_none(row.get("cancelComment"), 500))

    raw_items = row.get("items")
    if isinstance(raw_items, list):
        items = _normalize_iiko_items(raw_items)
        if order.iiko_items != items:
            order.iiko_items = items
            changed = True

        # Пустой список — это «нечего показать», а не «всё убрали». Так
        # приходят отменённые и закрытые заказы, и объявлять это правкой
        # состава нельзя: гость увидел бы пустую карточку «заказ изменили»
        cancelled = bool(row.get("cancelledAt")) or order.status is OrderStatus.CANCELLED
        items_changed = (
            bool(items)
            and not cancelled
            and await _iiko_items_changed(session, tenant, order, items)
        )

        next_changed_at = (order.iiko_items_changed_at or now) if items_changed else None
        if order.iiko_items_changed_at != next_changed_at:
            # Сообщаем один раз — в момент, когда правка появилась. Дальше
            # касса шлёт тот же срез каждые полминуты, и гостя это разбудило бы
            became_changed = next_changed_at is not None and order.iiko_items_changed_at is None
            order.iiko_items_changed_at = next_changed_at
            changed = True

            if became_changed:
                await _notify_event(session, tenant, order, push_service.ORDER_CHANGED)

    if changed:
        order.iiko_status_updated_at = now

    return changed


def _normalize_iiko_items(raw: object) -> list[dict[str, object]]:
    if not isinstance(raw, list):
        return []

    result: list[dict[str, object]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue

        product_id = str(item.get("productId") or "").strip()
        name = str(item.get("name") or "").strip()
        if not product_id and not name:
            continue

        result.append(
            {
                "product_id": product_id,
                "name": name,
                "amount": _float(item.get("amount")),
                "price": _float(item.get("price")),
                "net_sum": _float(item.get("netSum")),
                "group_name": str(item.get("groupName") or "").strip(),
                "group_path": str(item.get("groupPath") or "").strip(),
            }
        )

    return result


async def _iiko_items_changed(
    session: AsyncSession,
    tenant: Tenant,
    order: Order,
    actual_items: list[dict[str, object]],
) -> bool:
    expected = await _expected_iiko_fingerprint(session, tenant, order)
    actual = _actual_iiko_fingerprint(actual_items)
    if not expected:
        return False
    return expected != actual


async def _expected_iiko_fingerprint(
    session: AsyncSession, tenant: Tenant, order: Order
) -> dict[str, float]:
    links = await _links(session, tenant, order)
    result: defaultdict[str, float] = defaultdict(float)

    for item in order.items:
        link = links.get(("dish", str(item.dish_id))) if item.dish_id else None
        _add_iiko_fingerprint(result, link.product_id if link else "", item.name, item.quantity)

        for extra in item.extras or []:
            extra_link = links.get(("extra", str(extra.get("id") or "")))
            _add_iiko_fingerprint(
                result,
                extra_link.product_id if extra_link else "",
                str(extra.get("name") or ""),
                item.quantity,
            )

    if (order.persons_count or 0) > 0 and order.cutlery_kopecks > 0:
        _add_iiko_fingerprint(result, "", "Приборы", order.persons_count or 0)

    return dict(result)


def _actual_iiko_fingerprint(items: list[dict[str, object]]) -> dict[str, float]:
    result: defaultdict[str, float] = defaultdict(float)
    for item in items:
        _add_iiko_fingerprint(
            result,
            str(item.get("product_id") or ""),
            str(item.get("name") or ""),
            _float(item.get("amount")),
        )
    return dict(result)


def _add_iiko_fingerprint(
    target: defaultdict[str, float], product_id: str, name: str, amount: float | int
) -> None:
    key = (
        CUTLERY_FINGERPRINT_KEY
        if _is_cutlery_name(name)
        else product_id.strip() or _normalize(name)
    )
    if not key:
        return
    target[key] = round(target[key] + float(amount or 0), 3)


def _is_cutlery_name(name: str) -> bool:
    normalized = _normalize(name)
    return normalized == "приборы" or normalized.startswith("приборы одноразовые")


def _float(value: object) -> float:
    try:
        return round(float(str(value or 0)), 3)
    except (TypeError, ValueError):
        return 0.0


def _text_or_none(value: object, limit: int) -> str | None:
    text = str(value or "").strip()
    return text[:limit] or None


def _cancel_reason(row: dict[str, object]) -> str:
    cause = _text_or_none(row.get("cancelCause"), 200)
    comment = _text_or_none(row.get("cancelComment"), 200)
    if cause and comment and cause != comment:
        return f"{cause}: {comment}"[:300]
    return (comment or cause or "Отменён рестораном на кассе")[:300]


def _parse_iiko_time(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


async def _notify_event(
    session: AsyncSession, tenant: Tenant, order: Order, event: str
) -> None:
    """Событие вне цепочки этапов. Не дошло — правка всё равно сохранена."""
    try:
        await push_service.notify_event(session, tenant.id, order, event)
    except Exception as error:
        print(f"уведомление о заказе {order.number} не ушло: {error}")


async def _notify(session: AsyncSession, tenant: Tenant, order: Order) -> None:
    """Уведомление гостю. Не дошло — статус всё равно остаётся смещённым."""
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
    status = str(row.get("status") or "").lower()
    if row.get("cancelledAt") or status == "cancelled":
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
    tree = await menu_tree(session, tenant)

    rows = await session.execute(
        select(IikoProduct.group_path, IikoProduct.group_name, func.count())
        .where(
            IikoProduct.tenant_id == tenant.id,
            IikoProduct.restaurant_id == restaurant_id,
            IikoProduct.is_active.is_(True),
            IikoProduct.product_type.in_(SELLABLE_PRODUCT_TYPES)
            | IikoProduct.product_type.is_(None),
        )
        .group_by(IikoProduct.group_path, IikoProduct.group_name)
        .order_by(func.count().desc())
    )

    result = [
        {
            "name": name or path or "",
            "path": path or name or "",
            "products": total,
            "is_preset": tree.in_menu(path or name or ""),
        }
        for path, name, total in rows
    ]
    return sorted(result, key=lambda row: (not bool(row["is_preset"]), str(row["path"])))


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
        stmt = stmt.where(_groups_clause(only_groups))

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
        stmt = stmt.where(_groups_clause(only_groups))

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
        query = query.where(_groups_clause(only_groups))

    products = list(await session.scalars(query))

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

    tree = await menu_tree(session, tenant)
    matched = 0
    skipped = 0

    not_sold = select(DishPrice.dish_id).where(
        DishPrice.tenant_id == tenant.id,
        DishPrice.restaurant_id == restaurant_id,
        DishPrice.is_available.is_(False),
    )
    dishes = await session.execute(
        select(Dish, MenuCategory.name)
        .join(MenuCategory, MenuCategory.id == Dish.category_id)
        .where(
            Dish.tenant_id == tenant.id,
            Dish.is_active.is_(True),
            MenuCategory.is_active.is_(True),
            ~Dish.id.in_(not_sold),
        )
    )
    for dish, category_name in dishes:
        if dish.id in linked_dishes:
            continue

        found = [
            product.product_id
            for product in products
            if _normalize(product.name) == _normalize(dish.name)
            and tree.fits_category(
                category_name, product.group_path or product.group_name or ""
            )
        ]
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

    # Автоматом не ставим добавки: для них iikoFront часто требует ещё
    # modifier_group_id. Пока плагин не выгружает группы модификаторов,
    # безопаснее оставить добавку несопоставленной, чем завести заказ криво.
    extras = await session.scalars(
        select(DishExtra).where(DishExtra.tenant_id == tenant.id, DishExtra.is_active.is_(True))
    )
    for extra in extras:
        if extra.id in linked_extras:
            continue
        skipped += 1

    return matched, skipped


def _groups_clause(groups: list[str]) -> ColumnElement[bool]:
    return or_(IikoProduct.group_path.in_(groups), IikoProduct.group_name.in_(groups))




# ─────────────────────── перенос настройки между точками ───────────────────────


async def copy_links(
    session: AsyncSession,
    tenant: Tenant,
    source_id: UUID,
    target_id: UUID,
    overwrite: bool = False,
) -> tuple[int, int]:
    """Переносит сопоставление с настроенной точки на новую.

    В iiko chain товары заводят централизованно, поэтому коды у ресторанов
    сети совпадают: настроили одну точку — остальные получают то же самое
    одним нажатием. Переносим только то, что есть в номенклатуре получателя,
    иначе заказ уедет с кодом, которого на этой кассе нет.
    """
    if source_id == target_id:
        return 0, 0

    known = set(
        await session.scalars(
            select(IikoProduct.product_id).where(
                IikoProduct.tenant_id == tenant.id,
                IikoProduct.restaurant_id == target_id,
            )
        )
    )

    existing = {
        ("dish", link.dish_id) if link.dish_id else ("extra", link.extra_id): link
        for link in await session.scalars(
            select(IikoLink).where(
                IikoLink.tenant_id == tenant.id, IikoLink.restaurant_id == target_id
            )
        )
    }

    copied = 0
    skipped = 0

    source_links = await session.scalars(
        select(IikoLink).where(
            IikoLink.tenant_id == tenant.id, IikoLink.restaurant_id == source_id
        )
    )

    for link in source_links:
        key = ("dish", link.dish_id) if link.dish_id else ("extra", link.extra_id)

        # Номенклатура получателя ещё не пришла — переносим вслепую только
        # если её нет вовсе, иначе бережём точку от несуществующих кодов
        if known and link.product_id not in known:
            skipped += 1
            continue

        current = existing.get(key)
        if current is not None:
            if not overwrite or current.product_id == link.product_id:
                skipped += 1
                continue

            current.product_id = link.product_id
            current.size_id = link.size_id
            current.modifier_group_id = link.modifier_group_id
            copied += 1
            continue

        session.add(
            IikoLink(
                tenant_id=tenant.id,
                restaurant_id=target_id,
                dish_id=link.dish_id,
                extra_id=link.extra_id,
                product_id=link.product_id,
                size_id=link.size_id,
                modifier_group_id=link.modifier_group_id,
            )
        )
        copied += 1

    return copied, skipped


async def save_menu_tree(
    session: AsyncSession,
    tenant: Tenant,
    branches: list[dict[str, object]],
    deny_markers: list[str],
    extra_group_paths: list[str],
    keep_unknown_groups: bool,
) -> int:
    """Сохраняет дерево сети: ветки категорий и общие правила отбора."""
    categories = {
        category.id: category
        for category in await session.scalars(
            select(MenuCategory).where(MenuCategory.tenant_id == tenant.id)
        )
    }

    saved = 0
    for raw in branches:
        category = categories.get(cast(UUID, raw.get("category_id")))
        if category is None:
            continue

        paths = [
            str(path).strip()
            for path in cast(list[object], raw.get("iiko_group_paths") or [])
            if str(path).strip()
        ]
        if category.iiko_group_paths != paths:
            category.iiko_group_paths = paths
            saved += 1

    setup = await session.scalar(
        select(IikoMenuSetup).where(IikoMenuSetup.tenant_id == tenant.id)
    )
    if setup is None:
        setup = IikoMenuSetup(tenant_id=tenant.id)
        session.add(setup)

    setup.deny_markers = [str(marker).strip() for marker in deny_markers if str(marker).strip()]
    setup.extra_group_paths = [str(path).strip() for path in extra_group_paths if str(path).strip()]
    setup.keep_unknown_groups = keep_unknown_groups

    return saved
