import json
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field

TENANTS_DIR = Path(__file__).resolve().parents[3] / "packages" / "tenants" / "data"


class LoyaltyTier(BaseModel):
    code: str
    title: str
    cashback_percent: int = Field(alias="cashbackPercent")
    threshold_rub: int = Field(alias="thresholdRub")


class Loyalty(BaseModel):
    point_to_ruble_rate: float = Field(alias="pointToRubleRate")
    max_redeem_share_of_check: float = Field(alias="maxRedeemShareOfCheck")
    points_expire_after_days: int = Field(alias="pointsExpireAfterDays")
    welcome_bonus: int = Field(alias="welcomeBonus")
    birthday_bonus: int = Field(alias="birthdayBonus")
    tiers: list[LoyaltyTier]


class Branding(BaseModel):
    display_name: str = Field(alias="displayName")
    legal_name: str = Field(alias="legalName")
    tagline: str
    primary: str
    accent: str


class Features(BaseModel):
    delivery: bool
    pickup: bool
    dine_in_reservation: bool = Field(alias="dineInReservation")
    loyalty: bool
    stories: bool
    online_payment: bool = Field(alias="onlinePayment")


class Tenant(BaseModel):
    model_config = {"populate_by_name": True, "extra": "ignore"}

    id: str
    slug: str
    branding: Branding
    features: Features
    loyalty: Loyalty
    support_phone: str = Field(alias="supportPhone")
    timezone: str


@lru_cache
def get_tenant(tenant_id: str) -> Tenant:
    path = TENANTS_DIR / f"{tenant_id}.json"
    if not path.exists():
        raise ValueError(f"Неизвестный тенант «{tenant_id}»")
    return Tenant.model_validate(json.loads(path.read_text(encoding="utf-8")))


def list_tenant_ids() -> list[str]:
    return sorted(p.stem for p in TENANTS_DIR.glob("*.json"))
