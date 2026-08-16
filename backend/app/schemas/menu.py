from uuid import UUID

from pydantic import BaseModel, ConfigDict


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
    has_delivery: bool
    has_pickup: bool
    has_dine_in: bool
    delivery_price_kopecks: int
    delivery_min_order_kopecks: int
    free_delivery_from_kopecks: int | None
    image_url: str | None


class DishRead(BaseModel):
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
    is_available: bool


class MenuCategoryRead(BaseModel):
    id: UUID
    name: str
    slug: str
    image_url: str | None
    dishes: list[DishRead]


class MenuRead(BaseModel):
    restaurant_id: UUID | None
    categories: list[MenuCategoryRead]
