"""Удаление аккаунта: требование Apple и право на забвение по ФЗ-152.

Проверяем главное: личных данных не остаётся, войти под аккаунтом нельзя,
а номер телефона освобождается для новой регистрации.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.guest import Guest, GuestAddress
from app.models.loyalty import LoyaltyAccount
from app.services.guest import delete_account


async def test_udalenie_stiraet_lichnye_dannye(session: AsyncSession, tenant, guest, city):
    session.add(
        GuestAddress(
            tenant_id=tenant.id,
            guest_id=guest.id,
            city_id=city.id,
            street="Невский пр.",
            house="1",
        )
    )
    await session.commit()

    phone = guest.phone
    await delete_account(session, tenant, guest)

    assert guest.name is None
    assert guest.email is None
    assert guest.deleted_at is not None
    assert guest.is_blocked is True
    assert guest.phone != phone, "номер должен освободиться под новую регистрацию"

    addresses = (
        await session.scalars(select(GuestAddress).where(GuestAddress.guest_id == guest.id))
    ).all()
    accounts = (
        await session.scalars(select(LoyaltyAccount).where(LoyaltyAccount.guest_id == guest.id))
    ).all()

    assert addresses == [], "адреса должны удаляться"
    assert accounts == [], "балльный счёт должен удаляться"


async def test_nomer_svoboden_posle_udaleniya(session: AsyncSession, tenant, guest):
    phone = guest.phone
    await delete_account(session, tenant, guest)

    same_phone = await session.scalar(
        select(Guest).where(
            Guest.tenant_id == tenant.id, Guest.phone == phone, Guest.deleted_at.is_(None)
        )
    )

    assert same_phone is None, "по прежнему номеру заводится новый аккаунт"


async def test_api_udalyaet_akkaunt(client, guest, session: AsyncSession):
    response = await client.delete("/api/v1/me")

    assert response.status_code == 204

    await session.refresh(guest)
    assert guest.deleted_at is not None
