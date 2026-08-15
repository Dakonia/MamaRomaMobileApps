from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CodeRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=20, examples=["+7 999 123-45-67"])


class CodeRequestResult(BaseModel):
    phone: str
    resend_after_seconds: int
    # Заполняется только в local и staging, чтобы входить без реальной SMS
    debug_code: str | None = None


class CodeVerify(BaseModel):
    phone: str = Field(min_length=10, max_length=20)
    code: str = Field(min_length=4, max_length=8)


class RefreshRequest(BaseModel):
    refresh_token: str


class GuestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    phone: str
    name: str | None
    email: str | None
    birthday: date | None


class LoyaltyRead(BaseModel):
    tier_code: str
    tier_title: str
    cashback_percent: int
    points_balance: int


class ProfileRead(BaseModel):
    guest: GuestRead
    loyalty: LoyaltyRead


class SessionRead(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    guest: GuestRead
    loyalty: LoyaltyRead
    is_new_guest: bool
