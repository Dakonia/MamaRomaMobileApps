from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import GuestDep, SessionDep, TenantDep
from app.core.security import InvalidTokenError, card_barcode, create_token, decode_token
from app.models.guest import Guest
from app.schemas.auth import (
    CodeRequest,
    CodeRequestResult,
    CodeVerify,
    GuestRead,
    LoyaltyRead,
    ProfileRead,
    RefreshRequest,
    SessionRead,
    SignupRequest,
    SignupRequired,
)
from app.services import auth as auth_service
from app.services import loyalty as loyalty_service

router = APIRouter(prefix="/auth", tags=["Авторизация"])


def _http_error(exc: auth_service.AuthError) -> HTTPException:
    if exc.retry_after is not None:
        return HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            exc.message,
            headers={"Retry-After": str(exc.retry_after)},
        )
    return HTTPException(status.HTTP_400_BAD_REQUEST, exc.message)


@router.post("/request-code", summary="Отправить код подтверждения")
async def request_code(
    payload: CodeRequest, session: SessionDep, tenant: TenantDep
) -> CodeRequestResult:
    try:
        return await auth_service.request_code(session, tenant, payload.phone)
    except auth_service.AuthError as exc:
        raise _http_error(exc) from exc


@router.post(
    "/verify",
    summary="Проверить код",
    description=(
        "Знакомый номер — сразу сессия. Незнакомый — билет на регистрацию: "
        "гость появится в базе только после того, как назовёт имя."
    ),
)
async def verify(
    payload: CodeVerify, session: SessionDep, tenant: TenantDep
) -> SessionRead | SignupRequired:
    try:
        return await auth_service.verify(session, tenant, payload.phone, payload.code)
    except auth_service.AuthError as exc:
        raise _http_error(exc) from exc


@router.post("/signup", summary="Завершить регистрацию")
async def signup(payload: SignupRequest, session: SessionDep, tenant: TenantDep) -> SessionRead:
    try:
        return await auth_service.signup(session, tenant, payload)
    except auth_service.AuthError as exc:
        raise _http_error(exc) from exc


@router.post("/refresh", summary="Обновить пару токенов")
async def refresh(
    payload: RefreshRequest, session: SessionDep, tenant: TenantDep
) -> dict[str, str]:
    try:
        guest_id, token_tenant = decode_token(payload.refresh_token, "refresh")
    except InvalidTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc

    if token_tenant != tenant.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Токен выдан для другой сети")

    guest = await session.scalar(
        select(Guest).where(Guest.id == guest_id, Guest.tenant_id == tenant.id)
    )
    if guest is None or guest.is_blocked:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Гость не найден")

    return {
        "access_token": create_token(guest.id, tenant.id, "access"),
        "refresh_token": create_token(guest.id, tenant.id, "refresh"),
        "token_type": "bearer",
    }


@router.get("/me", summary="Профиль текущего гостя")
async def me(session: SessionDep, tenant: TenantDep, guest: GuestDep) -> ProfileRead:
    account = await loyalty_service.get_account(session, tenant, guest.id)
    if account is None:
        account = await loyalty_service.open_account(session, tenant, guest.id)
        await session.commit()

    tier = loyalty_service.tier_by_code(tenant, account.tier_code)

    return ProfileRead(
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
