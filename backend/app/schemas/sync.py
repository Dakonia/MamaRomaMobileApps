from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class SyncChangeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    action: str
    title: str
    summary: str
    group: str | None
    external_id: str
    payload: dict[str, Any]
    applied: bool


class SyncRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    kind: str
    title: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    applied_at: datetime | None
    unchanged: int
    created: int
    updated: int
    removed: int
    message: str | None
    changes: list[SyncChangeRead] = []


class SyncApply(BaseModel):
    """Что именно записать. Пусто — не записываем ничего."""

    change_ids: list[UUID] = []
