using System.Collections.Generic;

namespace Reservly.IikoFrontBridge.MamaRoma;

// ─────────────────────── от сервера к плагину ───────────────────────

/// <summary>Ответ на запрос «есть ли новые заказы».</summary>
internal sealed class PendingOrdersResponse
{
    public List<PendingOrder> Orders { get; set; } = new List<PendingOrder>();
}

/// <summary>
/// Заказ, оформленный гостем в приложении. Суммы здесь справочные:
/// чек считает сервер приложения, iiko пересчитает по своим ценам.
/// </summary>
internal sealed class PendingOrder
{
    /// <summary>Идентификатор заказа в базе приложения. По нему отчитываемся обратно.</summary>
    public string OrderId { get; set; } = string.Empty;

    /// <summary>Номер заказа, который видит гость. Уходит во внешний номер заказа iiko.</summary>
    public string OrderNumber { get; set; } = string.Empty;

    /// <summary>delivery — курьером, pickup — самовывоз.</summary>
    public string OrderType { get; set; } = "delivery";

    public string Phone { get; set; } = string.Empty;
    public string CustomerName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;

    /// <summary>Комментарий гостя курьеру и кухне.</summary>
    public string Comment { get; set; } = string.Empty;

    /// <summary>Желаемое время в ISO-8601. Пусто — как можно скорее.</summary>
    public string ExpectedDeliveryAt { get; set; } = string.Empty;

    /// <summary>Сколько минут закладывать на доставку. 0 — берём значение из конфига.</summary>
    public int DeliveryMinutes { get; set; }

    /// <summary>Откуда пришёл заказ: попадает в источник заказа в отчётах iiko.</summary>
    public string MarketingSource { get; set; } = string.Empty;

    /// <summary>Сколько приборов положить. 0 — гость снял их в корзине.</summary>
    public int PersonsCount { get; set; }

    /// <summary>Деньги: чем платит гость, оплачено ли уже и из чего сложился итог.</summary>
    public PendingOrderPayment Payment { get; set; } = new PendingOrderPayment();

    public PendingOrderAddress Address { get; set; } = new PendingOrderAddress();
    public List<PendingOrderItem> Items { get; set; } = new List<PendingOrderItem>();
}

/// <summary>
/// Оплата заказа. Касса считает свою цену по прайсу, поэтому итог приложения
/// передаём отдельно: расхождение должно быть видно кассиру сразу, а не
/// всплывать при вручении.
/// </summary>
internal sealed class PendingOrderPayment
{
    /// <summary>cash_on_delivery, card_on_delivery, online_sbp, online_card.</summary>
    public string Method { get; set; } = string.Empty;

    /// <summary>То же самое по-русски: это уходит в комментарий кассиру.</summary>
    public string MethodLabel { get; set; } = string.Empty;

    /// <summary>Деньги уже получены приложением — курьеру платить не нужно.</summary>
    public bool IsPaid { get; set; }

    public string Status { get; set; } = string.Empty;

    /// <summary>С какой суммы готовить сдачу. 0 — гость не просил.</summary>
    public int ChangeFromKopecks { get; set; }

    public int SubtotalKopecks { get; set; }
    public int DeliveryKopecks { get; set; }
    public int CutleryKopecks { get; set; }
    public int DiscountKopecks { get; set; }
    public string PromoCode { get; set; } = string.Empty;
    public int PromoDiscountKopecks { get; set; }
    public int PointsSpent { get; set; }
    public int PointsEarned { get; set; }

    /// <summary>Сколько гость должен по нашему расчёту.</summary>
    public int TotalKopecks { get; set; }
}

/// <summary>
/// Адрес по частям — так, как его ввёл гость. Координаты намеренно не передаём:
/// курьеры ездят по названию улицы, а не по точке на карте.
/// </summary>
internal sealed class PendingOrderAddress
{
    public string City { get; set; } = string.Empty;
    public string Street { get; set; } = string.Empty;
    public string House { get; set; } = string.Empty;

    /// <summary>Корпус.</summary>
    public string Building { get; set; } = string.Empty;

    /// <summary>Строение — в iiko отдельного поля нет, дописываем к дому.</summary>
    public string Construction { get; set; } = string.Empty;

    public string Flat { get; set; } = string.Empty;
    public string Entrance { get; set; } = string.Empty;
    public string Floor { get; set; } = string.Empty;
    public string Doorphone { get; set; } = string.Empty;
    public string PostalCode { get; set; } = string.Empty;

    /// <summary>Всё, что не легло в поля: «во дворе», «звонить за 10 минут».</summary>
    public string AdditionalInfo { get; set; } = string.Empty;

    /// <summary>Комментарий к сохранённому адресу: подъезд со двора, охрана и т.п.</summary>
    public string Comment { get; set; } = string.Empty;

    /// <summary>Адрес одной строкой — как его видит гость в приложении.</summary>
    public string FullText { get; set; } = string.Empty;
}

internal sealed class PendingOrderItem
{
    /// <summary>Код товара в iiko. Сопоставление ведёт сервер приложения.</summary>
    public string ProductId { get; set; } = string.Empty;

    /// <summary>Код размера, если у товара их несколько. Обычно пусто.</summary>
    public string SizeId { get; set; } = string.Empty;

    public decimal Amount { get; set; } = 1;

    /// <summary>Название на случай, если товар в iiko не найден — попадёт в отчёт об ошибке.</summary>
    public string Name { get; set; } = string.Empty;

    public List<PendingOrderModifier> Modifiers { get; set; } = new List<PendingOrderModifier>();
}

internal sealed class PendingOrderModifier
{
    public string ProductId { get; set; } = string.Empty;

    /// <summary>Код группы модификаторов, если модификатор групповой.</summary>
    public string GroupId { get; set; } = string.Empty;

    public decimal Amount { get; set; } = 1;
    public string Name { get; set; } = string.Empty;
}

// ─────────────────────── от плагина к серверу ───────────────────────

/// <summary>Чем закончилась попытка завести заказ в iiko.</summary>
internal sealed class OrderAcceptResult
{
    public string OrderId { get; set; } = string.Empty;

    /// <summary>accepted — заказ создан, failed — не вышло.</summary>
    public string Status { get; set; } = string.Empty;

    /// <summary>Внутренний идентификатор заказа в iiko.</summary>
    public string IikoOrderId { get; set; } = string.Empty;

    /// <summary>Номер, который iiko присвоила заказу.</summary>
    public string IikoOrderNumber { get; set; } = string.Empty;

    /// <summary>Текст ошибки для менеджера, если не вышло.</summary>
    public string Error { get; set; } = string.Empty;

    /// <summary>
    /// Позиции, которых не нашлось в номенклатуре. Пустой список при удачном заказе.
    /// Если непусто — сопоставление блюд разъехалось, это видно сразу.
    /// </summary>
    public List<string> MissingProducts { get; set; } = new List<string>();

    public string ReportedAt { get; set; } = string.Empty;
}

internal sealed class OrderAcceptBatch
{
    public string RestaurantId { get; set; } = string.Empty;
    public List<OrderAcceptResult> Results { get; set; } = new List<OrderAcceptResult>();
}

/// <summary>Стоп-лист точки в терминах приложения.</summary>
internal sealed class StopListSnapshot
{
    public string RestaurantId { get; set; } = string.Empty;
    public string CapturedAt { get; set; } = string.Empty;

    /// <summary>По каким правилам собрано — чтобы на сервере было видно, почему блюдо скрыто.</summary>
    public bool StopOnRemainingAmount { get; set; }
    public decimal RemainingAmountThreshold { get; set; }

    public List<StopListEntry> Items { get; set; } = new List<StopListEntry>();
}

internal sealed class StopListEntry
{
    public string ProductId { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public string SizeId { get; set; } = string.Empty;

    /// <summary>Остаток порций по данным iiko.</summary>
    public decimal RemainingAmount { get; set; }

    /// <summary>Касса запрещает продажу — формальный стоп-лист.</summary>
    public bool IsRestricted { get; set; }

    /// <summary>
    /// Итоговое решение: прятать блюдо в приложении.
    /// Считается из IsRestricted и правила по остатку.
    /// </summary>
    public bool IsStopped { get; set; }

    /// <summary>restricted или low_remaining — почему скрыли.</summary>
    public string Reason { get; set; } = string.Empty;
}

/// <summary>Номенклатура точки для сопоставления с меню приложения.</summary>
internal sealed class MenuSnapshot
{
    public string RestaurantId { get; set; } = string.Empty;
    public string CapturedAt { get; set; } = string.Empty;
    public string SchemaVersion { get; set; } = string.Empty;
    public List<MenuProduct> Products { get; set; } = new List<MenuProduct>();
}

internal sealed class MenuProduct
{
    public string ProductId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string GroupName { get; set; } = string.Empty;
    public string GroupPath { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string MeasureUnit { get; set; } = string.Empty;
    public bool IsActive { get; set; }

    /// <summary>
    /// Вид товара в кассе: Dish — блюдо, Goods — товар, Modifier — добавка.
    /// Остальное (заготовки, услуги, тарифы) в продажу не идёт.
    /// </summary>
    public string Type { get; set; } = string.Empty;

    /// <summary>Есть ли у товара размеры — тогда в заказе нужен ещё и код размера.</summary>
    public bool HasSizes { get; set; }
}

/// <summary>Состояние заказов, заведённых через нас: для статусов гостю.</summary>
internal sealed class DeliveryStatusSnapshot
{
    public string RestaurantId { get; set; } = string.Empty;
    public string CapturedAt { get; set; } = string.Empty;
    public List<DeliveryStatusEntry> Orders { get; set; } = new List<DeliveryStatusEntry>();
}

internal sealed class DeliveryStatusEntry
{
    /// <summary>Наш идентификатор — из внешнего номера заказа iiko.</summary>
    public string OrderId { get; set; } = string.Empty;

    public string IikoOrderId { get; set; } = string.Empty;
    public string IikoOrderNumber { get; set; } = string.Empty;

    /// <summary>Значение DeliveryStatus как есть.</summary>
    public string Status { get; set; } = string.Empty;

    // Временные метки — по ним считаются этапы, которые видит гость.
    // На V8 «готовим» и «готово» берутся именно отсюда, а не из статуса.
    public string ConfirmedAt { get; set; } = string.Empty;
    public string PrintedAt { get; set; } = string.Empty;
    public string CookingFinishedAt { get; set; } = string.Empty;
    public string SentAt { get; set; } = string.Empty;
    public string DeliveredAt { get; set; } = string.Empty;
    public string CancelledAt { get; set; } = string.Empty;

    /// <summary>Прогноз готовности — можно показать гостю ожидаемое время.</summary>
    public string PredictedCookingCompleteAt { get; set; } = string.Empty;

    public bool HasProblem { get; set; }
    public string ProblemComment { get; set; } = string.Empty;
    public string CancelCause { get; set; } = string.Empty;
    public string CancelComment { get; set; } = string.Empty;
    public string CourierName { get; set; } = string.Empty;
    public List<DeliveryStatusItem> Items { get; set; } = new List<DeliveryStatusItem>();
}

/// <summary>Фактическая позиция заказа в iiko после ручных правок на кассе.</summary>
internal sealed class DeliveryStatusItem
{
    public string ProductId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public decimal Price { get; set; }
    public decimal NetSum { get; set; }
    public string GroupName { get; set; } = string.Empty;
    public string GroupPath { get; set; } = string.Empty;
}
