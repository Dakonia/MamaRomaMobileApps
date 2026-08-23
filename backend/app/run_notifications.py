"""Отправка запланированных рассылок и прогон сценариев.

Запускается по расписанию раз в несколько минут. Сам решает, что уже пора
отправлять, а что ждёт своего часа или тихих часов.
"""

import asyncio
from datetime import UTC, datetime

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.tenants import get_tenant
from app.models.enums import CampaignStatus
from app.models.notification import Automation, Campaign
from app.services import campaign as campaign_service

TENANT_ID = "mamaroma"


async def main() -> None:
    tenant = get_tenant(TENANT_ID)

    async with SessionLocal() as session:
        # Рассылки, у которых подошло время
        due = list(
            await session.scalars(
                select(Campaign).where(
                    Campaign.tenant_id == TENANT_ID,
                    Campaign.status == CampaignStatus.SCHEDULED,
                    Campaign.scheduled_at.is_not(None),
                    Campaign.scheduled_at <= datetime.now(UTC),
                )
            )
        )

        for item in due:
            sent = await campaign_service.send_campaign(session, tenant, item)
            print(f"рассылка «{item.name}»: отправлено {sent}")

        # Сценарии проверяем каждый прогон: дни рождения и молчуны находятся сами
        rules = list(
            await session.scalars(
                select(Automation).where(
                    Automation.tenant_id == TENANT_ID, Automation.is_enabled.is_(True)
                )
            )
        )

        for rule in rules:
            sent = await campaign_service.run_automation(session, tenant, rule)
            if sent:
                print(f"сценарий «{rule.trigger}»: отправлено {sent}")


if __name__ == "__main__":
    asyncio.run(main())
