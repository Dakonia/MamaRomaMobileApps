from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import OrderStatus, ReservationStatus, StaffRole


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


class CategoryAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    sort_order: int
    is_active: bool
    image_url: str | None
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
    sort_order: int | None = None
    is_active: bool | None = None


class DishAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    category_id: UUID
    name: str
    description: str | None
    price_kopecks: int
    weight_grams: int | None
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
