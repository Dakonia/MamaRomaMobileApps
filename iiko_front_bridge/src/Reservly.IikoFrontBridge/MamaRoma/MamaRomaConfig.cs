using System;

namespace Reservly.IikoFrontBridge.MamaRoma;

/// <summary>
/// Настройки интеграции с мобильным приложением сети. Живут отдельной секцией
/// в bridge.settings.json, чтобы правки здесь не задевали отправку в Reservly.
/// Секции нет или Enabled = false — ни один код ниже не исполняется.
/// </summary>
internal sealed class MamaRomaConfig
{
    public bool Enabled { get; set; }

    /// <summary>Корень ручек приложения, например https://api.mamaroma.ru/api/v1/integrations/iiko</summary>
    public string BackendUrl { get; set; } = string.Empty;

    /// <summary>Общий секрет, уходит заголовком. Свой, не тот, что у Reservly.</summary>
    public string Secret { get; set; } = string.Empty;

    /// <summary>
    /// Идентификатор ресторана в базе приложения. Плагин стоит в конкретной точке,
    /// и сервер по этому полю понимает, чей стоп-лист приехал и чьи заказы отдавать.
    /// </summary>
    public string RestaurantId { get; set; } = string.Empty;

    // ─────────────── заказы ───────────────

    /// <summary>Забирать ли заказы с сервера и заводить их в iiko.</summary>
    public bool AcceptDeliveries { get; set; } = true;

    /// <summary>Как часто спрашивать сервер про новые заказы.</summary>
    public int DeliveryPollIntervalSeconds { get; set; } = 20;

    /// <summary>
    /// Название типа заказа для курьерской доставки — ровно как заведено в iiko.
    /// Пусто — берём первый тип с признаком доставки.
    /// </summary>
    public string DeliveryOrderTypeName { get; set; } = string.Empty;

    /// <summary>То же для самовывоза.</summary>
    public string PickupOrderTypeName { get; set; } = string.Empty;

    /// <summary>Сколько минут закладывать на доставку, если сервер не прислал своё.</summary>
    public int DefaultDeliveryMinutes { get; set; } = 60;

    /// <summary>
    /// Сколько заказов забирать за один заход. Ограничение на случай,
    /// если связь пропадала надолго и очередь накопилась.
    /// </summary>
    public int DeliveryBatchSize { get; set; } = 10;

    // ─────────────── стоп-лист ───────────────

    public bool SyncStopList { get; set; } = true;

    public int StopListIntervalMinutes { get; set; } = 1;

    /// <summary>
    /// Считать ли блюдо недоступным по остатку, а не только по формальному стопу.
    /// В iiko это разные вещи: повар может выставить остаток и не ставить стоп —
    /// тогда касса продавать не запрещает, а гость в приложении об этом не знает.
    /// </summary>
    public bool StopOnRemainingAmount { get; set; } = true;

    /// <summary>
    /// Порог остатка. Остаток меньше либо равен этому числу — блюдо уходит в стоп.
    /// 0 — только когда порций совсем не осталось. 5 — прячем заранее,
    /// чтобы последние порции разошлись в зале, а не ушли в доставку.
    /// Работает, только если StopOnRemainingAmount = true.
    /// </summary>
    public decimal RemainingAmountThreshold { get; set; }

    // ─────────────── меню ───────────────

    /// <summary>
    /// Выгружать номенклатуру: коды, названия, цены, группы. Нужно один раз для
    /// сопоставления блюд приложения с товарами iiko, дальше — чтобы ловить
    /// переименования и новые позиции.
    /// </summary>
    public bool SyncMenu { get; set; } = true;

    public int MenuIntervalMinutes { get; set; } = 360;

    /// <summary>Выгружать ли снятые с продажи товары. Обычно не нужно.</summary>
    public bool MenuIncludeInactive { get; set; }

    // ─────────────── статусы ───────────────

    /// <summary>Отдавать ли приложению состояние заказов, заведённых через нас.</summary>
    public bool SyncDeliveryStatus { get; set; } = true;

    public int DeliveryStatusIntervalSeconds { get; set; } = 30;

    /// <summary>
    /// За сколько часов назад смотреть заказы при отдаче статусов.
    /// Больше суток держать смысла нет — заказ давно закрыт.
    /// </summary>
    public int DeliveryStatusLookbackHours { get; set; } = 12;

    public void Normalize()
    {
        BackendUrl = (BackendUrl ?? string.Empty).Trim().TrimEnd('/');
        Secret = (Secret ?? string.Empty).Trim();
        RestaurantId = (RestaurantId ?? string.Empty).Trim();
        DeliveryOrderTypeName = (DeliveryOrderTypeName ?? string.Empty).Trim();
        PickupOrderTypeName = (PickupOrderTypeName ?? string.Empty).Trim();

        if (DeliveryPollIntervalSeconds < 10) DeliveryPollIntervalSeconds = 10;
        if (DeliveryStatusIntervalSeconds < 10) DeliveryStatusIntervalSeconds = 10;
        if (StopListIntervalMinutes < 1) StopListIntervalMinutes = 1;
        if (MenuIntervalMinutes < 5) MenuIntervalMinutes = 5;
        if (DefaultDeliveryMinutes < 5) DefaultDeliveryMinutes = 5;
        if (DeliveryBatchSize < 1) DeliveryBatchSize = 1;
        if (DeliveryBatchSize > 50) DeliveryBatchSize = 50;
        if (RemainingAmountThreshold < 0) RemainingAmountThreshold = 0;
        if (DeliveryStatusLookbackHours < 1) DeliveryStatusLookbackHours = 1;
        if (DeliveryStatusLookbackHours > 72) DeliveryStatusLookbackHours = 72;
    }

    /// <summary>
    /// Готова ли секция к работе. Неполная настройка — это выключенная интеграция,
    /// а не ошибка запуска: плагин обязан подняться и продолжить работу с Reservly.
    /// </summary>
    public bool IsUsable(out string reason)
    {
        if (!Enabled)
        {
            reason = "выключено флагом enabled";
            return false;
        }
        if (string.IsNullOrWhiteSpace(BackendUrl))
        {
            reason = "не задан backendUrl";
            return false;
        }
        if (string.IsNullOrWhiteSpace(Secret))
        {
            reason = "не задан secret";
            return false;
        }
        if (string.IsNullOrWhiteSpace(RestaurantId))
        {
            reason = "не задан restaurantId";
            return false;
        }

        reason = string.Empty;
        return true;
    }
}
