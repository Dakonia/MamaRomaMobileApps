from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import DevicePlatform, Gender


class GuestUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    # Акции и новости: согласие отдельное от уведомлений о заказе
    marketing_opt_in: bool | None = None
    email: EmailStr | None = None
    birthday: date | None = None
    gender: Gender | None = None


class AddressCreate(BaseModel):
    city_id: UUID
    # Населённый пункт из подсказки: Кудрово и Мурино — не Петербург
    locality: str | None = Field(default=None, max_length=120)
    street: str = Field(min_length=2, max_length=200)
    house: str = Field(min_length=1, max_length=20)
    building: str | None = Field(default=None, max_length=20)
    title: str | None = Field(default=None, max_length=60)
    flat: str | None = Field(default=None, max_length=20)
    entrance: str | None = Field(default=None, max_length=20)
    floor: str | None = Field(default=None, max_length=20)
    intercom: str | None = Field(default=None, max_length=20)
    comment: str | None = Field(default=None, max_length=300)
    latitude: float | None = None
    longitude: float | None = None
    is_default: bool = False


class AddressUpdate(BaseModel):
    """Правка сохранённого адреса. Меняем только то, что пришло."""

    locality: str | None = Field(default=None, max_length=120)
    street: str | None = Field(default=None, min_length=2, max_length=200)
    house: str | None = Field(default=None, min_length=1, max_length=20)
    building: str | None = Field(default=None, max_length=20)
    title: str | None = Field(default=None, max_length=60)
    flat: str | None = Field(default=None, max_length=20)
    entrance: str | None = Field(default=None, max_length=20)
    floor: str | None = Field(default=None, max_length=20)
    intercom: str | None = Field(default=None, max_length=20)
    comment: str | None = Field(default=None, max_length=300)
    latitude: float | None = None
    longitude: float | None = None
    is_default: bool | None = None


class AddressRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    city_id: UUID
    title: str | None
    street: str
    house: str
    building: str | None
    flat: str | None
    entrance: str | None
    floor: str | None
    intercom: str | None
    comment: str | None
    is_default: bool
    full_text: str
    latitude: float | None = None
    longitude: float | None = None
    locality: str | None = None
    metro: str | None = None
    # Кто обслуживает этот адрес: приложение по нему выбирает меню
    restaurant_id: UUID | None = None
    restaurant_name: str | None = None
    delivery_covered: bool = False


class AddressSuggestion(BaseModel):
    title: str
    subtitle: str
    city: str
    street: str
    house: str
    building: str
    latitude: float | None
    longitude: float | None


class FavouriteDish(BaseModel):
    dish_id: UUID
    name: str
    image_url: str | None
    price_kopecks: int
    times: int


class GuestSummary(BaseModel):
    """Итоги гостя для профиля: сколько заказывал, что берёт чаще, откуда возит."""

    orders_count: int
    spent_kopecks: int
    favourite_restaurant: str | None
    favourites: list[FavouriteDish]


class DeviceWrite(BaseModel):
    """Устройство гостя для пуш-уведомлений."""

    push_token: str = Field(min_length=10, max_length=200)
    platform: DevicePlatform
    app_version: str | None = Field(default=None, max_length=20)
