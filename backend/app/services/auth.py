import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import (
    InvalidTokenError,
    card_barcode,
    create_signup_token,
    create_token,
    decode_signup_token,
    generate_code,
    hash_code,
    normalize_phone,
    verify_code,
)
from app.core.tenants import Tenant
from app.models.auth import PhoneCode
from app.models.guest import Guest
from app.models.loyalty import LoyaltyAccount
from app.schemas.auth import (
    CodeRequestResult,
    GuestRead,
    LoyaltyRead,
    SessionRead,
    SignupRequest,
    SignupRequired,
)
from app.services import loyalty as loyalty_service

logger = logging.getLogger(__name__)


def _session_for(tenant: Tenant, guest: Guest, account: LoyaltyAccount) -> SessionRead:
    tier = loyalty_service.tier_by_code(tenant, account.tier_code)
    return SessionRead(
        access_token=create_token(guest.id, tenant.id, "access"),
        refresh_token=create_token(guest.id, tenant.id, "refresh"),
        guest=GuestRead.model_validate(guest),
        loyalty=LoyaltyRead(
            card_number=account.card_number,
            card_barcode=card_barcode(account.card_number),
            tier_code=tier.code,
            tier_title=tier.title,
            cashback_percent=tier.cashback_percent,
            points_balance=account.points_balance,
            lifetime_spent_kopecks=account.lifetime_spent_kopecks,
        ),
    )


class AuthError(Exception):
    def __init__(self, message: str, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.retry_after = retry_after


def _debug_code_allowed(phone: str) -> bool:
    """Можно ли этому номеру входить по отладочному коду.

    Провайдера СМС ещё нет, и без поблажки на тестовом стенде не войти вовсе.
    Но поблажка именная: список номеров задаётся настройкой сервера. Пока она
    пуста — код не подходит никому. Раньше условие было «окружение не боевое», и
    на публичном стенде это означало вход под любым чужим номером.
    """
    if settings.sms_code_debug_value is None or settings.environment == "production":
        return False

    return phone in settings.sms_debug_phones


async def _latest_code(session: AsyncSession, tenant_id: str, phone: str) -> PhoneCode | None:
    record: PhoneCode | None = await session.scalar(
        select(PhoneCode)
        .where(PhoneCode.tenant_id == tenant_id, PhoneCode.phone == phone)
        .order_by(PhoneCode.created_at.desc())
        .limit(1)
    )
    return record


async def request_code(session: AsyncSession, tenant: Tenant, raw_phone: str) -> CodeRequestResult:
    try:
        phone = normalize_phone(raw_phone)
    except ValueError as exc:
        raise AuthError(str(exc)) from exc

    now = datetime.now(UTC)
    previous = await _latest_code(session, tenant.id, phone)

    if previous is not None and previous.used_at is None:
        wait = settings.sms_code_resend_seconds - int((now - previous.created_at).total_seconds())
        if wait > 0:
            raise AuthError(f"Новый код можно запросить через {wait} с", retry_after=wait)

    debug = _debug_code_allowed(phone)
    code = settings.sms_code_debug_value if debug else generate_code()
    assert code is not None

    session.add(
        PhoneCode(
            tenant_id=tenant.id,
            phone=phone,
            code_hash=hash_code(code),
            expires_at=now + timedelta(minutes=settings.sms_code_ttl_minutes),
        )
    )
    await session.commit()

    if debug:
        # В журнал, а не в ответ: ответ видит кто угодно, журнал — только мы
        logger.warning("Код для %s: %s (окружение %s)", phone, code, settings.environment)
    else:
        # TODO: отправка через SMS-провайдера, ключ в settings.sms_provider_api_key
        logger.info("Код отправлен на %s", phone)

    return CodeRequestResult(
        phone=phone,
        resend_after_seconds=settings.sms_code_resend_seconds,
    )


async def verify(
    session: AsyncSession, tenant: Tenant, raw_phone: str, code: str
) -> SessionRead | SignupRequired:
    try:
        phone = normalize_phone(raw_phone)
    except ValueError as exc:
        raise AuthError(str(exc)) from exc

    record = await _latest_code(session, tenant.id, phone)
    now = datetime.now(UTC)

    if record is None or record.used_at is not None:
        raise AuthError("Запросите код заново")
    if record.expires_at <= now:
        raise AuthError("Срок действия кода истёк")
    if record.attempts >= settings.sms_code_max_attempts:
        raise AuthError("Слишком много попыток. Запросите новый код")

    if not verify_code(code, record.code_hash):
        record.attempts += 1
        await session.commit()
        raise AuthError("Неверный код")

    record.used_at = now
    await session.commit()

    guest = await session.scalar(
        select(Guest).where(
            Guest.tenant_id == tenant.id, Guest.phone == phone, Guest.deleted_at.is_(None)
        )
    )

    # Незнакомый номер: гостя не заводим, пока он не назовёт имя. Свернул
    # приложение на знакомстве — в базе не осталось ни строки
    if guest is None:
        return SignupRequired(signup_token=create_signup_token(phone, tenant.id), phone=phone)

    if guest.is_blocked:
        raise AuthError("Профиль заблокирован. Свяжитесь с поддержкой")

    guest.last_seen_at = now
    existing = await loyalty_service.get_account(session, tenant, guest.id)
    account = existing or await loyalty_service.open_account(session, tenant, guest.id)

    await session.commit()
    await session.refresh(guest)
    await session.refresh(account)

    return _session_for(tenant, guest, account)


async def signup(session: AsyncSession, tenant: Tenant, payload: SignupRequest) -> SessionRead:
    """Создаём гостя: телефон подтверждён кодом, имя только что названо."""
    try:
        phone, token_tenant = decode_signup_token(payload.signup_token)
    except InvalidTokenError as exc:
        raise AuthError(str(exc)) from exc

    if token_tenant != tenant.id:
        raise AuthError("Регистрация принадлежит другой сети")

    now = datetime.now(UTC)
    guest = await session.scalar(
        select(Guest).where(
            Guest.tenant_id == tenant.id, Guest.phone == phone, Guest.deleted_at.is_(None)
        )
    )

    # Пока человек вводил имя, он мог войти со второго устройства
    if guest is None:
        guest = Guest(
            tenant_id=tenant.id,
            phone=phone,
            name=payload.name.strip(),
            gender=payload.gender,
            birthday=payload.birthday,
            consent_at=now,
            consent_version="1",
        )
        session.add(guest)
        await session.flush()
        account = await loyalty_service.open_account(session, tenant, guest.id)
    else:
        if guest.is_blocked:
            raise AuthError("Профиль заблокирован. Свяжитесь с поддержкой")
        guest.name = payload.name.strip()
        guest.gender = payload.gender or guest.gender
        guest.birthday = payload.birthday or guest.birthday
        guest.last_seen_at = now
        existing = await loyalty_service.get_account(session, tenant, guest.id)
        account = existing or await loyalty_service.open_account(session, tenant, guest.id)

    await session.commit()
    await session.refresh(guest)
    await session.refresh(account)

    return _session_for(tenant, guest, account)


