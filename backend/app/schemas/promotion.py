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
    image_blurhash: str | None = None
    image_width: int | None = None
    image_height: int | None = None
    # Пусто — акция действует во всех ресторанах сети
    restaurant_ids: list[UUID] = []
    restaurant_names: list[str] = []
    starts_at: datetime | None
    ends_at: datetime | None
    # Акция про доставку: приложение выносит такие вперёд и метит значком
    show_in_menu: bool = False
    source_url: str | None = None


class PromotionWrite(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    description: str | None = None
    label: str | None = Field(default=None, max_length=24)
    image_url: str | None = Field(default=None, max_length=500)
    restaurant_ids: list[UUID] = []
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    sort_order: int = 0
    is_active: bool = True
    show_in_menu: bool = False


class PromotionPatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = None
    label: str | None = Field(default=None, max_length=24)
    image_url: str | None = Field(default=None, max_length=500)
    restaurant_ids: list[UUID] | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    show_in_menu: bool | None = None


class PromotionAdminRead(PromotionRead):
    sort_order: int
    is_active: bool
    show_in_menu: bool = False
