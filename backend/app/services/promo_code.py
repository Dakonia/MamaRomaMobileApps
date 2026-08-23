"""Промокоды: проверка и расчёт скидки.

Скидку считаем до баллов — сначала промокод уменьшает чек, и только потом
гость гасит остаток баллами. Иначе выгода складывается дважды и уходит в минус.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import PromoCodeKind
from app.models.order import Order
from app.models.promo_code import PromoCode


@dataclass(slots=True)
class PromoResult:
    code: str
    title: str = ""
    discount_kopecks: int = 0
    free_delivery: bool = False
    # Пусто — код принят
    error: str | None = None


def normalize(code: str) -> str:
    return code.strip().upper().replace(" ", "")


async def apply(
    session: AsyncSession,
    tenant_id: str,
    guest_id: UUID,
    code: str,
    subtotal_kopecks: int,
    delivery_kopecks: int,
) -> PromoResult:
    cleaned = normalize(code)
    if not cleaned:
        return PromoResult(code=cleaned, error="Введите промокод")

    promo = await session.scalar(
        select(PromoCode).where(PromoCode.tenant_id == tenant_id, PromoCode.code == cleaned)
    )
    if promo is None or not promo.is_active:
        return PromoResult(code=cleaned, error="Такого промокода нет")

    now = datetime.now(UTC)
    if promo.starts_at is not None and promo.starts_at > now:
        return PromoResult(code=cleaned, error="Промокод ещё не действует")
    if promo.ends_at is not None and promo.ends_at < now:
        return PromoResult(code=cleaned, error="Срок промокода истёк")

    if promo.usage_limit is not None and promo.used_count >= promo.usage_limit:
        return PromoResult(code=cleaned, error="Промокод уже разобрали")

    if subtotal_kopecks < promo.min_order_kopecks:
        short = (promo.min_order_kopecks - subtotal_kopecks) // 100
        return PromoResult(code=cleaned, error=f"Промокод работает от {short} ₽ больше")

    used_by_guest = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.tenant_id == tenant_id,
            Order.guest_id == guest_id,
            Order.promo_code == cleaned,
        )
    )
    if promo.per_guest_limit > 0 and (used_by_guest or 0) >= promo.per_guest_limit:
        return PromoResult(code=cleaned, error="Этим промокодом вы уже пользовались")

    if promo.kind is PromoCodeKind.FREE_DELIVERY:
        return PromoResult(
            code=cleaned,
            title=promo.title or "Бесплатная доставка",
            discount_kopecks=delivery_kopecks,
            free_delivery=True,
        )

    if promo.kind is PromoCodeKind.PERCENT:
        discount = subtotal_kopecks * promo.value // 100
    else:
        discount = promo.value

    if promo.max_discount_kopecks is not None:
        discount = min(discount, promo.max_discount_kopecks)

    return PromoResult(
        code=cleaned,
        title=promo.title or f"Скидка {promo.value}%"
        if promo.kind is PromoCodeKind.PERCENT
        else promo.title,
        discount_kopecks=min(discount, subtotal_kopecks),
    )


async def mark_used(session: AsyncSession, tenant_id: str, code: str) -> None:
    promo = await session.scalar(
        select(PromoCode).where(PromoCode.tenant_id == tenant_id, PromoCode.code == code)
    )
    if promo is not None:
        promo.used_count += 1
