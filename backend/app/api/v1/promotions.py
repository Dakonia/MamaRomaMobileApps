from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import or_, select

from app.api.deps import SessionDep, TenantDep
from app.models.promotion import Promotion, promotion_restaurants
from app.schemas.promotion import PromotionRead
from app.services import promotions as promotion_service

router = APIRouter(tags=["Акции"])


@router.get("/promotions", summary="Действующие акции")
async def promotions(
    session: SessionDep,
    tenant: TenantDep,
    restaurant_id: Annotated[UUID | None, Query()] = None,
    in_menu: Annotated[bool | None, Query()] = None,
) -> list[PromotionRead]:
    now = datetime.now(UTC)

    query = select(Promotion).where(
        Promotion.tenant_id == tenant.id,
        Promotion.is_active.is_(True),
        or_(Promotion.starts_at.is_(None), Promotion.starts_at <= now),
        or_(Promotion.ends_at.is_(None), Promotion.ends_at > now),
    )

    # Карусель в меню просит только акции доставки, вкладка «Акции» — все
    if in_menu is not None:
        query = query.where(Promotion.show_in_menu.is_(in_menu))

    # Акция без ресторанов действует везде, со списком — только в них
    if restaurant_id is not None:
        mine = select(promotion_restaurants.c.promotion_id).where(
            promotion_restaurants.c.restaurant_id == restaurant_id
        )
        anywhere = ~select(promotion_restaurants.c.promotion_id).where(
            promotion_restaurants.c.promotion_id == Promotion.id
        ).exists()
        query = query.where(or_(anywhere, Promotion.id.in_(mine)))

    rows = await session.scalars(query.order_by(Promotion.sort_order, Promotion.created_at.desc()))
    return [promotion_service.to_read(row) for row in rows]
