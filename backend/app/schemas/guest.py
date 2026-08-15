from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class GuestUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    email: EmailStr | None = None
    birthday: date | None = None


class AddressCreate(BaseModel):
    city_id: UUID
    street: str = Field(min_length=2, max_length=200)
    house: str = Field(min_length=1, max_length=20)
    title: str | None = Field(default=None, max_length=60)
    flat: str | None = Field(default=None, max_length=20)
    entrance: str | None = Field(default=None, max_length=20)
    floor: str | None = Field(default=None, max_length=20)
    intercom: str | None = Field(default=None, max_length=20)
    comment: str | None = Field(default=None, max_length=300)
    latitude: float | None = None
    longitude: float | None = None
    is_default: bool = False


class AddressRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    city_id: UUID
    title: str | None
    street: str
    house: str
    flat: str | None
    entrance: str | None
    floor: str | None
    intercom: str | None
    comment: str | None
    is_default: bool
    full_text: str
