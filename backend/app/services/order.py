import secrets
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

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
from app.models.menu import Dish, DishPrice, StopListEntry
from app.models.order import Order, OrderItem
from app.schemas.order import CheckoutLimits, OrderCreate, OrderItemRead, OrderRead
from app.services import loyalty as loyalty_service

NUMBER_ATTEMPTS = 5


class OrderError(Exception):
    pass


def _is_online(method: PaymentMethod) -> bool:
    return method in (PaymentMethod.ONLINE_CARD, PaymentMethod.ONLINE_SBP)


def max_points_to_spend(tenant: Tenant, balance: int, subtotal_kopecks: int) -> int:
    """Потолок списания: доля чека из конфига тенанта, но не больше баланса."""
    rate = tenant.loyalty.point_to_ruble_rate
    if rate <= 0:
        return 0
    cap_by_check = int(subtotal_kopecks * tenant.loyalty.max_redeem_share_of_check / 100 / rate)
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

    if payload.type is OrderType.DELIVERY and not restaurant.has_delivery:
        raise OrderError("Этот ресторан не доставляет заказы")
    if payload.type is OrderType.PICKUP and not restaurant.has_pickup:
        raise OrderError("Из этого ресторана нельзя забрать самовывозом")
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

    # Цены берём из базы, а не из тела запроса: клиенту тут доверять нельзя
    items: list[OrderItem] = []
    subtotal = 0
    for dish in dishes:
        quantity = requested[dish.id]
        unit_price = overrides.get(dish.id, dish.price_kopecks)
        line_total = unit_price * quantity
        subtotal += line_total
        items.append(
            OrderItem(
                tenant_id=tenant.id,
                dish_id=dish.id,
                name=dish.name,
                unit_price_kopecks=unit_price,
                quantity=quantity,
                total_kopecks=line_total,
            )
        )

    delivery_price = 0
    if payload.type is OrderType.DELIVERY:
        if subtotal < restaurant.delivery_min_order_kopecks:
            short = (restaurant.delivery_min_order_kopecks - subtotal) // 100
            raise OrderError(f"До минимальной суммы доставки не хватает {short} ₽")
        free_from = restaurant.free_delivery_from_kopecks
        if free_from is None or subtotal < free_from:
            delivery_price = restaurant.delivery_price_kopecks

    account = await loyalty_service.get_account(session, tenant, guest.id)
    if account is None:
        account = await loyalty_service.open_account(session, tenant, guest.id)
        await session.flush()

    points_spent = min(
        payload.points_to_spend,
        max_points_to_spend(tenant, account.points_balance, subtotal),
    )
    discount = int(points_spent * tenant.loyalty.point_to_ruble_rate * 100)
    total = subtotal + delivery_price - discount

    tier = loyalty_service.tier_by_code(tenant, account.tier_code)
    points_earned = (subtotal - discount) // 100 * tier.cashback_percent // 100

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


def to_read(order: Order) -> OrderRead:
    return OrderRead(
        id=order.id,
        number=order.number,
        status=order.status,
        type=order.type,
        restaurant_id=order.restaurant_id,
        restaurant_name=order.restaurant.name,
        created_at=order.created_at,
        delivery_at=order.delivery_at,
        address_text=order.address_text,
        comment=order.comment,
        subtotal_kopecks=order.subtotal_kopecks,
        delivery_kopecks=order.delivery_kopecks,
        discount_kopecks=order.discount_kopecks,
        total_kopecks=order.total_kopecks,
        points_spent=order.points_spent,
        points_earned=order.points_earned,
        payment_method=order.payment_method,
        payment_status=order.payment_status,
        items=[OrderItemRead.model_validate(item) for item in order.items],
    )
