import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings

TokenKind = Literal["access", "refresh", "staff"]

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


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_token(subject_id: UUID, tenant_id: str, kind: TokenKind) -> str:
    now = datetime.now(UTC)
    if kind == "access":
        ttl = timedelta(minutes=settings.access_token_ttl_minutes)
    elif kind == "staff":
        ttl = timedelta(hours=settings.staff_token_ttl_hours)
    else:
        ttl = timedelta(days=settings.refresh_token_ttl_days)
    payload = {
        "sub": str(subject_id),
        "tenant": tenant_id,
        "kind": kind,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
    }
    token: str = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token


def generate_card_number() -> str:
    """Шесть цифр — столько гость сможет продиктовать по телефону и набрать кассир."""
    return f"{secrets.randbelow(900000) + 100000}"


def card_barcode(card_number: str) -> str:
    """
    Тот же номер в виде EAN-13 для сканера: префикс 26 зарезервирован под
    внутренние коды сетей, дальше нули, шесть цифр карты и контрольная сумма.
    Кассир видит на экране короткий номер, сканер читает длинный — это один код.
    """
    body = f"260000{card_number.zfill(6)}"
    checksum = sum(int(digit) * (3 if index % 2 else 1) for index, digit in enumerate(body))
    return f"{body}{(10 - checksum % 10) % 10}"


def create_signup_token(phone: str, tenant_id: str) -> str:
    """
    Билет на регистрацию: телефон уже подтверждён кодом, но гостя в базе ещё нет.
    Он появится, только когда человек назовёт имя. Бросил на полпути — в базе
    не осталось ничего, а билет протухнет сам.
    """
    now = datetime.now(UTC)
    payload = {
        "sub": phone,
        "tenant": tenant_id,
        "kind": "signup",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.signup_token_ttl_minutes)).timestamp()),
    }
    token: str = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token


def decode_signup_token(token: str) -> tuple[str, str]:
    """Возвращает подтверждённый телефон и тенанта."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise InvalidTokenError("Регистрация просрочена, начните заново") from exc

    if payload.get("kind") != "signup":
        raise InvalidTokenError("Токен не того типа")

    phone = str(payload.get("sub", ""))
    tenant_id = str(payload.get("tenant", ""))
    if not phone or not tenant_id:
        raise InvalidTokenError("Токен неполный")

    return phone, tenant_id


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
        raise InvalidTokenError("В токене нет идентификатора") from exc

    tenant_id = str(payload.get("tenant", ""))
    if not tenant_id:
        raise InvalidTokenError("В токене нет тенанта")

    return guest_id, tenant_id
