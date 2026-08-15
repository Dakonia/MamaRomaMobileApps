from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenants import LoyaltyTier, Tenant
from app.models.enums import LoyaltyOperation
from app.models.loyalty import LoyaltyAccount, LoyaltyTransaction


def base_tier(tenant: Tenant) -> LoyaltyTier:
    return min(tenant.loyalty.tiers, key=lambda tier: tier.threshold_rub)


def tier_by_code(tenant: Tenant, code: str) -> LoyaltyTier:
    for tier in tenant.loyalty.tiers:
        if tier.code == code:
            return tier
    return base_tier(tenant)


async def open_account(
    session: AsyncSession,
    tenant: Tenant,
    guest_id: UUID,
) -> LoyaltyAccount:
    """Заводит счёт гостя и сразу начисляет приветственные баллы.

    Размер бонуса и срок сгорания берём из конфига тенанта, а не из констант.
    """
    account = LoyaltyAccount(
        tenant_id=tenant.id,
        guest_id=guest_id,
        tier_code=base_tier(tenant).code,
        points_balance=0,
    )
    session.add(account)
    await session.flush()

    welcome = tenant.loyalty.welcome_bonus
    if welcome > 0:
        account.points_balance = welcome
        session.add(
            LoyaltyTransaction(
                tenant_id=tenant.id,
                account_id=account.id,
                operation=LoyaltyOperation.WELCOME,
                points=welcome,
                balance_after=welcome,
                expires_at=datetime.now(UTC)
                + timedelta(days=tenant.loyalty.points_expire_after_days),
                comment="Приветственные баллы",
            )
        )

    return account


async def get_account(
    session: AsyncSession,
    tenant: Tenant,
    guest_id: UUID,
) -> LoyaltyAccount | None:
    account: LoyaltyAccount | None = await session.scalar(
        select(LoyaltyAccount).where(
            LoyaltyAccount.tenant_id == tenant.id,
            LoyaltyAccount.guest_id == guest_id,
        )
    )
    return account
