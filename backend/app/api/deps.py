from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.core.security import InvalidTokenError, decode_token
from app.core.tenants import Tenant, get_tenant
from app.models.guest import Guest
from app.models.staff import StaffUser

bearer = HTTPBearer(auto_error=False)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def get_current_tenant(
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> Tenant:
    """Тенант приходит заголовком, а не телом запроса.

    Иначе клиент сможет подменить его в любом POST и прочитать чужую сеть.
    """
    try:
        return get_tenant(x_tenant_id or settings.default_tenant_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


TenantDep = Annotated[Tenant, Depends(get_current_tenant)]


async def get_current_guest(
    session: SessionDep,
    tenant: TenantDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)] = None,
) -> Guest:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужен вход в приложение")

    try:
        guest_id, token_tenant = decode_token(credentials.credentials, "access")
    except InvalidTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc

    if token_tenant != tenant.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Токен выдан для другой сети")

    guest = await session.scalar(
        select(Guest).where(Guest.id == guest_id, Guest.tenant_id == tenant.id)
    )
    if guest is None or guest.is_blocked:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Гость не найден")

    return guest


GuestDep = Annotated[Guest, Depends(get_current_guest)]


async def get_current_staff(
    session: SessionDep,
    tenant: TenantDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)] = None,
) -> StaffUser:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужен вход в админку")

    try:
        staff_id, token_tenant = decode_token(credentials.credentials, "staff")
    except InvalidTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc

    if token_tenant != tenant.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Токен выдан для другой сети")

    staff = await session.scalar(
        select(StaffUser).where(StaffUser.id == staff_id, StaffUser.tenant_id == tenant.id)
    )
    if staff is None or not staff.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сотрудник не найден")

    return staff


StaffDep = Annotated[StaffUser, Depends(get_current_staff)]
