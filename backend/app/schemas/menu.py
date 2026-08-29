from datetime import time
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator


class CityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str


class RestaurantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    city_id: UUID
    name: str
    address: str
    metro: str | None
    phone: str | None
    latitude: float
    longitude: float
    # Часы работы зала: приложение показывает «открыт/закрыт» в списке
    opens_at: time
    closes_at: time
    has_delivery: bool
    has_pickup: bool
    has_dine_in: bool
    delivery_price_kopecks: int
    delivery_min_order_kopecks: int
    free_delivery_from_kopecks: int | None
    image_url: str | None
    image_blurhash: str | None = None
    # Галерея зала: приложение показывает её на экране брони
    photos: list[str] = []
    # Ресторан на паузе остаётся в списке, но заказ не примет — гость должен
    # видеть это до того, как соберёт корзину
    is_paused: bool
    pause_reason: str | None

    @field_validator("photos", mode="before")
    @classmethod
    def _urls(cls, value: object) -> list[str]:
        """Из БД приходят строки галереи, из ORM — объекты снимков."""
        rows = value if isinstance(value, list) else []
        return [row if isinstance(row, str) else getattr(row, "url", "") for row in rows]


class DishExtraRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    price_kopecks: int
    # «Советуем»: к пасте — пармезан, к пицце — моцарелла
    is_recommended: bool = False


class DishRead(BaseModel):
    id: UUID
    category_id: UUID
    name: str
    description: str | None
    composition: str | None
    image_url: str | None
    image_blurhash: str | None = None
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
    is_available: bool
    # Почему блюдо нельзя заказать: «закончилось сегодня», «нет в этом ресторане»
    unavailable_reason: str | None = None
    # Что можно докинуть: бекон, грибы, второй сыр
    extras: list[DishExtraRead] = []


class MenuCategoryRead(BaseModel):
    id: UUID
    name: str
    slug: str
    image_url: str | None
    image_blurhash: str | None = None
    dishes: list[DishRead]


class MenuRead(BaseModel):
    restaurant_id: UUID | None
    categories: list[MenuCategoryRead]


class DeliveryZoneRead(BaseModel):
    """Контур зоны для карты: гость должен видеть, куда мы возим."""

    id: UUID
    name: str
    # Точки как в GeoJSON: [[долгота, широта], ...]
    outline: list[list[float]]
    color: str
    delivery_price_kopecks: int = 0
    min_order_kopecks: int = 0
    delivery_minutes: int | None = None


class DeliveryResolve(BaseModel):
    """Кто везёт на этот адрес и на каких условиях."""

    covered: bool
    restaurant: RestaurantRead | None = None
    zone_name: str | None = None
    delivery_price_kopecks: int = 0
    # Минимум именно на сегодня: в выходные он бывает выше
    min_order_kopecks: int = 0
    free_delivery_from_kopecks: int | None = None
    delivery_minutes: int | None = None
    delivery_opens_at: time | None = None
    delivery_closes_at: time | None = None
    # Сейчас служба доставки работает или уже закрылась
    delivery_open_now: bool = True
    # Ресторан зоны на паузе: доставки сейчас нет, но причину показать надо
    paused_reason: str | None = None
