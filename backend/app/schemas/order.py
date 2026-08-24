from datetime import datetime, time
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import OrderStatus, OrderType, PaymentMethod, PaymentStatus


class OrderItemCreate(BaseModel):
    dish_id: UUID
    quantity: int = Field(ge=1, le=50)
    # Добавки к этой позиции: цену считает сервер по своему справочнику
    extra_ids: list[UUID] = Field(default_factory=list, max_length=20)


class OrderCreate(BaseModel):
    restaurant_id: UUID
    type: OrderType
    items: list[OrderItemCreate] = Field(min_length=1, max_length=100)
    payment_method: PaymentMethod

    address_text: str | None = Field(default=None, max_length=400)
    address_latitude: float | None = None
    address_longitude: float | None = None
    delivery_at: datetime | None = None
    # Ноль — приборы не нужны, гость снял их в корзине
    persons_count: int | None = Field(default=None, ge=0, le=20)
    comment: str | None = Field(default=None, max_length=500)

    # Сколько баллов гость хочет списать. Сервер всё равно ограничит своим потолком.
    points_to_spend: int = Field(default=0, ge=0)
    promo_code: str | None = Field(default=None, max_length=32)
    # Сдача с какой суммы нужна курьеру, только для наличных
    change_from_kopecks: int | None = Field(default=None, ge=0)


class OrderItemExtraRead(BaseModel):
    name: str
    price_kopecks: int


class OrderItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    dish_id: UUID | None
    name: str
    extras: list[OrderItemExtraRead] = []
    image_url: str | None = None
    unit_price_kopecks: int
    quantity: int
    total_kopecks: int


class OrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    number: str
    status: OrderStatus
    # Заказ уже оценён: спрашивать второй раз невежливо
    feedback_left: bool = False
    type: OrderType

    restaurant_id: UUID
    restaurant_name: str
    # Телефон именно того ресторана, который готовит: звонить в сеть бесполезно
    restaurant_phone: str | None = None
    restaurant_address: str | None = None

    created_at: datetime
    delivery_at: datetime | None
    address_text: str | None
    comment: str | None

    subtotal_kopecks: int
    delivery_kopecks: int
    cutlery_kopecks: int = 0
    promo_code: str | None = None
    promo_discount_kopecks: int = 0
    discount_kopecks: int
    total_kopecks: int
    points_spent: int
    points_earned: int
    change_from_kopecks: int | None = None
    persons_count: int | None = None

    payment_method: PaymentMethod
    payment_status: PaymentStatus

    items: list[OrderItemRead]


class UnavailableItem(BaseModel):
    dish_id: UUID
    name: str
    reason: str


class CheckoutPreview(BaseModel):
    """Полный счёт до оформления: корзина показывает то же, что посчитает заказ."""

    restaurant_id: UUID
    restaurant_name: str
    # Телефон именно того ресторана, который готовит: звонить в сеть бесполезно
    restaurant_phone: str | None = None
    restaurant_address: str | None = None
    type: OrderType

    subtotal_kopecks: int
    delivery_kopecks: int
    cutlery_kopecks: int = 0
    cutlery_price_kopecks: int = 0
    promo_discount_kopecks: int = 0
    discount_kopecks: int
    total_kopecks: int

    # Промокод: принят или нет и почему
    promo_code: str | None = None
    promo_title: str | None = None
    promo_error: str | None = None

    # Условия доставки этой зоны
    min_order_kopecks: int = 0
    short_of_min_kopecks: int = 0
    free_delivery_from_kopecks: int | None = None
    to_free_delivery_kopecks: int | None = None
    delivery_minutes: int | None = None
    # Часы работы доставки: приложение предлагает время только внутри окна
    delivery_opens_at: time | None = None
    delivery_closes_at: time | None = None
    delivery_open_now: bool = True
    # Принимает ли ресторан заказы, пока закрыт
    preorder_enabled: bool = False

    points_balance: int = 0
    max_points_to_spend: int = 0
    points_to_spend: int = 0
    points_earned: int = 0
    points_cover_delivery: bool = True
    cashback_percent: int = 0

    # Блюда, которые прямо сейчас нельзя заказать в этом ресторане
    unavailable: list[UnavailableItem] = []

    # Пусто — заказ можно оформлять
    blocker: str | None = None


class CheckoutPreviewRequest(BaseModel):
    restaurant_id: UUID
    type: OrderType
    items: list[OrderItemCreate] = Field(default_factory=list, max_length=100)
    address_latitude: float | None = None
    address_longitude: float | None = None
    persons_count: int = Field(default=0, ge=0, le=20)
    delivery_at: datetime | None = None
    points_to_spend: int = Field(default=0, ge=0)
    promo_code: str | None = Field(default=None, max_length=32)


class CheckoutLimits(BaseModel):
    """Что гость может списать прямо сейчас — считаем на сервере, чтобы не спорить."""

    points_balance: int
    max_points_to_spend: int
    cashback_percent: int


class FeedbackWrite(BaseModel):
    """Оценка заказа: звёзды обязательны, остальное — по желанию гостя."""

    rating: int = Field(ge=1, le=5)
    tags: list[str] = Field(default_factory=list, max_length=8)
    comment: str | None = Field(default=None, max_length=1000)


class FeedbackRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    order_id: UUID
    rating: int
    tags: list[str]
    comment: str | None
    created_at: datetime
