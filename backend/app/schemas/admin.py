from datetime import date, datetime, time
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import Gender, OrderStatus, PromoCodeKind, ReservationStatus, StaffRole
from app.schemas.guest import AddressRead


class StaffLogin(BaseModel):
    email: str
    password: str


class StaffRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    name: str
    role: StaffRole


class StaffSession(BaseModel):
    access_token: str
    token_type: str = "bearer"
    staff: StaffRead


class CategoryWrite(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=1, max_length=60, pattern=r"^[a-z0-9-]+$")
    sort_order: int = 0
    is_active: bool = True
    image_url: str | None = Field(default=None, max_length=500)
    show_in_popular: bool = True


class CategoryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    slug: str | None = Field(default=None, min_length=1, max_length=60, pattern=r"^[a-z0-9-]+$")
    sort_order: int | None = None
    is_active: bool | None = None
    image_url: str | None = Field(default=None, max_length=500)
    show_in_popular: bool | None = None


class CategoryAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    sort_order: int
    is_active: bool
    image_url: str | None
    # Показывать ли блюда раздела на полке «Часто заказывают»
    show_in_popular: bool = True
    dishes_count: int = 0


class DishWrite(BaseModel):
    category_id: UUID
    name: str = Field(min_length=1, max_length=200)
    price_kopecks: int = Field(ge=0)
    description: str | None = None
    composition: str | None = None
    image_url: str | None = Field(default=None, max_length=500)
    weight_grams: int | None = Field(default=None, ge=0)
    volume_ml: int | None = Field(default=None, ge=0)
    calories: int | None = Field(default=None, ge=0)
    proteins_g: float | None = Field(default=None, ge=0)
    fats_g: float | None = Field(default=None, ge=0)
    carbs_g: float | None = Field(default=None, ge=0)
    is_spicy: bool = False
    is_vegetarian: bool = False
    is_new: bool = False
    sort_order: int = 0
    is_active: bool = True


class DishPatch(BaseModel):
    category_id: UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)
    price_kopecks: int | None = Field(default=None, ge=0)
    description: str | None = None
    composition: str | None = None
    image_url: str | None = Field(default=None, max_length=500)
    weight_grams: int | None = Field(default=None, ge=0)
    volume_ml: int | None = Field(default=None, ge=0)
    calories: int | None = Field(default=None, ge=0)
    proteins_g: float | None = Field(default=None, ge=0)
    fats_g: float | None = Field(default=None, ge=0)
    carbs_g: float | None = Field(default=None, ge=0)
    is_spicy: bool | None = None
    is_vegetarian: bool | None = None
    is_new: bool | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class DishAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    category_id: UUID
    name: str
    description: str | None
    composition: str | None
    image_url: str | None
    price_kopecks: int
    weight_grams: int | None
    volume_ml: int | None
    calories: int | None
    proteins_g: float | None
    fats_g: float | None
    carbs_g: float | None
    is_spicy: bool
    is_vegetarian: bool
    is_new: bool
    is_active: bool
    sort_order: int


class StopListWrite(BaseModel):
    restaurant_id: UUID
    dish_id: UUID
    until: datetime | None = None
    comment: str | None = Field(default=None, max_length=200)


class StopListRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    restaurant_id: UUID
    restaurant_name: str
    dish_id: UUID
    dish_name: str
    until: datetime | None
    comment: str | None


class OrderStatusWrite(BaseModel):
    status: OrderStatus
    cancel_reason: str | None = Field(default=None, max_length=300)


class ReservationStatusWrite(BaseModel):
    status: ReservationStatus
    cancel_reason: str | None = Field(default=None, max_length=300)
    table_number: str | None = Field(default=None, max_length=20)


class RestaurantWrite(BaseModel):
    city_id: UUID
    name: str = Field(min_length=2, max_length=160)
    address: str = Field(min_length=3, max_length=300)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    opens_at: time
    closes_at: time
    delivery_opens_at: time | None = None
    delivery_closes_at: time | None = None
    metro: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=24)
    description: str | None = None
    image_url: str | None = Field(default=None, max_length=500)
    has_delivery: bool = True
    has_pickup: bool = True
    has_dine_in: bool = True
    delivery_price_kopecks: int = Field(default=0, ge=0)
    delivery_min_order_kopecks: int = Field(default=0, ge=0)
    free_delivery_from_kopecks: int | None = Field(default=None, ge=0)
    is_active: bool = True
    is_paused: bool = False
    pause_reason: str | None = Field(default=None, max_length=200)
    # Принимать ли заказы, пока ресторан закрыт
    preorder_enabled: bool = False


class RestaurantPatch(BaseModel):
    city_id: UUID | None = None
    name: str | None = Field(default=None, min_length=2, max_length=160)
    address: str | None = Field(default=None, min_length=3, max_length=300)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    opens_at: time | None = None
    closes_at: time | None = None
    delivery_opens_at: time | None = None
    delivery_closes_at: time | None = None
    metro: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=24)
    description: str | None = None
    image_url: str | None = Field(default=None, max_length=500)
    has_delivery: bool | None = None
    has_pickup: bool | None = None
    has_dine_in: bool | None = None
    delivery_price_kopecks: int | None = Field(default=None, ge=0)
    delivery_min_order_kopecks: int | None = Field(default=None, ge=0)
    free_delivery_from_kopecks: int | None = Field(default=None, ge=0)
    is_active: bool | None = None
    is_paused: bool | None = None
    pause_reason: str | None = Field(default=None, max_length=200)
    preorder_enabled: bool | None = None


class RestaurantAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    city_id: UUID
    name: str
    address: str
    metro: str | None
    phone: str | None
    latitude: float
    longitude: float
    opens_at: time
    closes_at: time
    delivery_opens_at: time | None
    delivery_closes_at: time | None
    has_delivery: bool
    has_pickup: bool
    has_dine_in: bool
    delivery_price_kopecks: int
    delivery_min_order_kopecks: int
    free_delivery_from_kopecks: int | None
    description: str | None
    image_url: str | None
    is_active: bool
    is_paused: bool
    pause_reason: str | None
    preorder_enabled: bool = False


class GuestWrite(BaseModel):
    phone: str = Field(min_length=10, max_length=20)
    name: str | None = Field(default=None, max_length=120)
    email: EmailStr | None = None
    birthday: date | None = None
    gender: Gender | None = None


class GuestPatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    email: EmailStr | None = None
    birthday: date | None = None
    gender: Gender | None = None
    is_blocked: bool | None = None


class GuestAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    phone: str
    name: str | None
    email: str | None
    birthday: date | None
    gender: Gender | None
    is_blocked: bool
    created_at: datetime
    last_seen_at: datetime | None
    # Считается по заказам: менеджеру важно видеть их прямо в списке
    orders_count: int = 0
    spent_kopecks: int = 0
    tier_title: str = ""
    points_balance: int = 0
    card_number: str = ""


class GuestOrderRead(BaseModel):
    id: UUID
    number: str
    created_at: datetime
    type: str
    status: str
    restaurant_name: str
    address_text: str | None
    total_kopecks: int
    items: list[str]


class GuestReservationRead(BaseModel):
    id: UUID
    reserved_at: datetime
    guests_count: int
    status: str
    restaurant_name: str


class GuestPointsRead(BaseModel):
    created_at: datetime
    operation: str
    points: int
    comment: str | None


class GuestCardRead(BaseModel):
    """Всё про гостя на одном экране: кто он, куда возил, что заказывал."""

    guest: GuestAdminRead
    addresses: list[AddressRead]
    orders: list[GuestOrderRead]
    reservations: list[GuestReservationRead]
    points: list[GuestPointsRead]


class ZoneRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    city_id: UUID
    restaurant_id: UUID
    restaurant_name: str = ""
    name: str
    color: str
    outline: list[list[float]]
    delivery_price_kopecks: int
    min_order_kopecks: int
    min_order_weekend_kopecks: int | None
    free_delivery_from_kopecks: int | None
    delivery_minutes: int | None
    sort_order: int
    is_active: bool


class ZoneCreate(BaseModel):
    """Новая зона: контур рисуется в админке на карте."""

    city_id: UUID
    restaurant_id: UUID
    name: str = Field(min_length=2, max_length=160)
    color: str = Field(default="#C0392B", max_length=9)
    outline: list[list[float]] = Field(min_length=3)
    delivery_price_kopecks: int = Field(default=0, ge=0)
    min_order_kopecks: int = Field(default=0, ge=0)
    min_order_weekend_kopecks: int | None = Field(default=None, ge=0)
    free_delivery_from_kopecks: int | None = Field(default=None, ge=0)
    delivery_minutes: int | None = Field(default=None, ge=0)
    sort_order: int = 0


class ZonePatch(BaseModel):
    restaurant_id: UUID | None = None
    name: str | None = Field(default=None, min_length=2, max_length=160)
    color: str | None = Field(default=None, max_length=9)
    outline: list[list[float]] | None = None
    delivery_price_kopecks: int | None = Field(default=None, ge=0)
    min_order_kopecks: int | None = Field(default=None, ge=0)
    min_order_weekend_kopecks: int | None = Field(default=None, ge=0)
    free_delivery_from_kopecks: int | None = Field(default=None, ge=0)
    delivery_minutes: int | None = Field(default=None, ge=0)
    sort_order: int | None = None
    is_active: bool | None = None


class RestaurantDishRead(BaseModel):
    """Строка меню ресторана: цена и продаётся ли блюдо в этой точке."""

    dish_id: UUID
    name: str
    category_name: str
    base_price_kopecks: int
    price_kopecks: int
    is_available: bool
    in_stop_list: bool


class RestaurantDishPatch(BaseModel):
    dish_id: UUID
    # None — вернуть общую цену сети
    price_kopecks: int | None = Field(default=None, ge=0)
    is_available: bool = True


class PromoCodeWrite(BaseModel):
    code: str = Field(min_length=3, max_length=32)
    title: str = Field(default="", max_length=120)
    kind: PromoCodeKind = PromoCodeKind.PERCENT
    value: int = Field(default=0, ge=0)
    max_discount_kopecks: int | None = Field(default=None, ge=0)
    min_order_kopecks: int = Field(default=0, ge=0)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    usage_limit: int | None = Field(default=None, ge=1)
    per_guest_limit: int = Field(default=1, ge=0)
    is_active: bool = True


class PromoCodePatch(BaseModel):
    code: str | None = Field(default=None, min_length=3, max_length=32)
    title: str | None = Field(default=None, max_length=120)
    kind: PromoCodeKind | None = None
    value: int | None = Field(default=None, ge=0)
    max_discount_kopecks: int | None = Field(default=None, ge=0)
    min_order_kopecks: int | None = Field(default=None, ge=0)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    usage_limit: int | None = Field(default=None, ge=1)
    per_guest_limit: int | None = Field(default=None, ge=0)
    is_active: bool | None = None


class PromoCodeRead(PromoCodeWrite):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    used_count: int


class DishExtraWrite(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    price_kopecks: int = Field(default=0, ge=0)
    is_active: bool = True


class DishExtraPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    price_kopecks: int | None = Field(default=None, ge=0)
    is_active: bool | None = None


class ExtraCategoriesWrite(BaseModel):
    category_ids: list[UUID] = []


class DishExtraAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    price_kopecks: int
    is_active: bool
    # К скольким блюдам привязана
    dishes_count: int = 0
    # Разделы, где добавка предлагается ко всем блюдам
    category_ids: list[UUID] = []
