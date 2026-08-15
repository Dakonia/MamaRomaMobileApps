import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings

TokenKind = Literal["access", "refresh"]

_PHONE_CLEAN = re.compile(r"[^\d+]")


class InvalidTokenError(Exception):
    pass


def normalize_phone(phone: str) -> str:
    """Приводим к +7XXXXXXXXXX: гость вводит номер как привык, в базе он один."""
    digits = _PHONE_CLEAN.sub("", phone)
    digits = digits.removeprefix("+")

    if digits.startswith("8") and len(digits) == 11:
        digits = "7" + digits[1:]
    if len(digits) == 10:
        digits = "7" + digits

    if len(digits) != 11 or not digits.startswith("7"):
        raise ValueError("Номер должен быть российским: +7 и десять цифр")

    return f"+{digits}"


def generate_code() -> str:
    upper = 10**settings.sms_code_length
    return str(secrets.randbelow(upper)).zfill(settings.sms_code_length)


def hash_code(code: str) -> str:
    return bcrypt.hashpw(code.encode(), bcrypt.gensalt(rounds=10)).decode()


def verify_code(code: str, code_hash: str) -> bool:
    try:
        return bcrypt.checkpw(code.encode(), code_hash.encode())
    except ValueError:
        return False


def create_token(guest_id: UUID, tenant_id: str, kind: TokenKind) -> str:
    now = datetime.now(UTC)
    ttl = (
        timedelta(minutes=settings.access_token_ttl_minutes)
        if kind == "access"
        else timedelta(days=settings.refresh_token_ttl_days)
    )
    payload = {
        "sub": str(guest_id),
        "tenant": tenant_id,
        "kind": kind,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
    }
    token: str = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token


def decode_token(token: str, expected_kind: TokenKind) -> tuple[UUID, str]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise InvalidTokenError("Токен недействителен или истёк") from exc

    if payload.get("kind") != expected_kind:
        raise InvalidTokenError("Токен не того типа")

    try:
        guest_id = UUID(str(payload["sub"]))
    except (KeyError, ValueError) as exc:
        raise InvalidTokenError("В токене нет идентификатора гостя") from exc

    tenant_id = str(payload.get("tenant", ""))
    if not tenant_id:
        raise InvalidTokenError("В токене нет тенанта")

    return guest_id, tenant_id
