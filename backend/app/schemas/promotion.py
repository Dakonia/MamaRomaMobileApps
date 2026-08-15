from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PromotionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    description: str | None
    label: str | None
    image_url: str | None
    restaurant_id: UUID | None
    starts_at: datetime | None
    ends_at: datetime | None


class PromotionWrite(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    description: str | None = None
    label: str | None = Field(default=None, max_length=24)
    image_url: str | None = Field(default=None, max_length=500)
    restaurant_id: UUID | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    sort_order: int = 0
    is_active: bool = True


class PromotionPatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = None
    label: str | None = Field(default=None, max_length=24)
    image_url: str | None = Field(default=None, max_length=500)
    restaurant_id: UUID | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class PromotionAdminRead(PromotionRead):
    sort_order: int
    is_active: bool
    restaurant_name: str | None = None
