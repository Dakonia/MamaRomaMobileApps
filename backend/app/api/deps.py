from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import cache
from app.core.config import settings
from app.core.db import get_session
from app.core.permissions import WEB_ADMIN_ROLES, Permission, permissions_for
from app.core.security import InvalidTokenError, decode_token
from app.core.tenants import Tenant, get_tenant
from app.models.guest import Guest
from app.models.staff import StaffUser

bearer = HTTPBearer(auto_error=False)

# «Сейчас в админке» — отметка в Redis, которую продлевает каждый запрос сотрудника
ONLINE_PREFIX = "staff-online:"
ONLINE_TTL_SECONDS = 300

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
    if guest is None or guest.is_blocked or guest.deleted_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Гость не найден")

    return guest


GuestDep = Annotated[Guest, Depends(get_current_guest)]


async def get_current_staff(
    request: Request,
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

    if staff.role not in WEB_ADMIN_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Эта роль не работает в админке")

    await mark_seen(request, staff)

    return staff


StaffDep = Annotated[StaffUser, Depends(get_current_staff)]


def staff_permissions(staff: StaffUser) -> frozenset[Permission]:
    return permissions_for(staff.role, staff.permissions)


async def mark_seen(request: Request, staff: StaffUser) -> None:
    """Отметить сотрудника: кто сделал запрос и что он сейчас в админке.

    Ставится в `require`, через который проходит каждая защищённая ручка, —
    так журнал не зависит от того, как именно получен сотрудник.
    """
    request.state.staff = staff
    await cache.set_json(
        f"{ONLINE_PREFIX}{staff.tenant_id}:{staff.id}", True, ONLINE_TTL_SECONDS
    )


def require(*needed: Permission) -> Callable[..., Awaitable[StaffUser]]:
    """Ручка требует всех перечисленных прав.

    Ставится рядом со `StaffDep`, а не вместо него: сотрудник в теле ручки
    по-прежнему нужен, чтобы записать, кто выполнил действие.
    """

    async def guard(request: Request, staff: StaffDep) -> StaffUser:
        # Роль может иметь права и всё же не работать в вебе: у курьера свой
        # набор для приложения, но админка не его место
        if staff.role not in WEB_ADMIN_ROLES:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Эта роль не работает в админке")

        await mark_seen(request, staff)
        granted = staff_permissions(staff)
        missing = [item for item in needed if item not in granted]
        if missing:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Недостаточно прав для этого действия",
            )
        return staff

    return guard
