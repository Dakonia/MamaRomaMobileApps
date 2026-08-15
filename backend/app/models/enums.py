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


class StaffRole(StrEnum):
    OWNER = "owner"
    MANAGER = "manager"


class DevicePlatform(StrEnum):
    IOS = "ios"
    ANDROID = "android"


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
