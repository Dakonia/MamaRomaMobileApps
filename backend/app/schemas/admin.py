from datetime import date, datetime, time
from typing import Any
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


class GuestPointsAdjust(BaseModel):
    points: int = Field(ge=-100_000, le=100_000)
    comment: str | None = Field(default=None, max_length=200)


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
    feedback_count: int = 0
    average_rating: float | None = None
    last_order_at: datetime | None = None


class GuestFeedbackRead(BaseModel):
    id: UUID
    order_id: UUID
    order_number: str
    restaurant_name: str
    rating: int
    tags: list[str]
    comment: str | None
    created_at: datetime


class GuestOrderItemRead(BaseModel):
    id: UUID
    name: str
    quantity: int
    total_kopecks: int
    extras: list[str]


class GuestOrderRead(BaseModel):
    id: UUID
    number: str
    created_at: datetime
    type: str
    status: str
    restaurant_name: str
    address_text: str | None
    total_kopecks: int
    delivery_kopecks: int
    discount_kopecks: int
    points_spent: int
    points_earned: int
    promo_code: str | None
    persons_count: int | None
    comment: str | None
    items: list[GuestOrderItemRead]
    feedback: GuestFeedbackRead | None = None


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
    feedbacks: list[GuestFeedbackRead]


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


class ExtraDishesWrite(BaseModel):
    dish_ids: list[UUID] = []


class DishExtraLinkedDishRead(BaseModel):
    id: UUID
    name: str
    category_id: UUID
    category_name: str
    is_active: bool


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
    # Конкретные блюда, куда добавка привязана точечно
    linked_dishes: list[DishExtraLinkedDishRead] = []


# --- Уведомления ---------------------------------------------------------


class RuleRead(BaseModel):
    """Шаг заказа: пишем ли гостю и какими словами."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID | None = None
    restaurant_id: UUID | None = None
    event: str
    is_enabled: bool
    title: str
    body: str


class RuleWrite(BaseModel):
    restaurant_id: UUID | None = None
    event: str = Field(min_length=3, max_length=40)
    is_enabled: bool = True
    title: str = Field(min_length=2, max_length=120)
    body: str = Field(min_length=2, max_length=240)


class HoursRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    quiet_from: time
    quiet_to: time
    weekly_limit: int


class HoursWrite(BaseModel):
    quiet_from: time
    quiet_to: time
    weekly_limit: int = Field(default=2, ge=0, le=14)


class CampaignRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    title: str
    body: str
    image_url: str | None
    kind: str
    status: str
    target: dict[str, str]
    audience: dict[str, Any]
    scheduled_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None
    planned_count: int
    sent_count: int
    opened_count: int
    error: str | None


class CampaignWrite(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    title: str = Field(min_length=2, max_length=120)
    body: str = Field(min_length=2, max_length=240)
    image_url: str | None = Field(default=None, max_length=500)
    target: dict[str, str] = Field(default_factory=dict)
    audience: dict[str, Any] = Field(default_factory=dict)
    scheduled_at: datetime | None = None


class AudienceQuery(BaseModel):
    audience: dict[str, Any] = Field(default_factory=dict)


class AutomationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    trigger: str
    is_enabled: bool
    title: str
    body: str
    target: dict[str, str]
    params: dict[str, int]
    last_run_at: datetime | None
    sent_count: int


class AutomationWrite(BaseModel):
    trigger: str = Field(min_length=3, max_length=40)
    is_enabled: bool = False
    title: str = Field(min_length=2, max_length=120)
    body: str = Field(min_length=2, max_length=240)
    target: dict[str, str] = Field(default_factory=dict)
    params: dict[str, int] = Field(default_factory=dict)


class FeedbackRow(BaseModel):
    """Отзыв для админки: с номером заказа, рестораном и гостем."""

    id: UUID
    order_id: UUID
    order_number: str
    restaurant_name: str
    guest_name: str | None
    guest_phone: str
    guest_deleted: bool = False
    contact_erased: bool = False
    rating: int
    tags: list[str]
    comment: str | None
    created_at: datetime


class FeedbackSummary(BaseModel):
    """Сводка: средняя оценка и сколько каких звёзд."""

    average: float
    total: int
    by_rating: dict[str, int]


# ─────────────────────────── касса iiko ───────────────────────────


class BridgeRow(BaseModel):
    """Плагин точки: жив ли он и что о себе рассказал."""

    restaurant_id: UUID
    restaurant_name: str
    is_registered: bool
    is_active: bool
    last_seen_at: datetime | None
    plugin_version: str | None
    terminal_name: str | None
    # Сколько блюд и добавок сопоставлено с товарами этой кассы
    linked_dishes: int
    linked_extras: int
    # Блюда активного меню без товара кассы: с ними заказ на кухню не уедет
    unlinked_dishes: int = 0
    products: int
    pending_orders: int
    failed_orders: int


class BridgeSecret(BaseModel):
    """Ответ на создание или смену ключа: показываем секрет один раз."""

    restaurant_id: UUID
    secret: str


class BridgeToggle(BaseModel):
    is_active: bool


class IikoProductRow(BaseModel):
    product_id: str
    name: str
    code: str | None
    group_name: str | None
    group_path: str | None
    product_type: str | None
    price_kopecks: int = 0
    is_active: bool
    has_sizes: bool


class ProductGroupRow(BaseModel):
    """Группа номенклатуры кассы: по ним сужают поиск при сопоставлении."""

    name: str
    path: str
    products: int
    is_preset: bool = False


class LinkRow(BaseModel):
    """Строка сопоставления: наше блюдо и товар кассы этого ресторана."""

    kind: str
    id: UUID
    name: str
    group: str | None
    product_id: str | None
    product_name: str | None
    product_code: str | None = None
    product_group_path: str | None = None
    product_type: str | None = None
    size_id: str | None
    modifier_group_id: str | None
    our_price_kopecks: int = 0
    iiko_price_kopecks: int = 0
    # Подходящие товары кассы: чтобы связать в одно нажатие, не открывая поиск
    suggestions: list[IikoProductRow] = Field(default_factory=list)


class LinkWrite(BaseModel):
    kind: str = Field(pattern="^(dish|extra)$")
    id: UUID
    # Пусто — сопоставление снимаем
    product_id: str = Field(default="", max_length=64)
    size_id: str = Field(default="", max_length=64)
    modifier_group_id: str = Field(default="", max_length=64)


class LinkBatch(BaseModel):
    restaurant_id: UUID
    links: list[LinkWrite] = Field(default_factory=list, max_length=500)


class MatchResult(BaseModel):
    """Итог автосопоставления по названиям."""

    matched: int
    skipped: int


class HandoffRow(BaseModel):
    """Заказ в очереди на кассу: чем закончилась попытка."""

    order_id: UUID
    order_number: str
    restaurant_name: str
    status: str
    attempts: int
    error: str | None
    missing_products: list[str]
    iiko_order_number: str | None
    created_at: datetime
    total_kopecks: int


class MenuBranchRow(BaseModel):
    """Категория меню и ветки кассы, в которых искать её блюда."""

    category_id: UUID
    name: str
    dishes: int
    linked: int
    iiko_group_paths: list[str]


class MenuBranchWrite(BaseModel):
    category_id: UUID
    iiko_group_paths: list[str] = Field(default_factory=list, max_length=20)


class MenuTreeWrite(BaseModel):
    """Настройка дерева сети целиком: ветки категорий и общие правила."""

    branches: list[MenuBranchWrite] = Field(default_factory=list, max_length=100)
    deny_markers: list[str] = Field(default_factory=list, max_length=50)
    extra_group_paths: list[str] = Field(default_factory=list, max_length=20)
    keep_unknown_groups: bool = False


class MenuTreeRead(BaseModel):
    branches: list[MenuBranchRow]
    deny_markers: list[str]
    extra_group_paths: list[str]
    keep_unknown_groups: bool


class CopyLinksResult(BaseModel):
    """Итог переноса сопоставления с одного ресторана на другой."""

    copied: int
    skipped: int
