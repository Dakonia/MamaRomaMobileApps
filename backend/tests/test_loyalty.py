"""Баллы: потолок списания и переход между уровнями.

Это те расчёты, ошибка в которых стоит денег напрямую — гость либо спишет
больше, чем можно, либо получит не тот процент кэшбэка.
"""

from app.services.order import _tier_for_spend, max_points_to_spend


def test_spisanie_ogranicheno_dolej_cheka(tenant):
    """Списать можно не больше половины чека, даже если баллов много."""
    limit = max_points_to_spend(tenant, balance=100_000, subtotal_kopecks=100_000)

    assert limit == 500, "с чека в 1000 ₽ списываем не больше 500 баллов"


def test_spisanie_ogranicheno_balansom(tenant):
    """Баллов меньше потолка — спишем ровно столько, сколько есть."""
    limit = max_points_to_spend(tenant, balance=120, subtotal_kopecks=100_000)

    assert limit == 120


def test_dostavka_vhodit_v_bazu_spisaniya(tenant):
    """Флаг тенанта решает, можно ли гасить баллами доставку."""
    without = max_points_to_spend(tenant, balance=100_000, subtotal_kopecks=100_000)
    with_delivery = max_points_to_spend(
        tenant, balance=100_000, subtotal_kopecks=100_000, delivery_kopecks=20_000
    )

    if tenant.loyalty.points_cover_delivery:
        assert with_delivery > without
    else:
        assert with_delivery == without


def test_uroven_rastet_po_summe_pokupok(tenant):
    """Новичок — базовый уровень, потративший много — верхний."""
    top = max(tenant.loyalty.tiers, key=lambda tier: tier.threshold_rub)

    lowest = _tier_for_spend(tenant, 0)
    highest = _tier_for_spend(tenant, (top.threshold_rub + 1000) * 100)

    assert lowest.code == tenant.loyalty.tiers[0].code
    assert highest.cashback_percent >= lowest.cashback_percent
    assert highest.code == top.code


def test_uroven_ne_pereskakivaet_cherez_porog(tenant):
    """На рубль ниже порога уровень ещё прежний."""
    second = sorted(tenant.loyalty.tiers, key=lambda tier: tier.threshold_rub)[1]

    just_below = _tier_for_spend(tenant, second.threshold_rub * 100 - 100)
    exactly = _tier_for_spend(tenant, second.threshold_rub * 100)

    assert just_below.code != second.code
    assert exactly.code == second.code
