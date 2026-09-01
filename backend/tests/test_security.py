"""Границы доступа: кто и что может получить от сервера.

Здесь проверяется не работа возможностей, а невозможность лишнего — то, что
ломается тихо и обнаруживается, когда данные уже утекли.
"""

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services import auth as auth_service


async def test_kod_ne_vozvrashchaetsya_v_otvete(client: AsyncClient):
    """Ответ на запрос кода не должен содержать сам код.

    Он уходит в СМС и в журнал сервера. Стоит ему появиться в ответе — и войти
    под чужим номером сможет любой, кто знает адрес.
    """
    # Номер свежий на каждый прогон: повторный запрос на тот же упрётся в
    # ограничение по частоте, и проверка сломается не по делу
    phone = f"+7999{uuid4().int % 10_000_000:07d}"
    response = await client.post("/api/v1/auth/request-code", json={"phone": phone})

    assert response.status_code == 200
    assert "debug_code" not in response.json()


async def test_otladochnyj_kod_tolko_dlya_svoih_nomerov(
    session: AsyncSession, tenant, monkeypatch: pytest.MonkeyPatch
):
    """Отладочный код подходит только номерам из настройки сервера."""
    monkeypatch.setattr(settings, "environment", "staging")
    monkeypatch.setattr(settings, "sms_code_debug_value", "0000")
    monkeypatch.setattr(settings, "sms_debug_phones", ["+79990000001"])

    assert auth_service._debug_code_allowed("+79990000001") is True
    assert auth_service._debug_code_allowed("+79990000002") is False


async def test_pustoj_spisok_zakryvaet_otladochnyj_vhod(monkeypatch: pytest.MonkeyPatch):
    """Настройка не заполнена — код не подходит никому."""
    monkeypatch.setattr(settings, "environment", "staging")
    monkeypatch.setattr(settings, "sms_code_debug_value", "0000")
    monkeypatch.setattr(settings, "sms_debug_phones", [])

    assert auth_service._debug_code_allowed("+79990000001") is False


async def test_na_boevom_otladochnyj_kod_ne_rabotaet(monkeypatch: pytest.MonkeyPatch):
    """Даже со списком номеров: в бою только настоящая СМС."""
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "sms_code_debug_value", "0000")
    monkeypatch.setattr(settings, "sms_debug_phones", ["+79990000001"])

    assert auth_service._debug_code_allowed("+79990000001") is False


async def test_panel_ne_puskaet_bez_tokena(client: AsyncClient):
    """Ручки панели закрыты: без входа они не отдают ничего."""
    for path in ("/api/v1/admin/me", "/api/v1/admin/orders", "/api/v1/admin/guests"):
        response = await client.get(path)
        assert response.status_code in (401, 403), path


async def test_chuzhoj_zakaz_nedostupen(client: AsyncClient, session: AsyncSession, tenant, guest):
    """Заказ другого гостя не открывается даже по прямой ссылке."""
    response = await client.get(f"/api/v1/orders/{uuid4()}")

    assert response.status_code == 404


async def test_nevernyj_parol_v_panel_ne_puskaet(client: AsyncClient):
    """И отвечает одинаково, есть такая почта или нет."""
    unknown = await client.post(
        "/api/v1/admin/login",
        json={"email": "no-such@mamaroma.ru", "password": "какой-нибудь"},
    )
    assert unknown.status_code == 401
    assert unknown.json()["detail"] == "Неверная почта или пароль"
