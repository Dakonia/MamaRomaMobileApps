"""Что ресторан изменил в заказе и во сколько это обошлось гостю.

Касса присылает фактический состав заказа. Раньше приложение показывало его
вторым списком, и гость сам сличал две колонки, чтобы понять, что пропало.
Здесь состав сводится в один список с пометками у строк и пересчитанным счётом.

Модуль намеренно без обращений к базе: на вход — заказ, сопоставления и срез
кассы, на выходе — готовые строки и суммы. Так расчёт денег можно проверить
тестами, не поднимая ни кассу, ни очередь.
"""

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from app.core.tenants import Tenant
from app.models.order import Order

ChangeState = Literal["kept", "added", "removed", "changed"]

# Приборы в срезе кассы — отдельная строка, но для гостя это не блюдо:
# он их не выбирал в меню, и в списке состава им не место
CUTLERY_KEY = "__cutlery__"


@dataclass(slots=True)
class ChangeRow:
    """Строка итогового состава: что это, сколько и что с ней стало."""

    key: str
    name: str
    state: ChangeState
    quantity: float
    # Сколько было до правки — заполняем только там, где количество изменилось
    was_quantity: float | None = None
    unit_price_kopecks: int = 0
    total_kopecks: int = 0
    image_url: str | None = None


@dataclass(slots=True)
class OrderChanges:
    """Состав после правки ресторана и пересчитанный счёт."""

    rows: list[ChangeRow] = field(default_factory=list)
    subtotal_kopecks: int = 0
    delivery_kopecks: int = 0
    cutlery_kopecks: int = 0
    promo_discount_kopecks: int = 0
    points_spent: int = 0
    points_earned: int = 0
    total_kopecks: int = 0
    # Сколько баллов вернулось гостю, потому что чек стал меньше
    points_returned: int = 0

    @property
    def has_changes(self) -> bool:
        return any(row.state != "kept" for row in self.rows)


def money(value: float) -> int:
    """Рубли с копейками из кассы — в целые копейки, без потерь на float."""
    return int((Decimal(str(value or 0)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _same(left: float, right: float) -> bool:
    return abs(left - right) < 0.001


def compare(
    order: Order,
    ours: dict[str, ChangeRow],
    theirs: dict[str, ChangeRow],
) -> list[ChangeRow]:
    """Сводит наш состав и кассовый в один список.

    Порядок держим по нашему заказу: гость помнит, в каком порядке складывал
    корзину. Добавленное рестораном идёт следом — это для него новости.
    """
    rows: list[ChangeRow] = []

    for key, mine in ours.items():
        actual = theirs.get(key)

        if actual is None:
            # Цену снятой позиции оставляем: гость должен видеть, чего лишился
            # и на сколько подешевел заказ. В сумму она не попадёт — её
            # отбрасывает пересчёт по признаку состояния
            mine.state = "removed"
            mine.was_quantity = mine.quantity
            rows.append(mine)
            continue

        if _same(mine.quantity, actual.quantity):
            mine.state = "kept"
            mine.total_kopecks = actual.total_kopecks or mine.total_kopecks
            rows.append(mine)
            continue

        mine.state = "changed"
        mine.was_quantity = mine.quantity
        mine.quantity = actual.quantity
        mine.total_kopecks = actual.total_kopecks
        rows.append(mine)

    for key, actual in theirs.items():
        if key in ours:
            continue
        actual.state = "added"
        rows.append(actual)

    return rows


def recount(
    tenant: Tenant,
    order: Order,
    rows: list[ChangeRow],
    cashback_percent: int,
) -> OrderChanges:
    """Пересчитывает счёт по фактическому составу.

    Правила денег здесь ровно те же, что при оформлении, но отсчитываются от
    новой суммы блюд:

    * скидка по промокоду не может быть больше самой суммы блюд;
    * списание баллов не может превышать долю чека из конфига сети — если чек
      похудел, лишние баллы возвращаются гостю;
    * кэшбэк считается от того, что гость платит деньгами.

    Начисленные баллы пересчитываем, но никогда не списываем больше, чем гость
    разрешил при оформлении: ресторан добавил блюдо — гость доплачивает
    деньгами, а не баллами, которые он не соглашался отдавать.
    """
    result = OrderChanges(rows=rows)

    result.subtotal_kopecks = sum(row.total_kopecks for row in rows if row.state != "removed")
    result.delivery_kopecks = order.delivery_kopecks
    result.cutlery_kopecks = order.cutlery_kopecks

    result.promo_discount_kopecks = min(order.promo_discount_kopecks, result.subtotal_kopecks)

    payable = (
        result.subtotal_kopecks
        + result.delivery_kopecks
        + result.cutlery_kopecks
        - result.promo_discount_kopecks
    )
    payable = max(0, payable)

    rate = tenant.loyalty.point_to_ruble_rate
    if rate > 0 and order.points_spent > 0:
        base = result.subtotal_kopecks
        if tenant.loyalty.points_cover_delivery:
            base += result.delivery_kopecks

        cap = max(0, int(base * tenant.loyalty.max_redeem_share_of_check / 100 / rate))
        result.points_spent = min(order.points_spent, cap)
        result.points_returned = order.points_spent - result.points_spent
    else:
        result.points_spent = order.points_spent

    discount = int(result.points_spent * rate * 100)
    result.total_kopecks = max(0, payable - discount)

    # Кэшбэк — процент уровня гостя от денег, которые он платит на самом деле
    result.points_earned = result.total_kopecks // 100 * cashback_percent // 100

    return result
