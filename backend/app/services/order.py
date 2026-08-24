import secrets
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenants import LoyaltyTier, Tenant
from app.models.enums import (
    LoyaltyOperation,
    OrderStatus,
    OrderType,
    PaymentMethod,
    PaymentStatus,
)
from app.models.geo import Restaurant
from app.models.guest import Guest
from app.models.loyalty import LoyaltyAccount, LoyaltyTransaction
from app.models.menu import Dish, DishExtra, DishPrice, StopListEntry
from app.models.order import Order, OrderItem
from app.schemas.order import (
    CheckoutLimits,
    CheckoutPreview,
    CheckoutPreviewRequest,
    OrderCreate,
    OrderItemCreate,
    OrderItemExtraRead,
    OrderItemRead,
    OrderRead,
    UnavailableItem,
)
from app.services import delivery as delivery_service
from app.services import loyalty as loyalty_service
from app.services import promo_code as promo_service

NUMBER_ATTEMPTS = 5


class OrderError(Exception):
    pass


def _is_online(method: PaymentMethod) -> bool:
    return method in (PaymentMethod.ONLINE_CARD, PaymentMethod.ONLINE_SBP)


def max_points_to_spend(
    tenant: Tenant, balance: int, subtotal_kopecks: int, delivery_kopecks: int = 0
) -> int:
    """Потолок списания: доля чека из конфига тенанта, но не больше баланса.

    Доставку баллами гасить можно, если тенант это разрешает: у сети
    доставка часто и есть то, ради чего баллы копят.
    """
    rate = tenant.loyalty.point_to_ruble_rate
    if rate <= 0:
        return 0

    base = subtotal_kopecks
    if tenant.loyalty.points_cover_delivery:
        base += delivery_kopecks

    cap_by_check = int(base * tenant.loyalty.max_redeem_share_of_check / 100 / rate)
    return max(0, min(balance, cap_by_check))


def _tier_for_spend(tenant: Tenant, lifetime_kopecks: int) -> LoyaltyTier:
    rubles = lifetime_kopecks // 100
    reached = [tier for tier in tenant.loyalty.tiers if tier.threshold_rub <= rubles]
    if not reached:
        return loyalty_service.base_tier(tenant)
    return max(reached, key=lambda tier: tier.threshold_rub)


async def _reserve_number(session: AsyncSession, tenant_id: str) -> str:
    """Номер вида 260815-4271: дата плюс четыре случайные цифры.

    Случайные, а не по порядку: сквозной счётчик потребовал бы блокировки таблицы
    на каждом заказе, а гостю удобнее называть на кассе короткий код.
    """
    today = date.today()
    for _ in range(NUMBER_ATTEMPTS):
        candidate = f"{today:%y%m%d}-{secrets.randbelow(9000) + 1000}"
        taken = await session.scalar(
            select(Order.id).where(Order.tenant_id == tenant_id, Order.number == candidate)
        )
        if taken is None:
            return candidate
    raise OrderError("Не удалось присвоить номер заказу. Попробуйте ещё раз")


def _apply_loyalty(
    tenant: Tenant, account: LoyaltyAccount, order: Order
) -> list[LoyaltyTransaction]:
    """Списание и начисление баллов одним движением.

    Начисляем сразу при оформлении. Когда появится интеграция с кассой,
    начисление переедет на фактическое закрытие заказа.
    """
    entries: list[LoyaltyTransaction] = []

    if order.points_spent > 0:
        account.points_balance -= order.points_spent
        entries.append(
            LoyaltyTransaction(
                tenant_id=tenant.id,
                account_id=account.id,
                order_id=order.id,
                operation=LoyaltyOperation.SPEND,
                points=-order.points_spent,
                balance_after=account.points_balance,
                comment=f"Списание по заказу {order.number}",
            )
        )

    if order.points_earned > 0:
        account.points_balance += order.points_earned
        entries.append(
            LoyaltyTransaction(
                tenant_id=tenant.id,
                account_id=account.id,
                order_id=order.id,
                operation=LoyaltyOperation.EARN,
                points=order.points_earned,
                balance_after=account.points_balance,
                expires_at=datetime.now(UTC)
                + timedelta(days=tenant.loyalty.points_expire_after_days),
                comment=f"Кэшбэк за заказ {order.number}",
            )
        )

    account.lifetime_spent_kopecks += order.total_kopecks
    new_tier = _tier_for_spend(tenant, account.lifetime_spent_kopecks)
    if new_tier.code != account.tier_code:
        account.tier_code = new_tier.code
        account.tier_changed_at = datetime.now(UTC)

    return entries


@dataclass(slots=True)
class DeliveryTerms:
    """Во что обойдётся доставка на этот адрес и что мешает оформить заказ."""

    price_kopecks: int = 0
    min_order_kopecks: int = 0
    free_from_kopecks: int | None = None
    minutes: int | None = None
    opens_at: time | None = None
    closes_at: time | None = None
    open_now: bool = True
    blocker: str | None = None


async def delivery_terms(
    session: AsyncSession,
    tenant: Tenant,
    restaurant: Restaurant,
    subtotal: int,
    latitude: float | None,
    longitude: float | None,
    when: datetime | None = None,
) -> DeliveryTerms:
    terms = DeliveryTerms()

    # Условия берём из зоны, в которую попал адрес: у дальней зоны своя цена
    # и свой минимум. Нет координат — работают условия ресторана
    zone = None
    if latitude is not None and longitude is not None:
        match = await delivery_service.resolve(session, tenant, latitude, longitude)
        if match is None:
            terms.blocker = "По этому адресу доставки пока нет — заберите заказ сами"
            return terms
        if match.restaurant.id != restaurant.id:
            terms.blocker = f"На этот адрес везёт другой ресторан: {match.restaurant.name}"
            return terms
        zone = match.zone

    # Служба доставки работает короче зала. Заказ «ко времени» проверяем на это
    # время, а не на «сейчас»: вечером можно собрать заказ на завтрашний обед
    now = datetime.now(UTC).astimezone(ZoneInfo(tenant.timezone))
    moment = when.astimezone(ZoneInfo(tenant.timezone)) if when is not None else now

    opens = restaurant.delivery_opens_at
    closes = restaurant.delivery_closes_at
    terms.opens_at = opens
    terms.closes_at = closes
    terms.open_now = opens is None or closes is None or opens <= now.time() <= closes

    if opens and closes:
        hours = f"Доставка работает с {opens:%H:%M} до {closes:%H:%M}."

        # Предзаказ выключен — пока закрыто, заказ не принимаем ни на какое время
        if not terms.open_now and not restaurant.preorder_enabled:
            terms.blocker = f"{hours} Сейчас заказ не примем"
            return terms

        if not (opens <= moment.time() <= closes):
            tail = "Выберите время в этом окне" if when is not None else "Сейчас закрыто"
            terms.blocker = f"{hours} {tail}"
            return terms

    # С пятницы по воскресенье минимум бывает выше
    weekend = moment.weekday() >= 4
    terms.min_order_kopecks = restaurant.delivery_min_order_kopecks
    if zone is not None:
        terms.min_order_kopecks = zone.min_order_kopecks
        if weekend and zone.min_order_weekend_kopecks is not None:
            terms.min_order_kopecks = zone.min_order_weekend_kopecks

    terms.free_from_kopecks = (
        zone.free_delivery_from_kopecks if zone else restaurant.free_delivery_from_kopecks
    )
    terms.minutes = zone.delivery_minutes if zone else None

    if terms.free_from_kopecks is None or subtotal < terms.free_from_kopecks:
        terms.price_kopecks = (
            zone.delivery_price_kopecks if zone else restaurant.delivery_price_kopecks
        )

    if subtotal < terms.min_order_kopecks:
        short = (terms.min_order_kopecks - subtotal) // 100
        terms.blocker = f"До минимальной суммы доставки не хватает {short} ₽"

    return terms


async def create_order(
    session: AsyncSession,
    tenant: Tenant,
    guest: Guest,
    payload: OrderCreate,
) -> Order:
    restaurant = await session.scalar(
        select(Restaurant).where(
            Restaurant.id == payload.restaurant_id,
            Restaurant.tenant_id == tenant.id,
            Restaurant.is_active.is_(True),
        )
    )
    if restaurant is None:
        raise OrderError("Ресторан не найден")

    # Пауза — это ЧП: заказ не принимаем и объясняем гостю причину, которую
    # менеджер написал в админке
    if restaurant.is_paused:
        reason = restaurant.pause_reason or "временно не принимает заказы"
        raise OrderError(f"{restaurant.name}: {reason}")

    if payload.type is OrderType.DELIVERY and not restaurant.has_delivery:
        raise OrderError("Этот ресторан не доставляет заказы")
    if payload.type is OrderType.PICKUP and not restaurant.has_pickup:
        raise OrderError("Из этого ресторана нельзя забрать самовывозом")
    if payload.type is OrderType.PICKUP:
        closed = pickup_hours(restaurant, tenant, payload.delivery_at)
        if closed is not None:
            raise OrderError(closed)
    if payload.type is OrderType.DELIVERY and not payload.address_text:
        raise OrderError("Укажите адрес доставки")

    if _is_online(payload.payment_method) and not tenant.features.online_payment:
        raise OrderError("Онлайн-оплата пока недоступна. Выберите оплату при получении")

    requested = {item.dish_id: item.quantity for item in payload.items}
    if len(requested) != len(payload.items):
        raise OrderError("Блюдо в заказе повторяется")

    dishes = (
        await session.scalars(
            select(Dish).where(
                Dish.tenant_id == tenant.id,
                Dish.id.in_(requested.keys()),
                Dish.is_active.is_(True),
            )
        )
    ).all()
    if len(dishes) != len(requested):
        raise OrderError("Одно из блюд больше не продаётся. Обновите меню")

    now = datetime.now(UTC)
    stopped = set(
        (
            await session.scalars(
                select(StopListEntry.dish_id).where(
                    StopListEntry.tenant_id == tenant.id,
                    StopListEntry.restaurant_id == restaurant.id,
                    StopListEntry.dish_id.in_(requested.keys()),
                    or_(StopListEntry.until.is_(None), StopListEntry.until > now),
                )
            )
        ).all()
    )
    if stopped:
        names = ", ".join(dish.name for dish in dishes if dish.id in stopped)
        raise OrderError(f"Сейчас нет в наличии: {names}")

    # Блюдо, которое этот ресторан не готовит вовсе, тоже не должно проходить
    not_sold = set(
        (
            await session.scalars(
                select(DishPrice.dish_id).where(
                    DishPrice.tenant_id == tenant.id,
                    DishPrice.restaurant_id == restaurant.id,
                    DishPrice.dish_id.in_(requested.keys()),
                    DishPrice.is_available.is_(False),
                )
            )
        ).all()
    )
    if not_sold:
        names = ", ".join(dish.name for dish in dishes if dish.id in not_sold)
        raise OrderError(f"В этом ресторане не готовят: {names}")

    overrides = {
        row.dish_id: row.price_kopecks
        for row in await session.execute(
            select(DishPrice.dish_id, DishPrice.price_kopecks).where(
                DishPrice.tenant_id == tenant.id,
                DishPrice.restaurant_id == restaurant.id,
                DishPrice.dish_id.in_(requested.keys()),
            )
        )
    }

    # Добавки тоже берём из справочника: цену в запросе клиент мог подменить
    chosen = {item.dish_id: item.extra_ids for item in payload.items}
    extras_by_id = {
        extra.id: extra
        for extra in await session.scalars(
            select(DishExtra).where(
                DishExtra.tenant_id == tenant.id,
                DishExtra.id.in_({eid for ids in chosen.values() for eid in ids} or {UUID(int=0)}),
                DishExtra.is_active.is_(True),
            )
        )
    }

    # Цены берём из базы, а не из тела запроса: клиенту тут доверять нельзя
    items: list[OrderItem] = []
    subtotal = 0
    for dish in dishes:
        quantity = requested[dish.id]
        picked = [extras_by_id[eid] for eid in chosen.get(dish.id, []) if eid in extras_by_id]
        unit_price = overrides.get(dish.id, dish.price_kopecks) + sum(
            extra.price_kopecks for extra in picked
        )
        line_total = unit_price * quantity
        subtotal += line_total
        items.append(
            OrderItem(
                tenant_id=tenant.id,
                dish_id=dish.id,
                name=dish.name,
                image_url=dish.image_url,
                extras=[
                    {"name": extra.name, "price_kopecks": extra.price_kopecks} for extra in picked
                ],
                unit_price_kopecks=unit_price,
                quantity=quantity,
                total_kopecks=line_total,
            )
        )

    delivery_price = 0
    if payload.type is OrderType.DELIVERY:
        terms = await delivery_terms(
            session,
            tenant,
            restaurant,
            subtotal,
            payload.address_latitude,
            payload.address_longitude,
            payload.delivery_at,
        )
        if terms.blocker is not None:
            raise OrderError(terms.blocker)
        delivery_price = terms.price_kopecks

    # Время «ко времени»: раньше чем через полчаса и в закрытый ресторан не берём
    if payload.delivery_at is not None:
        local = payload.delivery_at.astimezone(ZoneInfo(tenant.timezone))
        now_local = datetime.now(UTC).astimezone(ZoneInfo(tenant.timezone))
        if payload.delivery_at < datetime.now(UTC) + timedelta(minutes=25):
            raise OrderError("Выберите время хотя бы на полчаса вперёд")
        # Для доставки смотрим часы службы доставки, для самовывоза — зала
        opens = restaurant.opens_at
        closes = restaurant.closes_at
        if payload.type is OrderType.DELIVERY:
            opens = restaurant.delivery_opens_at or opens
            closes = restaurant.delivery_closes_at or closes

        if not (opens <= local.time() <= closes):
            raise OrderError(
                f"К этому времени не успеем: работаем с {opens:%H:%M} до {closes:%H:%M}"
            )
        if local.date() > now_local.date() + timedelta(days=1):
            raise OrderError("Заказ принимаем максимум на завтра")

    # Промокод считаем до баллов: сначала он уменьшает чек, баллы гасят остаток
    promo = None
    promo_discount = 0
    if payload.promo_code:
        promo = await promo_service.apply(
            session, tenant.id, guest.id, payload.promo_code, subtotal, delivery_price
        )
        if promo.error is not None:
            raise OrderError(promo.error)
        if promo.free_delivery:
            delivery_price = 0
        else:
            promo_discount = promo.discount_kopecks

    account = await loyalty_service.get_account(session, tenant, guest.id)
    if account is None:
        account = await loyalty_service.open_account(session, tenant, guest.id)
        await session.flush()

    cutlery = (payload.persons_count or 0) * tenant.ordering.cutlery_price_kopecks

    payable = max(0, subtotal - promo_discount)
    points_spent = min(
        payload.points_to_spend,
        max_points_to_spend(tenant, account.points_balance, payable, delivery_price),
    )
    discount = int(points_spent * tenant.loyalty.point_to_ruble_rate * 100)
    total = subtotal + delivery_price + cutlery - promo_discount - discount

    tier = loyalty_service.tier_by_code(tenant, account.tier_code)
    points_earned = (payable - discount) // 100 * tier.cashback_percent // 100

    order = Order(
        tenant_id=tenant.id,
        number=await _reserve_number(session, tenant.id),
        guest_id=guest.id,
        restaurant_id=restaurant.id,
        type=payload.type,
        status=OrderStatus.CREATED,
        contact_name=guest.name,
        contact_phone=guest.phone,
        address_text=payload.address_text,
        address_latitude=payload.address_latitude,
        address_longitude=payload.address_longitude,
        delivery_at=payload.delivery_at,
        persons_count=payload.persons_count,
        comment=payload.comment,
        subtotal_kopecks=subtotal,
        delivery_kopecks=delivery_price,
        cutlery_kopecks=cutlery,
        promo_code=promo.code if promo else None,
        promo_discount_kopecks=promo_discount,
        change_from_kopecks=payload.change_from_kopecks,
        discount_kopecks=discount,
        points_spent=points_spent,
        points_earned=points_earned,
        total_kopecks=total,
        payment_method=payload.payment_method,
        payment_status=(
            PaymentStatus.PENDING
            if _is_online(payload.payment_method)
            else PaymentStatus.NOT_REQUIRED
        ),
        items=items,
    )
    session.add(order)
    await session.flush()

    session.add_all(_apply_loyalty(tenant, account, order))
    if promo is not None:
        await promo_service.mark_used(session, tenant.id, promo.code)
    await session.commit()
    await session.refresh(order)

    return order


async def get_order(session: AsyncSession, tenant: Tenant, guest: Guest, order_id: UUID) -> Order:
    order: Order | None = await session.scalar(
        select(Order).where(
            Order.id == order_id,
            Order.tenant_id == tenant.id,
            Order.guest_id == guest.id,
        )
    )
    if order is None:
        raise OrderError("Заказ не найден")
    return order


async def list_orders(
    session: AsyncSession, tenant: Tenant, guest: Guest, limit: int = 20
) -> list[Order]:
    orders = await session.scalars(
        select(Order)
        .where(Order.tenant_id == tenant.id, Order.guest_id == guest.id)
        .order_by(Order.created_at.desc())
        .limit(limit)
    )
    return list(orders.all())


async def _extras_price(
    session: AsyncSession, tenant_id: str, items: Sequence[OrderItemCreate]
) -> dict[UUID, int]:
    """Сколько добавок набрали к каждому блюду — в копейках на одну порцию."""
    wanted = {extra_id for item in items for extra_id in item.extra_ids}
    if not wanted:
        return {}

    prices = {
        row.id: row.price_kopecks
        for row in await session.execute(
            select(DishExtra.id, DishExtra.price_kopecks).where(
                DishExtra.tenant_id == tenant_id,
                DishExtra.id.in_(wanted),
                DishExtra.is_active.is_(True),
            )
        )
    }

    return {
        item.dish_id: sum(prices.get(extra_id, 0) for extra_id in item.extra_ids)
        for item in items
    }


def pickup_hours(restaurant: Restaurant, tenant: Tenant, when: datetime | None) -> str | None:
    """Часы зала для самовывоза.

    Пока ресторан закрыт, заказ принимаем только если у него включён
    предзаказ — иначе гостю некуда прийти.
    """
    now = datetime.now(UTC).astimezone(ZoneInfo(tenant.timezone))
    hours = f"Ресторан работает с {restaurant.opens_at:%H:%M} до {restaurant.closes_at:%H:%M}."

    open_now = restaurant.opens_at <= now.time() <= restaurant.closes_at
    if not open_now and not restaurant.preorder_enabled:
        return f"{hours} Сейчас заказ не примем"

    if when is not None:
        moment = when.astimezone(ZoneInfo(tenant.timezone))
        if not (restaurant.opens_at <= moment.time() <= restaurant.closes_at):
            return f"{hours} Выберите время в этом окне"

    return None


async def checkout_preview(
    session: AsyncSession, tenant: Tenant, guest: Guest, payload: CheckoutPreviewRequest
) -> CheckoutPreview:
    """Считает заказ, ничего не создавая: те же правила, что и при оформлении."""
    restaurant = await session.scalar(
        select(Restaurant).where(
            Restaurant.id == payload.restaurant_id,
            Restaurant.tenant_id == tenant.id,
            Restaurant.is_active.is_(True),
        )
    )
    if restaurant is None:
        raise OrderError("Ресторан не найден")

    requested = {item.dish_id: item.quantity for item in payload.items}
    subtotal = 0
    unavailable: list[UnavailableItem] = []

    if requested:
        overrides = {
            row.dish_id: row.price_kopecks
            for row in await session.execute(
                select(DishPrice.dish_id, DishPrice.price_kopecks).where(
                    DishPrice.tenant_id == tenant.id,
                    DishPrice.restaurant_id == restaurant.id,
                    DishPrice.dish_id.in_(requested.keys()),
                )
            )
        }
        # Что сегодня в стоп-листе и что этот ресторан не готовит вовсе
        now = datetime.now(UTC)
        stopped = set(
            (
                await session.scalars(
                    select(StopListEntry.dish_id).where(
                        StopListEntry.tenant_id == tenant.id,
                        StopListEntry.restaurant_id == restaurant.id,
                        StopListEntry.dish_id.in_(requested.keys()),
                        or_(StopListEntry.until.is_(None), StopListEntry.until > now),
                    )
                )
            ).all()
        )
        not_sold = set(
            (
                await session.scalars(
                    select(DishPrice.dish_id).where(
                        DishPrice.tenant_id == tenant.id,
                        DishPrice.restaurant_id == restaurant.id,
                        DishPrice.dish_id.in_(requested.keys()),
                        DishPrice.is_available.is_(False),
                    )
                )
            ).all()
        )

        dishes = await session.scalars(
            select(Dish).where(Dish.tenant_id == tenant.id, Dish.id.in_(requested.keys()))
        )
        extras_price = await _extras_price(session, tenant.id, payload.items)

        for dish in dishes:
            if not dish.is_active:
                unavailable.append(
                    UnavailableItem(dish_id=dish.id, name=dish.name, reason="Пока не готовим")
                )
                continue
            if dish.id in not_sold:
                unavailable.append(
                    UnavailableItem(
                        dish_id=dish.id, name=dish.name, reason="Нет в этом ресторане"
                    )
                )
                continue
            if dish.id in stopped:
                unavailable.append(
                    UnavailableItem(dish_id=dish.id, name=dish.name, reason="Закончилось сегодня")
                )
                continue

            unit = overrides.get(dish.id, dish.price_kopecks) + extras_price.get(dish.id, 0)
            subtotal += unit * requested[dish.id]

    blocker: str | None = None
    delivery_price = 0
    terms = DeliveryTerms()

    if unavailable:
        names = ", ".join(item.name for item in unavailable)
        blocker = f"Сейчас нельзя заказать: {names}"
    elif restaurant.is_paused:
        blocker = f"{restaurant.name}: {restaurant.pause_reason or 'временно не принимает заказы'}"
    elif payload.type is OrderType.PICKUP:
        blocker = pickup_hours(restaurant, tenant, payload.delivery_at)
    elif payload.type is OrderType.DELIVERY:
        terms = await delivery_terms(
            session,
            tenant,
            restaurant,
            subtotal,
            payload.address_latitude,
            payload.address_longitude,
            payload.delivery_at,
        )
        delivery_price = terms.price_kopecks
        blocker = terms.blocker

    cutlery = payload.persons_count * tenant.ordering.cutlery_price_kopecks

    promo = None
    if payload.promo_code:
        promo = await promo_service.apply(
            session, tenant.id, guest.id, payload.promo_code, subtotal, delivery_price
        )
    promo_discount = promo.discount_kopecks if promo and promo.error is None else 0
    if promo is not None and promo.free_delivery and promo.error is None:
        delivery_price = 0

    account = await loyalty_service.get_account(session, tenant, guest.id)
    balance = account.points_balance if account is not None else 0
    tier = loyalty_service.tier_by_code(tenant, account.tier_code if account is not None else "")

    payable = max(0, subtotal - (0 if promo and promo.free_delivery else promo_discount))
    cap = max_points_to_spend(tenant, balance, payable, delivery_price)
    points_spent = min(payload.points_to_spend, cap)
    discount = int(points_spent * tenant.loyalty.point_to_ruble_rate * 100)
    total = subtotal + delivery_price + cutlery - discount
    if promo is not None and promo.error is None and not promo.free_delivery:
        total -= promo_discount

    return CheckoutPreview(
        restaurant_id=restaurant.id,
        restaurant_name=restaurant.name,
        type=payload.type,
        subtotal_kopecks=subtotal,
        delivery_kopecks=delivery_price,
        cutlery_kopecks=cutlery,
        cutlery_price_kopecks=tenant.ordering.cutlery_price_kopecks,
        promo_discount_kopecks=promo_discount if promo and not promo.free_delivery else 0,
        discount_kopecks=discount,
        total_kopecks=max(0, total),
        promo_code=promo.code if promo and promo.error is None else None,
        promo_title=promo.title if promo and promo.error is None else None,
        promo_error=promo.error if promo else None,
        min_order_kopecks=terms.min_order_kopecks,
        short_of_min_kopecks=max(0, terms.min_order_kopecks - subtotal),
        free_delivery_from_kopecks=terms.free_from_kopecks,
        to_free_delivery_kopecks=(
            max(0, terms.free_from_kopecks - subtotal)
            if terms.free_from_kopecks is not None
            else None
        ),
        delivery_minutes=terms.minutes,
        # Для самовывоза это часы зала: приложение показывает их так же
        delivery_opens_at=(
            terms.opens_at if payload.type is OrderType.DELIVERY else restaurant.opens_at
        ),
        delivery_closes_at=(
            terms.closes_at if payload.type is OrderType.DELIVERY else restaurant.closes_at
        ),
        delivery_open_now=(
            terms.open_now
            if payload.type is OrderType.DELIVERY
            else restaurant.opens_at
            <= datetime.now(UTC).astimezone(ZoneInfo(tenant.timezone)).time()
            <= restaurant.closes_at
        ),
        preorder_enabled=restaurant.preorder_enabled,
        points_balance=balance,
        max_points_to_spend=cap,
        points_to_spend=points_spent,
        points_earned=(payable - discount) // 100 * tier.cashback_percent // 100,
        points_cover_delivery=tenant.loyalty.points_cover_delivery,
        cashback_percent=tier.cashback_percent,
        unavailable=unavailable,
        blocker=blocker,
    )


async def checkout_limits(
    session: AsyncSession, tenant: Tenant, guest: Guest, subtotal_kopecks: int
) -> CheckoutLimits:
    account = await loyalty_service.get_account(session, tenant, guest.id)
    balance = account.points_balance if account is not None else 0
    tier = loyalty_service.tier_by_code(tenant, account.tier_code if account is not None else "")
    return CheckoutLimits(
        points_balance=balance,
        max_points_to_spend=max_points_to_spend(tenant, balance, subtotal_kopecks),
        cashback_percent=tier.cashback_percent,
    )


def to_read(order: Order, feedback_left: bool = False) -> OrderRead:
    return OrderRead(
        id=order.id,
        number=order.number,
        status=order.status,
        feedback_left=feedback_left,
        type=order.type,
        restaurant_id=order.restaurant_id,
        restaurant_name=order.restaurant.name,
        restaurant_phone=order.restaurant.phone,
        restaurant_address=order.restaurant.address,
        created_at=order.created_at,
        delivery_at=order.delivery_at,
        address_text=order.address_text,
        comment=order.comment,
        subtotal_kopecks=order.subtotal_kopecks,
        delivery_kopecks=order.delivery_kopecks,
        cutlery_kopecks=order.cutlery_kopecks,
        promo_code=order.promo_code,
        promo_discount_kopecks=order.promo_discount_kopecks,
        change_from_kopecks=order.change_from_kopecks,
        persons_count=order.persons_count,
        discount_kopecks=order.discount_kopecks,
        total_kopecks=order.total_kopecks,
        points_spent=order.points_spent,
        points_earned=order.points_earned,
        payment_method=order.payment_method,
        payment_status=order.payment_status,
        items=[
            OrderItemRead(
                id=item.id,
                dish_id=item.dish_id,
                name=item.name,
                extras=[
                    OrderItemExtraRead(
                        name=str(extra["name"]), price_kopecks=int(str(extra["price_kopecks"]))
                    )
                    for extra in item.extras
                ],
                image_url=item.image_url,
                unit_price_kopecks=item.unit_price_kopecks,
                quantity=item.quantity,
                total_kopecks=item.total_kopecks,
            )
            for item in order.items
        ],
    )
