"""Что плагин присылает и что получает в ответ.

Имена полей в camelCase — так их шлёт плагин на C#. Внутри работаем
со snake_case, перевод делают псевдонимы.
"""

from pydantic import BaseModel, ConfigDict, Field


class _Incoming(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


# ─────────────────────────── ответы ───────────────────────────


class SyncResult(BaseModel):
    """Сколько записей обработали. Плагин это только логирует."""

    applied: int = 0
    added: int = 0
    removed: int = 0


class PendingOrdersOut(BaseModel):
    orders: list[dict[str, object]] = Field(default_factory=list)


# ─────────────────────────── заказы ───────────────────────────


class OrderAckResult(_Incoming):
    order_id: str = Field(alias="orderId")

    # accepted — заказ заведён, failed — не вышло
    status: str = ""

    iiko_order_id: str = Field(default="", alias="iikoOrderId")
    iiko_order_number: str = Field(default="", alias="iikoOrderNumber")
    error: str = ""

    # Товары, которых не нашлось в номенклатуре кассы. Непусто — значит
    # сопоставление блюд разъехалось, повторять попытку бессмысленно
    missing_products: list[str] = Field(default_factory=list, alias="missingProducts")


class OrderAckIn(_Incoming):
    restaurant_id: str = Field(default="", alias="restaurantId")
    results: list[OrderAckResult] = Field(default_factory=list)


# ─────────────────────────── стоп-лист ───────────────────────────


class StopListItemIn(_Incoming):
    product_id: str = Field(default="", alias="productId")
    product_name: str = Field(default="", alias="productName")
    size_id: str = Field(default="", alias="sizeId")
    remaining_amount: float = Field(default=0, alias="remainingAmount")

    # Касса запрещает продажу — формальный стоп-лист
    is_restricted: bool = Field(default=False, alias="isRestricted")

    # Итоговое решение плагина: прятать блюдо в приложении.
    # Считается из is_restricted и настройки порога остатка
    is_stopped: bool = Field(default=False, alias="isStopped")

    # restricted или low_remaining — почему скрыли
    reason: str = ""


class StopListIn(_Incoming):
    restaurant_id: str = Field(default="", alias="restaurantId")
    captured_at: str = Field(default="", alias="capturedAt")
    stop_on_remaining_amount: bool = Field(default=False, alias="stopOnRemainingAmount")
    remaining_amount_threshold: float = Field(default=0, alias="remainingAmountThreshold")
    items: list[StopListItemIn] = Field(default_factory=list)


# ─────────────────────────── номенклатура ───────────────────────────


class MenuProductIn(_Incoming):
    product_id: str = Field(default="", alias="productId")
    name: str = ""
    code: str = ""
    group_name: str = Field(default="", alias="groupName")
    group_path: str = Field(default="", alias="groupPath")
    category: str = ""
    measure_unit: str = Field(default="", alias="measureUnit")
    product_type: str = Field(default="", alias="type")
    is_active: bool = Field(default=True, alias="isActive")

    # У товара есть размеры — в заказе для него обязателен код размера
    has_sizes: bool = Field(default=False, alias="hasSizes")


class MenuIn(_Incoming):
    restaurant_id: str = Field(default="", alias="restaurantId")
    captured_at: str = Field(default="", alias="capturedAt")
    products: list[MenuProductIn] = Field(default_factory=list)


# ─────────────────────────── статусы ───────────────────────────


class DeliveryStatusOrderIn(_Incoming):
    """Состояние одного заказа на кухне.

    Этап для гостя считается по меткам времени, а не по строке статуса:
    на кассе версии V8 отдельных статусов «готовим» и «готово» нет.
    """

    order_id: str = Field(default="", alias="orderId")
    iiko_order_id: str = Field(default="", alias="iikoOrderId")
    iiko_order_number: str = Field(default="", alias="iikoOrderNumber")
    status: str = ""

    confirmed_at: str = Field(default="", alias="confirmedAt")

    # Позиции ушли на кухню — с этого момента показываем «готовим»
    printed_at: str = Field(default="", alias="printedAt")

    cooking_finished_at: str = Field(default="", alias="cookingFinishedAt")
    sent_at: str = Field(default="", alias="sentAt")
    delivered_at: str = Field(default="", alias="deliveredAt")
    cancelled_at: str = Field(default="", alias="cancelledAt")
    predicted_cooking_complete_at: str = Field(default="", alias="predictedCookingCompleteAt")

    has_problem: bool = Field(default=False, alias="hasProblem")
    problem_comment: str = Field(default="", alias="problemComment")
    cancel_cause: str = Field(default="", alias="cancelCause")
    courier_name: str = Field(default="", alias="courierName")


class DeliveryStatusIn(_Incoming):
    restaurant_id: str = Field(default="", alias="restaurantId")
    captured_at: str = Field(default="", alias="capturedAt")
    orders: list[DeliveryStatusOrderIn] = Field(default_factory=list)
