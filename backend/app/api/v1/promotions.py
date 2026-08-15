from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import or_, select

from app.api.deps import SessionDep, TenantDep
from app.models.promotion import Promotion
from app.schemas.promotion import PromotionRead

router = APIRouter(tags=["Акции"])


@router.get("/promotions", summary="Действующие акции")
async def promotions(
    session: SessionDep,
    tenant: TenantDep,
    restaurant_id: Annotated[UUID | None, Query()] = None,
) -> list[PromotionRead]:
    now = datetime.now(UTC)

    query = select(Promotion).where(
        Promotion.tenant_id == tenant.id,
        Promotion.is_active.is_(True),
        or_(Promotion.starts_at.is_(None), Promotion.starts_at <= now),
        or_(Promotion.ends_at.is_(None), Promotion.ends_at > now),
    )

    # Акция без ресторана действует везде, с рестораном — только в нём
    if restaurant_id is not None:
        query = query.where(
            or_(Promotion.restaurant_id.is_(None), Promotion.restaurant_id == restaurant_id)
        )

    rows = await session.scalars(query.order_by(Promotion.sort_order, Promotion.created_at.desc()))
    return [PromotionRead.model_validate(row) for row in rows]
