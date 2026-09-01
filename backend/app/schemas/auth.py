from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import Gender


class CodeRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=20, examples=["+7 999 123-45-67"])


class CodeRequestResult(BaseModel):
    phone: str
    resend_after_seconds: int
    # Заполняется только в local и staging, чтобы входить без реальной SMS


class CodeVerify(BaseModel):
    phone: str = Field(min_length=10, max_length=20)
    code: str = Field(min_length=4, max_length=8)


class RefreshRequest(BaseModel):
    refresh_token: str


class SignupRequest(BaseModel):
    signup_token: str
    name: str = Field(min_length=2, max_length=120)
    gender: Gender | None = None
    birthday: date | None
    marketing_opt_in: bool = True


class GuestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    phone: str
    name: str | None
    email: str | None
    birthday: date | None
    marketing_opt_in: bool = True
    gender: Gender | None


class LoyaltyRead(BaseModel):
    # Короткий номер называют вслух, длинный сканируют — это одна и та же карта
    card_number: str = ""
    card_barcode: str = ""
    tier_code: str
    tier_title: str
    cashback_percent: int
    points_balance: int
    # Сколько гость потратил за всё время — по нему считаем путь до следующего уровня
    lifetime_spent_kopecks: int = 0


class ProfileRead(BaseModel):
    guest: GuestRead
    loyalty: LoyaltyRead


class SignupRequired(BaseModel):
    """Телефон подтверждён, но гостя ещё нет: ждём имя и только потом заводим."""

    kind: Literal["signup"] = "signup"
    signup_token: str
    phone: str


class SessionRead(BaseModel):
    kind: Literal["session"] = "session"
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    guest: GuestRead
    loyalty: LoyaltyRead
