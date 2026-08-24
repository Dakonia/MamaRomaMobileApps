"""Рассылки и сценарии: кому написать и когда.

Аудитория собирается запросом по гостям — по городу, ресторану, давности
заказа, уровню лояльности. Отправка идёт через ту же службу, что и статусы
заказа, но по другому каналу: рекламу гость может отключить отдельно.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenants import Tenant
from app.models.enums import CampaignStatus, NotificationKind, OrderStatus, TriggerKind
from app.models.geo import Restaurant
from app.models.guest import Device, Guest
from app.models.loyalty import LoyaltyAccount
from app.models.notification import (
    Automation,
    AutomationDelivery,
    Campaign,
    CampaignDelivery,
)
from app.models.order import Order
from app.models.reservation import Reservation
from app.services import push as push_service


async def audience(session: AsyncSession, tenant: Tenant, filters: dict[str, Any]) -> list[Guest]:
    """Гости под условия рассылки. Пустые условия — вся база с уведомлениями."""
    query = (
        select(Guest)
        .join(Device, Device.guest_id == Guest.id)
        .where(
            Guest.tenant_id == tenant.id,
            Guest.deleted_at.is_(None),
            Guest.is_blocked.is_(False),
            # Реклама — только с согласия: статусы заказа это не затрагивает
            Guest.marketing_opt_in.is_(True),
            Device.is_active.is_(True),
        )
        .distinct()
    )

    cities = filters.get("cities") or []
    restaurants = filters.get("restaurants") or []
    days = filters.get("ordered_within_days")
    min_orders = filters.get("min_orders")
    tiers = filters.get("tiers") or []

    if days or restaurants or min_orders:
        orders = select(Order.guest_id).where(Order.tenant_id == tenant.id)

        if days:
            orders = orders.where(Order.created_at >= datetime.now(UTC) - timedelta(days=int(days)))
        if restaurants:
            orders = orders.where(Order.restaurant_id.in_([UUID(str(r)) for r in restaurants]))
        if min_orders:
            orders = orders.group_by(Order.guest_id).having(
                func.count(Order.id) >= int(min_orders)
            )

        query = query.where(Guest.id.in_(orders))

    if filters.get("booked"):
        bookings = select(Reservation.guest_id).where(Reservation.tenant_id == tenant.id)
        query = query.where(Guest.id.in_(bookings))

    if tiers:
        accounts = select(LoyaltyAccount.guest_id).where(
            LoyaltyAccount.tenant_id == tenant.id, LoyaltyAccount.tier_code.in_(tiers)
        )
        query = query.where(Guest.id.in_(accounts))

    if cities:
        # Своего города у гостя нет: берём по ресторанам, где он заказывал
        by_city = (
            select(Order.guest_id)
            .join(Restaurant, Restaurant.id == Order.restaurant_id)
            .where(
                Order.tenant_id == tenant.id,
                Restaurant.city_id.in_([UUID(str(city)) for city in cities]),
            )
        )
        query = query.where(Guest.id.in_(by_city))

    return list(await session.scalars(query))


async def preview_size(session: AsyncSession, tenant: Tenant, filters: dict[str, Any]) -> int:
    """Сколько гостей получит рассылку: менеджер видит это до отправки."""
    return len(await audience(session, tenant, filters))


async def reach_report(
    session: AsyncSession, tenant: Tenant, filters: dict[str, Any]
) -> dict[str, int]:
    """Разбор охвата: сколько получат и почему остальные — нет.

    Без этого цифра «1 гость» выглядит поломкой, хотя на деле у остальных
    просто выключены уведомления.
    """
    guests = await session.scalar(
        select(func.count())
        .select_from(Guest)
        .where(Guest.tenant_id == tenant.id, Guest.deleted_at.is_(None))
    )
    with_push = await session.scalar(
        select(func.count(func.distinct(Guest.id)))
        .select_from(Guest)
        .join(Device, Device.guest_id == Guest.id)
        .where(
            Guest.tenant_id == tenant.id,
            Guest.deleted_at.is_(None),
            Device.is_active.is_(True),
        )
    )
    agreed = await session.scalar(
        select(func.count(func.distinct(Guest.id)))
        .select_from(Guest)
        .join(Device, Device.guest_id == Guest.id)
        .where(
            Guest.tenant_id == tenant.id,
            Guest.deleted_at.is_(None),
            Guest.marketing_opt_in.is_(True),
            Device.is_active.is_(True),
        )
    )

    return {
        "count": len(await audience(session, tenant, filters)),
        "guests": guests or 0,
        "with_push": with_push or 0,
        "agreed": agreed or 0,
    }


async def send_campaign(
    session: AsyncSession, tenant: Tenant, campaign: Campaign, force: bool = False
) -> int:
    """Отправляет рассылку по её условиям. Повторно одному гостю не пишем.

    Ночью по своей воле не будим — но менеджер может настоять: он отправляет
    вручную и знает, что делает.
    """
    zone = ZoneInfo(tenant.timezone)

    if (
        not force
        and campaign.kind is NotificationKind.MARKETING
        and await push_service.quiet_now(session, tenant.id, zone)
    ):
        campaign.error = "Сейчас тихие часы — рассылка уйдёт, когда они закончатся"
        await session.commit()
        return 0

    campaign.error = None

    campaign.status = CampaignStatus.SENDING
    campaign.started_at = campaign.started_at or datetime.now(UTC)
    await session.commit()

    guests = await audience(session, tenant, campaign.audience)
    already = set(
        await session.scalars(
            select(CampaignDelivery.guest_id).where(CampaignDelivery.campaign_id == campaign.id)
        )
    )

    sent = 0
    for guest in guests:
        if guest.id in already:
            continue

        tokens = await push_service.tokens_for_guest(session, tenant.id, guest.id)
        if not tokens:
            continue

        delivered = await push_service.send(
            session,
            tenant.id,
            tokens,
            title=campaign.title,
            body=campaign.body,
            data={**campaign.target, "campaignId": str(campaign.id)},
            kind=campaign.kind,
            image=push_service.public_url(campaign.image_url),
        )

        session.add(
            CampaignDelivery(
                tenant_id=tenant.id,
                campaign_id=campaign.id,
                guest_id=guest.id,
                sent_at=datetime.now(UTC),
            )
        )
        sent += delivered

    campaign.sent_count += sent
    campaign.planned_count = len(guests)
    campaign.status = CampaignStatus.SENT
    campaign.finished_at = datetime.now(UTC)
    await session.commit()

    return sent


async def _birthday_guests(session: AsyncSession, tenant: Tenant, days_before: int) -> list[Guest]:
    """У кого день рождения через столько-то дней."""
    target = date.today() + timedelta(days=days_before)

    return list(
        await session.scalars(
            select(Guest).where(
                Guest.tenant_id == tenant.id,
                Guest.deleted_at.is_(None),
                Guest.birthday.is_not(None),
                func.extract("month", Guest.birthday) == target.month,
                func.extract("day", Guest.birthday) == target.day,
            )
        )
    )


async def _inactive_guests(session: AsyncSession, tenant: Tenant, days: int) -> list[Guest]:
    """Кто заказывал раньше, но за столько-то дней не появлялся."""
    edge = datetime.now(UTC) - timedelta(days=days)

    recent = select(Order.guest_id).where(Order.tenant_id == tenant.id, Order.created_at >= edge)
    ever = select(Order.guest_id).where(
        Order.tenant_id == tenant.id, Order.status == OrderStatus.COMPLETED
    )

    return list(
        await session.scalars(
            select(Guest).where(
                Guest.tenant_id == tenant.id,
                Guest.deleted_at.is_(None),
                Guest.id.in_(ever),
                Guest.id.not_in(recent),
            )
        )
    )


async def run_automation(session: AsyncSession, tenant: Tenant, rule: Automation) -> int:
    """Один прогон сценария: кому подошло — тем пишем, но не чаще раза в месяц."""
    if not rule.is_enabled:
        return 0

    zone = ZoneInfo(tenant.timezone)
    if await push_service.quiet_now(session, tenant.id, zone):
        return 0

    params = rule.params or {}

    if rule.trigger is TriggerKind.BIRTHDAY:
        guests = await _birthday_guests(session, tenant, int(params.get("days_before", 0)))
    elif rule.trigger is TriggerKind.INACTIVE:
        guests = await _inactive_guests(session, tenant, int(params.get("days", 30)))
    else:
        # Забытая корзина и сгорающие баллы придут следующим шагом
        guests = []

    # Одному гостю по одному сценарию — не чаще чем раз в тридцать дней
    edge = datetime.now(UTC) - timedelta(days=30)
    recent = set(
        await session.scalars(
            select(AutomationDelivery.guest_id).where(
                AutomationDelivery.automation_id == rule.id, AutomationDelivery.sent_at >= edge
            )
        )
    )

    sent = 0
    for guest in guests:
        if guest.id in recent:
            continue

        tokens = await push_service.tokens_for_guest(session, tenant.id, guest.id)
        if not tokens:
            continue

        title = rule.title.replace("{name}", guest.name or "")
        body = rule.body.replace("{name}", guest.name or "")

        delivered = await push_service.send(
            session,
            tenant.id,
            tokens,
            title=title,
            body=body,
            data=dict(rule.target or {}),
            kind=NotificationKind.MARKETING,
        )

        session.add(
            AutomationDelivery(
                tenant_id=tenant.id,
                automation_id=rule.id,
                guest_id=guest.id,
                sent_at=datetime.now(UTC),
            )
        )
        sent += delivered

    rule.last_run_at = datetime.now(UTC)
    rule.sent_count += sent
    await session.commit()

    return sent
