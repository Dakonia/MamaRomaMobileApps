"""Запись действий сотрудников.

Работает само: перехватчик в `app.main` пишет каждый изменяющий запрос
к админке, забыть про него в новой ручке невозможно. Ручка добавляет
подробность вызовом `describe`, и в журнале рядом с названием действия
появляется строчка вроде «Начислил 500 баллов гостю Иванову».
"""

import logging
from datetime import UTC, datetime, timedelta

from fastapi import Request
from sqlalchemy import delete

from app.core import cache
from app.core.db import SessionLocal
from app.models.audit import StaffAuditLog
from app.models.staff import StaffUser

logger = logging.getLogger(__name__)

KEEP_DAYS = 90
CLEANUP_KEY = "staff-audit:cleanup"

WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# Вход не пишем: там в теле пароль, а сам факт входа виден по «последнему входу»
SKIP_PATHS = frozenset({"/api/v1/admin/login"})


def describe(request: Request, summary: str, object_id: str | None = None) -> None:
    """Уточнить, что именно сделали: строка попадёт в журнал рядом с действием."""
    request.state.audit_summary = summary
    if object_id is not None:
        request.state.audit_object_id = object_id


def client_ip(request: Request) -> str | None:
    """За nginx настоящий адрес приходит заголовком, client.host — это сам прокси."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()[:45]
    return request.client.host if request.client else None


def section_of(path: str) -> str:
    """Раздел админки — первый кусок пути после /admin/."""
    marker = "/admin/"
    if marker not in path:
        return "admin"
    tail = path.split(marker, 1)[1]
    return tail.split("/", 1)[0][:32] or "admin"


async def record(request: Request, staff: StaffUser, status_code: int) -> None:
    """Записать действие. Журнал не должен ронять сам запрос — ошибки глотаем."""
    route = request.scope.get("route")
    title = getattr(route, "summary", None) or request.url.path

    params = request.scope.get("path_params") or {}
    object_id = getattr(request.state, "audit_object_id", None) or next(
        (str(value) for key, value in params.items() if key.endswith("_id")), None
    )

    row = StaffAuditLog(
        tenant_id=staff.tenant_id,
        staff_id=staff.id,
        staff_name=staff.name,
        staff_role=staff.role,
        section=section_of(request.url.path),
        title=str(title)[:160],
        method=request.method,
        path=request.url.path[:200],
        summary=getattr(request.state, "audit_summary", None),
        object_id=object_id[:64] if object_id else None,
        status_code=status_code,
        ip=client_ip(request),
    )

    try:
        async with SessionLocal() as session:
            session.add(row)
            await session.commit()
    except Exception as error:
        logger.warning("Не удалось записать действие в журнал: %s", error)


async def cleanup_old() -> None:
    """Чистка старше 90 дней. Планировщика в проекте нет, поэтому заходим сюда
    при открытии журнала, но не чаще раза в сутки."""
    if await cache.get_json(CLEANUP_KEY):
        return

    await cache.set_json(CLEANUP_KEY, True, 86_400)
    edge = datetime.now(UTC) - timedelta(days=KEEP_DAYS)

    try:
        async with SessionLocal() as session:
            await session.execute(delete(StaffAuditLog).where(StaffAuditLog.created_at < edge))
            await session.commit()
    except Exception as error:
        logger.warning("Не удалось почистить журнал: %s", error)
