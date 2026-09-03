from enum import StrEnum

from sqlalchemy import Enum as SAEnum


class OrderType(StrEnum):
    DELIVERY = "delivery"
    PICKUP = "pickup"


class OrderStatus(StrEnum):
    CREATED = "created"
    PAID = "paid"
    ACCEPTED = "accepted"
    COOKING = "cooking"
    READY = "ready"
    DELIVERING = "delivering"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class PaymentMethod(StrEnum):
    ONLINE_CARD = "online_card"
    ONLINE_SBP = "online_sbp"
    CASH_ON_DELIVERY = "cash_on_delivery"
    CARD_ON_DELIVERY = "card_on_delivery"


class PromoCodeKind(StrEnum):
    PERCENT = "percent"
    FIXED = "fixed"
    FREE_DELIVERY = "free_delivery"


class PaymentStatus(StrEnum):
    NOT_REQUIRED = "not_required"
    PENDING = "pending"
    SUCCEEDED = "succeeded"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"


class ReservationStatus(StrEnum):
    REQUESTED = "requested"
    CONFIRMED = "confirmed"
    SEATED = "seated"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"


class LoyaltyOperation(StrEnum):
    WELCOME = "welcome"
    EARN = "earn"
    SPEND = "spend"
    REFUND = "refund"
    BIRTHDAY = "birthday"
    EXPIRE = "expire"
    MANUAL = "manual"


class Gender(StrEnum):
    MALE = "male"
    FEMALE = "female"


class StaffRole(StrEnum):
    """Роль задаёт набор прав по умолчанию, сам набор — в app/core/permissions.py."""

    OWNER = "owner"
    NETWORK_MANAGER = "network_manager"
    DELIVERY_OPERATOR = "delivery_operator"
    MARKETING = "marketing"
    # Заведены заранее: набор прав есть, входа в веб-админку пока нет
    COURIER = "courier"
    RESTAURANT = "restaurant"


class IikoHandoffStatus(StrEnum):
    """Состояние передачи заказа на кассу ресторана."""

    PENDING = "pending"
    SENT = "sent"
    ACCEPTED = "accepted"
    FAILED = "failed"
    SKIPPED = "skipped"


class DevicePlatform(StrEnum):
    IOS = "ios"
    ANDROID = "android"


class NotificationKind(StrEnum):
    """Заказы приходят всегда, рекламные — по согласию и в рабочие часы."""

    ORDER = "order"
    MARKETING = "marketing"


class CampaignStatus(StrEnum):
    DRAFT = "draft"
    SCHEDULED = "scheduled"
    SENDING = "sending"
    SENT = "sent"
    CANCELLED = "cancelled"


class TriggerKind(StrEnum):
    """Поводы написать, которые наступают сами."""

    BIRTHDAY = "birthday"
    INACTIVE = "inactive"
    ABANDONED_CART = "abandoned_cart"
    POINTS_EXPIRING = "points_expiring"


def enum_column(enum_cls: type[StrEnum]) -> SAEnum:
    """Перечисление хранится строкой с CHECK, а не нативным типом Postgres.

    Добавить новый статус тогда стоит одну строчку в CHECK вместо ALTER TYPE,
    который в Postgres нельзя откатить внутри транзакции.
    """
    return SAEnum(
        enum_cls,
        native_enum=False,
        create_constraint=True,
        length=24,
        values_callable=lambda members: [member.value for member in members],
        validate_strings=True,
    )
