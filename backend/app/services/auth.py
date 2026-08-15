import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import (
    create_token,
    generate_code,
    hash_code,
    normalize_phone,
    verify_code,
)
from app.core.tenants import Tenant
from app.models.auth import PhoneCode
from app.models.guest import Guest
from app.schemas.auth import CodeRequestResult, GuestRead, LoyaltyRead, SessionRead
from app.services import loyalty as loyalty_service

logger = logging.getLogger(__name__)


class AuthError(Exception):
    def __init__(self, message: str, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.retry_after = retry_after


def _is_debug_environment() -> bool:
    return settings.environment != "production" and settings.sms_code_debug_value is not None


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

    code = settings.sms_code_debug_value if _is_debug_environment() else generate_code()
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

    if _is_debug_environment():
        logger.warning("Код для %s: %s (окружение %s)", phone, code, settings.environment)
    else:
        # TODO: отправка через SMS-провайдера, ключ в settings.sms_provider_api_key
        logger.info("Код отправлен на %s", phone)

    return CodeRequestResult(
        phone=phone,
        resend_after_seconds=settings.sms_code_resend_seconds,
        debug_code=code if _is_debug_environment() else None,
    )


async def verify(session: AsyncSession, tenant: Tenant, raw_phone: str, code: str) -> SessionRead:
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

    guest = await session.scalar(
        select(Guest).where(Guest.tenant_id == tenant.id, Guest.phone == phone)
    )
    is_new_guest = guest is None

    if guest is None:
        guest = Guest(tenant_id=tenant.id, phone=phone, consent_at=now, consent_version="1")
        session.add(guest)
        await session.flush()
        account = await loyalty_service.open_account(session, tenant, guest.id)
    else:
        if guest.is_blocked:
            raise AuthError("Профиль заблокирован. Свяжитесь с поддержкой")
        guest.last_seen_at = now
        existing = await loyalty_service.get_account(session, tenant, guest.id)
        account = existing or await loyalty_service.open_account(session, tenant, guest.id)

    await session.commit()
    await session.refresh(guest)
    await session.refresh(account)

    tier = loyalty_service.tier_by_code(tenant, account.tier_code)

    return SessionRead(
        access_token=create_token(guest.id, tenant.id, "access"),
        refresh_token=create_token(guest.id, tenant.id, "refresh"),
        guest=GuestRead.model_validate(guest),
        loyalty=LoyaltyRead(
            tier_code=tier.code,
            tier_title=tier.title,
            cashback_percent=tier.cashback_percent,
            points_balance=account.points_balance,
        ),
        is_new_guest=is_new_guest,
    )
