from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import OrderStatus, OrderType, PaymentMethod, PaymentStatus


class OrderItemCreate(BaseModel):
    dish_id: UUID
    quantity: int = Field(ge=1, le=50)


class OrderCreate(BaseModel):
    restaurant_id: UUID
    type: OrderType
    items: list[OrderItemCreate] = Field(min_length=1, max_length=100)
    payment_method: PaymentMethod

    address_text: str | None = Field(default=None, max_length=400)
    address_latitude: float | None = None
    address_longitude: float | None = None
    delivery_at: datetime | None = None
    persons_count: int | None = Field(default=None, ge=1, le=20)
    comment: str | None = Field(default=None, max_length=500)

    # Сколько баллов гость хочет списать. Сервер всё равно ограничит своим потолком.
    points_to_spend: int = Field(default=0, ge=0)


class OrderItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    dish_id: UUID | None
    name: str
    unit_price_kopecks: int
    quantity: int
    total_kopecks: int


class OrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    number: str
    status: OrderStatus
    type: OrderType

    restaurant_id: UUID
    restaurant_name: str

    created_at: datetime
    delivery_at: datetime | None
    address_text: str | None
    comment: str | None

    subtotal_kopecks: int
    delivery_kopecks: int
    discount_kopecks: int
    total_kopecks: int
    points_spent: int
    points_earned: int

    payment_method: PaymentMethod
    payment_status: PaymentStatus

    items: list[OrderItemRead]


class CheckoutLimits(BaseModel):
    """Что гость может списать прямо сейчас — считаем на сервере, чтобы не спорить."""

    points_balance: int
    max_points_to_spend: int
    cashback_percent: int
