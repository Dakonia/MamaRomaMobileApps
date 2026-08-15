from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ReservationStatus


class ReservationCreate(BaseModel):
    restaurant_id: UUID
    # Момент брони в UTC — часовой пояс ресторана лежит в конфиге тенанта
    reserved_at: datetime
    guests_count: int = Field(ge=1, le=20)
    comment: str | None = Field(default=None, max_length=500)
    contact_name: str | None = Field(default=None, max_length=120)


class ReservationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    status: ReservationStatus
    restaurant_id: UUID
    restaurant_name: str
    reserved_at: datetime
    duration_minutes: int
    guests_count: int
    comment: str | None
    contact_name: str | None
    contact_phone: str
    created_at: datetime


class SlotRead(BaseModel):
    """Свободное время на выбранную дату, уже в часовом поясе ресторана."""

    starts_at: datetime
    label: str
    is_available: bool
