"""Пересчёт заказа после правки состава на кассе.

Здесь считаются деньги гостя: что он заплатит и сколько баллов у него
останется. Ошибка стоит либо недобора в кассе, либо баллов из воздуха.
"""

from app.services import order_changes
from app.services.order_changes import ChangeRow


class FakeOrder:
    """Заказ ровно в тех полях, которые читает пересчёт."""

    def __init__(
        self,
        *,
        delivery: int = 0,
        cutlery: int = 0,
        promo: int = 0,
        points_spent: int = 0,
        points_earned: int = 0,
    ) -> None:
        self.delivery_kopecks = delivery
        self.cutlery_kopecks = cutlery
        self.promo_discount_kopecks = promo
        self.points_spent = points_spent
        self.points_earned = points_earned


def row(name: str, quantity: float, total: int) -> ChangeRow:
    return ChangeRow(
        key=name.lower(),
        name=name,
        state="kept",
        quantity=quantity,
        unit_price_kopecks=int(total / quantity) if quantity else total,
        total_kopecks=total,
    )


def test_snyatoe_blyudo_ne_popadaet_v_summu(tenant):
    """Ресторан снял блюдо — гость платит только за оставшееся."""
    pizza = row("Пицца", 1, 100_000)
    salad = row("Салат", 1, 40_000)
    changes = order_changes.compare(
        FakeOrder(),  # type: ignore[arg-type]
        {pizza.key: pizza, salad.key: salad},
        {pizza.key: row("Пицца", 1, 100_000)},
    )

    result = order_changes.recount(tenant, FakeOrder(), changes, 5)  # type: ignore[arg-type]

    assert [(item.name, item.state) for item in changes] == [
        ("Пицца", "kept"),
        ("Салат", "removed"),
    ]
    assert result.subtotal_kopecks == 100_000
    assert result.total_kopecks == 100_000


def test_dobavlennoe_restoranom_uvelichivaet_schet(tenant):
    """Добавили блюдо — оно в списке с пометкой и в сумме."""
    pizza = row("Пицца", 1, 100_000)
    changes = order_changes.compare(
        FakeOrder(),  # type: ignore[arg-type]
        {pizza.key: pizza},
        {pizza.key: row("Пицца", 1, 100_000), "соус": row("Соус", 1, 5_000)},
    )

    result = order_changes.recount(tenant, FakeOrder(), changes, 5)  # type: ignore[arg-type]

    assert changes[-1].state == "added"
    assert changes[-1].name == "Соус"
    assert result.subtotal_kopecks == 105_000


def test_izmenennoe_kolichestvo_pomnit_prezhnee(tenant):
    """Было две пиццы, осталась одна — гость должен видеть обе цифры."""
    pizza = row("Пицца", 2, 200_000)
    changes = order_changes.compare(
        FakeOrder(),  # type: ignore[arg-type]
        {pizza.key: pizza},
        {pizza.key: row("Пицца", 1, 100_000)},
    )

    assert changes[0].state == "changed"
    assert changes[0].was_quantity == 2
    assert changes[0].quantity == 1
    assert changes[0].total_kopecks == 100_000


def test_lishnie_bally_vozvrashchayutsya(tenant):
    """Чек похудел — списание выше половины больше не разрешено.

    Гость списал 600 баллов с чека в 1200 ₽. Ресторан снял блюдо на 600 ₽,
    и потолок в 50 % теперь равен 300 — остальное обязано вернуться.
    """
    pizza = row("Пицца", 1, 60_000)
    salad = row("Салат", 1, 60_000)
    order = FakeOrder(points_spent=600, points_earned=30)

    changes = order_changes.compare(
        order,  # type: ignore[arg-type]
        {pizza.key: pizza, salad.key: salad},
        {pizza.key: row("Пицца", 1, 60_000)},
    )
    result = order_changes.recount(tenant, order, changes, 5)  # type: ignore[arg-type]

    assert result.subtotal_kopecks == 60_000
    assert result.points_spent == 300
    assert result.points_returned == 300
    # 600 ₽ блюд минус 300 ₽ баллами
    assert result.total_kopecks == 30_000


def test_keshbek_schitaetsya_ot_fakticheski_oplachennogo(tenant):
    """Начисляем с денег, а не с первоначальной суммы заказа."""
    pizza = row("Пицца", 1, 100_000)
    order = FakeOrder(points_earned=50)

    changes = order_changes.compare(
        order,  # type: ignore[arg-type]
        {pizza.key: pizza, "салат": row("Салат", 1, 40_000)},
        {pizza.key: row("Пицца", 1, 100_000)},
    )
    result = order_changes.recount(tenant, order, changes, 5)  # type: ignore[arg-type]

    # 1000 ₽ по 5 % — пятьдесят баллов, а не семьдесят за прежний состав
    assert result.points_earned == 50


def test_promokod_ne_bolshe_summy_blyud(tenant):
    """Скидка не может превысить то, что осталось в заказе."""
    pizza = row("Пицца", 1, 20_000)
    order = FakeOrder(promo=50_000)

    changes = order_changes.compare(
        order,  # type: ignore[arg-type]
        {pizza.key: pizza, "салат": row("Салат", 1, 60_000)},
        {pizza.key: row("Пицца", 1, 20_000)},
    )
    result = order_changes.recount(tenant, order, changes, 5)  # type: ignore[arg-type]

    assert result.promo_discount_kopecks == 20_000
    assert result.total_kopecks == 0


def test_dostavka_i_pribory_ostayutsya(tenant):
    """Их ресторан не снимал — они в счёте как были."""
    pizza = row("Пицца", 1, 100_000)
    order = FakeOrder(delivery=20_000, cutlery=3_000)

    changes = order_changes.compare(
        order,  # type: ignore[arg-type]
        {pizza.key: pizza},
        {pizza.key: row("Пицца", 1, 100_000)},
    )
    result = order_changes.recount(tenant, order, changes, 5)  # type: ignore[arg-type]

    assert result.total_kopecks == 123_000
