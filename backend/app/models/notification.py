"""Уведомления: правила отправки, рассылки и сценарии.

Тексты и события не зашиты в приложение — ими управляют из админки. Один
ресторан может писать гостю на четырёх шагах, другой на двух, у третьего свои
тихие часы: сеть большая, и порядки в точках разные.
"""

from datetime import datetime, time
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, Text, Time, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TenantMixin, TimestampMixin, UUIDMixin
from app.models.enums import CampaignStatus, NotificationKind, TriggerKind, enum_column


class NotificationRule(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Писать ли гостю на этом шаге заказа и какими словами.

    Ресторан не задан — правило общее для сети. Задан — перекрывает общее.
    """

    __tablename__ = "notification_rules"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "restaurant_id", "event", name="uq_notification_rules_scope"
        ),
    )

    restaurant_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("restaurants.id", ondelete="CASCADE"), index=True, default=None
    )

    # Событие заказа: created, accepted, cooking, ready, delivering, completed…
    event: Mapped[str] = mapped_column(String(40))
    is_enabled: Mapped[bool] = mapped_column(default=True)

    # В тексте доступны {number}, {restaurant}, {time}, {name}
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(String(240))


class NotificationHours(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Тихие часы: когда рекламные сообщения ждут утра.

    Заказы приходят всегда — человек их ждёт. Ограничение только для рассылок.
    """

    __tablename__ = "notification_hours"
    __table_args__ = (
        UniqueConstraint("tenant_id", "restaurant_id", name="uq_notification_hours_scope"),
    )

    restaurant_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("restaurants.id", ondelete="CASCADE"), index=True, default=None
    )

    quiet_from: Mapped[time] = mapped_column(Time, default=time(22, 0))
    quiet_to: Mapped[time] = mapped_column(Time, default=time(10, 0))
    # Сколько рекламных сообщений в неделю максимум: защита от выгорания базы
    weekly_limit: Mapped[int] = mapped_column(default=2)


class Campaign(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Рассылка: текст, картинка, кому и куда ведёт нажатие."""

    __tablename__ = "campaigns"

    name: Mapped[str] = mapped_column(String(160))
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(String(240))
    image_url: Mapped[str | None] = mapped_column(String(500), default=None)

    kind: Mapped[NotificationKind] = mapped_column(
        enum_column(NotificationKind), default=NotificationKind.MARKETING
    )
    status: Mapped[CampaignStatus] = mapped_column(
        enum_column(CampaignStatus), default=CampaignStatus.DRAFT
    )

    # Куда открыть приложение: {"screen": "promo", "id": "..."} или menu, dish, cart
    target: Mapped[dict[str, str]] = mapped_column(JSONB, default=dict)

    # Кому: {"cities": [...], "restaurants": [...], "ordered_within_days": 30,
    # "booked": true, "tiers": ["amico"], "min_orders": 1}
    audience: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict)

    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    planned_count: Mapped[int] = mapped_column(default=0)
    sent_count: Mapped[int] = mapped_column(default=0)
    opened_count: Mapped[int] = mapped_column(default=0)
    error: Mapped[str | None] = mapped_column(Text, default=None)


class CampaignDelivery(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Кому ушла рассылка. Нужен, чтобы не слать дважды и считать открытия."""

    __tablename__ = "campaign_deliveries"
    __table_args__ = (
        UniqueConstraint("campaign_id", "guest_id", name="uq_campaign_deliveries_guest"),
    )

    campaign_id: Mapped[UUID] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    guest_id: Mapped[UUID] = mapped_column(ForeignKey("guests.id", ondelete="CASCADE"), index=True)

    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class Automation(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Сценарий: повод написать гостю, который наступает сам.

    День рождения, забытая корзина, сгорающие баллы, давно не заходил.
    Условие задаётся числом дней или процентом — остальное считает сервис.
    """

    __tablename__ = "automations"
    __table_args__ = (UniqueConstraint("tenant_id", "trigger", name="uq_automations_trigger"),)

    trigger: Mapped[TriggerKind] = mapped_column(enum_column(TriggerKind))
    is_enabled: Mapped[bool] = mapped_column(default=False)

    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(String(240))
    target: Mapped[dict[str, str]] = mapped_column(JSONB, default=dict)

    # Настройка сценария: {"days": 30} для «давно не заказывал»,
    # {"days_before": 3} для дня рождения, {"hours": 2} для забытой корзины
    params: Mapped[dict[str, int]] = mapped_column(JSONB, default=dict)

    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    sent_count: Mapped[int] = mapped_column(default=0)


class AutomationDelivery(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Кому и когда сработал сценарий: чтобы не писать одно и то же дважды."""

    __tablename__ = "automation_deliveries"

    automation_id: Mapped[UUID] = mapped_column(
        ForeignKey("automations.id", ondelete="CASCADE"), index=True
    )
    guest_id: Mapped[UUID] = mapped_column(ForeignKey("guests.id", ondelete="CASCADE"), index=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class CartSnapshot(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """След корзины гостя: сколько блюд и на какую сумму лежит прямо сейчас.

    Состав не храним — для напоминания хватает суммы, а лишние данные о вкусах
    гостя нам ни к чему. Запись живёт одна на гостя и переписывается.
    """

    __tablename__ = "cart_snapshots"
    __table_args__ = (UniqueConstraint("tenant_id", "guest_id", name="uq_cart_snapshots_guest"),)

    guest_id: Mapped[UUID] = mapped_column(ForeignKey("guests.id", ondelete="CASCADE"), index=True)

    positions: Mapped[int] = mapped_column(default=0)
    total_kopecks: Mapped[int] = mapped_column(default=0)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Когда напомнили в прошлый раз: чтобы не писать про одну корзину дважды
    reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
