"""Бронь стола: слоты только в рабочие часы и не в прошлом."""

from datetime import date, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.reservation import ReservationError, list_slots


async def test_sloty_vnutri_rabochih_chasov(session: AsyncSession, tenant, restaurant):
    slots = await list_slots(session, tenant, restaurant.id, date.today() + timedelta(days=1))

    assert slots, "на завтра должны быть свободные слоты"

    opens = restaurant.opens_at.strftime("%H:%M")
    closes = restaurant.closes_at.strftime("%H:%M")

    for slot in slots:
        assert opens <= slot.label <= closes, f"слот {slot.label} вне часов {opens}–{closes}"


async def test_v_proshlom_brony_net(session: AsyncSession, tenant, restaurant):
    """Вчерашнюю дату сервер отклоняет, а не отдаёт пустой список."""
    with pytest.raises(ReservationError):
        await list_slots(session, tenant, restaurant.id, date.today() - timedelta(days=1))


async def test_slishkom_daleko_ne_broniruem(session: AsyncSession, tenant, restaurant):
    with pytest.raises(ReservationError):
        await list_slots(session, tenant, restaurant.id, date.today() + timedelta(days=400))
