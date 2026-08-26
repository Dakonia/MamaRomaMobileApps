using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Resto.Front.Api;
using Resto.Front.Api.Data.Assortment;
using Resto.Front.Api.Data.Brd;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Organization;
using Resto.Front.Api.Data.Security;
using Resto.Front.Api.Editors;
using Reservly.IikoFrontBridge.Collectors;

namespace Reservly.IikoFrontBridge.MamaRoma;

/// <summary>
/// Заводит в iiko доставку, оформленную гостем в приложении.
///
/// Единственное место во всём плагине, которое пишет в iiko, а не читает.
/// Поэтому здесь всё максимально осторожно: любая неудача возвращается наверх
/// отчётом, а не исключением, и ни при каких условиях не мешает работе Reservly.
/// </summary>
internal sealed class DeliveryWriter
{
    private readonly MamaRomaConfig _config;

    public DeliveryWriter(MamaRomaConfig config)
    {
        _config = config;
    }

    public OrderAcceptResult Write(PendingOrder order)
    {
        var result = new OrderAcceptResult
        {
            OrderId = order.OrderId,
            ReportedAt = DateTimeOffset.Now.ToString("O", CultureInfo.InvariantCulture),
        };

        try
        {
            // Отчёт мог не дойти до сервера — тогда он отдаст заказ снова.
            // Ищем его в кассе по внешнему номеру: вторая доставка на кухню
            // хуже любой ошибки связи
            var already = FindExisting(order.OrderId);
            if (already != null)
            {
                result.Status = "accepted";
                result.IikoOrderId = FrontOrderValueReader.ReadString(already, "Id");
                result.IikoOrderNumber = FrontOrderValueReader.ReadString(already, "Number");
                PluginDiagnostics.Info(
                    $"MamaRoma: заказ {order.OrderNumber} уже заведён ранее как {result.IikoOrderNumber}, повтор пропущен."
                );
                return result;
            }

            var isPickup = string.Equals(order.OrderType, "pickup", StringComparison.OrdinalIgnoreCase);

            var orderType = ResolveOrderType(isPickup);
            if (orderType == null)
            {
                result.Status = "failed";
                result.Error = isPickup
                    ? "В iiko не найден тип заказа для самовывоза"
                    : "В iiko не найден тип заказа для доставки курьером";
                return result;
            }

            // Собираем позиции до открытия сессии: если товара нет в номенклатуре,
            // лучше отказаться сразу, чем оставить в iiko недособранный заказ
            var resolved = ResolveItems(order, result.MissingProducts);
            if (result.MissingProducts.Count > 0)
            {
                result.Status = "failed";
                result.Error = "Не найдены товары: " + string.Join(", ", result.MissingProducts);
                return result;
            }
            if (resolved.Count == 0)
            {
                result.Status = "failed";
                result.Error = "В заказе нет позиций";
                return result;
            }

            var deliveryOperator = PluginContext.Operations.GetCurrentUser();
            var expectedAt = ResolveExpectedTime(order);
            var duration = TimeSpan.FromMinutes(
                order.DeliveryMinutes > 0 ? order.DeliveryMinutes : _config.DefaultDeliveryMinutes
            );

            // Самовывоз идёт без адреса — так требует API
            var address = isPickup ? null : BuildAddress(order.Address);

            var editSession = PluginContext.Operations.CreateEditSession();

            // ВНИМАНИЕ ПРИ СБОРКЕ: у CreateDeliveryOrder в V8 две перегрузки,
            // последний параметр bool — сверьте назначение в справочнике SDK
            // перед первым запуском на живом терминале.
            var deliveryOrder = editSession.CreateDeliveryOrder(
                null,                       // номер присвоит сама iiko
                DateTime.Now,
                NormalizePhone(order.Phone),
                address,
                expectedAt,
                orderType,
                null,                       // карточку клиента не создаём: гость уже есть у нас
                deliveryOperator,
                duration,
                false
            );

            var guestName = string.IsNullOrWhiteSpace(order.CustomerName) ? "Гость" : order.CustomerName.Trim();
            var guest = editSession.AddOrderGuest(guestName, deliveryOrder);

            foreach (var item in resolved)
            {
                var addedItem = editSession.AddOrderProductItem(
                    Guid.NewGuid(),
                    item.Amount,
                    item.Product,
                    deliveryOrder,
                    guest,
                    item.Size,
                    OrderItemCourse.First,
                    null                    // цену не навязываем: iiko берёт свою
                );

                foreach (var modifier in item.Modifiers)
                {
                    // Количество модификатора целое: касса считает их штуками.
                    // payableAmount — сколько из них платные, у нас все
                    editSession.AddOrderModifierItem(
                        modifier.Amount,
                        modifier.Product,
                        modifier.Group,
                        deliveryOrder,
                        addedItem,
                        modifier.Amount,
                        null
                    );
                }
            }

            // Имя дублируем отдельным полем: без карточки клиента оператор
            // видит гостя именно здесь
            if (!string.IsNullOrWhiteSpace(order.CustomerName))
            {
                TrySafely(() => editSession.ChangeDeliveryClientName(order.CustomerName.Trim(), deliveryOrder),
                    "ChangeDeliveryClientName");
            }

            if (!string.IsNullOrWhiteSpace(order.Email))
            {
                TrySafely(() => editSession.ChangeDeliveryEmail(order.Email.Trim(), deliveryOrder),
                    "ChangeDeliveryEmail");
            }

            var comment = BuildComment(order);
            if (!string.IsNullOrWhiteSpace(comment))
            {
                TrySafely(() => editSession.ChangeDeliveryComment(comment, deliveryOrder),
                    "ChangeDeliveryComment");
            }

            // Мост для статусов: по внешнему номеру мы потом находим, какому гостю
            // слать пуш. Без него пришлось бы сопоставлять по телефону и времени
            if (!string.IsNullOrWhiteSpace(order.OrderId))
            {
                TrySafely(() => editSession.ChangeOrderExternalNumber(order.OrderId, deliveryOrder),
                    "ChangeOrderExternalNumber");
            }

            // Источник заказа: в отчётах iiko заказы приложения отделятся от
            // сайта и колл-центра. Списка источников API не отдаёт, поэтому
            // код источника берём из настроек — не задан, оставляем как есть
            var source = ResolveMarketingSource();
            if (source != null)
            {
                TrySafely(() => editSession.ChangeDeliveryMarketingSource(deliveryOrder, source),
                    "ChangeDeliveryMarketingSource");
            }

            PluginContext.Operations.SubmitChanges(
                editSession, PluginContext.Operations.GetDefaultCredentials()
            );

            result.Status = "accepted";
            result.IikoOrderId = FrontOrderValueReader.ReadString(deliveryOrder, "Id");
            result.IikoOrderNumber = FrontOrderValueReader.ReadString(deliveryOrder, "Number");

            PluginDiagnostics.Info(
                $"MamaRoma: заказ {order.OrderNumber} заведён в iiko как {result.IikoOrderNumber}."
            );
            return result;
        }
        catch (Exception exc)
        {
            result.Status = "failed";
            result.Error = exc.Message;
            PluginDiagnostics.Error($"MamaRoma: не удалось завести заказ {order.OrderNumber}.", exc);
            return result;
        }
    }

    // ─────────────────────── адрес ───────────────────────

    /// <summary>
    /// Собирает адрес так, как его прочтёт курьер. Координаты намеренно не задаём:
    /// курьеры ездят по названию улицы.
    ///
    /// Line1 — то, по чему находят дом. Line2 — как найти гостя внутри дома.
    /// Отдельные поля заполняем тоже: Line2 видит курьер одной строкой в накладной,
    /// а оператор смотрит на поля в карточке. Дублирование здесь осмысленное.
    /// </summary>
    private static AddressDto BuildAddress(PendingOrderAddress source)
    {
        if (source == null)
        {
            return null;
        }

        var address = new AddressDto
        {
            Line1 = BuildLine1(source),
            Line2 = BuildLine2(source),
            Flat = Trim(source.Flat),
            Entrance = Trim(source.Entrance),
            Floor = Trim(source.Floor),
            Doorphone = Trim(source.Doorphone),
            Index = Trim(source.PostalCode),
            AdditionalInfo = Trim(source.AdditionalInfo),
        };

        // House заполняем и отдельно: часть отчётов iiko смотрит именно на него
        var house = BuildHouse(source);
        if (!string.IsNullOrWhiteSpace(house))
        {
            address.House = house;
        }
        if (!string.IsNullOrWhiteSpace(source.Building))
        {
            address.Building = Trim(source.Building);
        }

        return address;
    }

    /// <summary>«Санкт-Петербург, Невский пр., д. 28, корп. 2, стр. 1»</summary>
    private static string BuildLine1(PendingOrderAddress source)
    {
        var parts = new List<string>();
        Append(parts, source.City);
        Append(parts, source.Street);

        var house = Trim(source.House);
        if (!string.IsNullOrWhiteSpace(house))
        {
            parts.Add("д. " + house);
        }
        if (!string.IsNullOrWhiteSpace(source.Building))
        {
            parts.Add("корп. " + Trim(source.Building));
        }
        // Строения в iiko отдельным полем нет — дописываем в строку адреса
        if (!string.IsNullOrWhiteSpace(source.Construction))
        {
            parts.Add("стр. " + Trim(source.Construction));
        }

        return string.Join(", ", parts);
    }

    /// <summary>«под. 3, эт. 4, кв. 55, домофон 55К»</summary>
    private static string BuildLine2(PendingOrderAddress source)
    {
        var parts = new List<string>();
        AppendLabeled(parts, "под.", source.Entrance);
        AppendLabeled(parts, "эт.", source.Floor);
        AppendLabeled(parts, "кв.", source.Flat);
        AppendLabeled(parts, "домофон", source.Doorphone);
        return string.Join(", ", parts);
    }

    private static string BuildHouse(PendingOrderAddress source)
    {
        var house = Trim(source.House);
        if (string.IsNullOrWhiteSpace(house))
        {
            return string.Empty;
        }
        if (!string.IsNullOrWhiteSpace(source.Construction))
        {
            return house + " стр. " + Trim(source.Construction);
        }
        return house;
    }

    /// <summary>
    /// Комментарий курьеру. Уточнения по адресу дублируем сюда же: курьер
    /// в накладной чаще смотрит на комментарий, чем на поля.
    /// </summary>
    private static string BuildComment(PendingOrder order)
    {
        var parts = new List<string>();
        Append(parts, order.Comment);

        if (order.Address != null && !string.IsNullOrWhiteSpace(order.Address.AdditionalInfo))
        {
            Append(parts, order.Address.AdditionalInfo);
        }

        if (order.PersonsCount > 0)
        {
            Append(parts, $"Приборов: {order.PersonsCount}");
        }

        Append(parts, BuildMoneyLine(order));
        Append(parts, "Заказ из приложения № " + Trim(order.OrderNumber));
        return string.Join(". ", parts);
    }

    /// <summary>
    /// Деньги одной строкой для кассира и курьера. Касса посчитает свою цену,
    /// поэтому наш итог, скидки и сдачу пишем явно: расхождение должно быть
    /// видно до вручения, а не после.
    /// </summary>
    private static string BuildMoneyLine(PendingOrder order)
    {
        var payment = order.Payment;
        if (payment == null)
        {
            return string.Empty;
        }

        var parts = new List<string>();

        var label = string.IsNullOrWhiteSpace(payment.MethodLabel) ? payment.Method : payment.MethodLabel;
        if (payment.IsPaid)
        {
            parts.Add($"ОПЛАЧЕНО в приложении ({label})");
        }
        else if (!string.IsNullOrWhiteSpace(label))
        {
            parts.Add($"К оплате {label}");
        }

        if (payment.TotalKopecks > 0)
        {
            parts.Add($"итого {Money(payment.TotalKopecks)}");
        }

        if (payment.DiscountKopecks > 0)
        {
            var reason = string.IsNullOrWhiteSpace(payment.PromoCode)
                ? "скидка"
                : $"промокод {payment.PromoCode}";
            parts.Add($"{reason} −{Money(payment.DiscountKopecks)}");
        }

        if (payment.PointsSpent > 0)
        {
            parts.Add($"баллами −{Money(payment.PointsSpent)}");
        }

        if (!payment.IsPaid && payment.ChangeFromKopecks > 0)
        {
            parts.Add($"сдача с {Money(payment.ChangeFromKopecks)}");
        }

        return string.Join(", ", parts);
    }

    private static string Money(int kopecks)
    {
        return (kopecks / 100m).ToString("0.##", CultureInfo.InvariantCulture) + " руб";
    }

    /// <summary>
    /// Ищет уже заведённую доставку с этим внешним номером. Смотрим только
    /// свежие: старые заказы с тем же номером взяться неоткуда, а перебирать
    /// весь архив на каждом заказе дорого.
    /// </summary>
    private static object FindExisting(string orderId)
    {
        if (string.IsNullOrWhiteSpace(orderId))
        {
            return null;
        }

        try
        {
            foreach (var candidate in LoadDeliveryOrders())
            {
                var external = FrontOrderValueReader.ReadString(candidate, "ExternalNumber");
                if (string.Equals(external, orderId, StringComparison.OrdinalIgnoreCase))
                {
                    return candidate;
                }
            }
        }
        catch (Exception exc)
        {
            // Не смогли проверить — не блокируем заказ, но говорим об этом
            PluginDiagnostics.Info($"MamaRoma: проверка на повтор не удалась: {exc.Message}");
        }

        return null;
    }

    // ─────────────────────── позиции ───────────────────────

    private sealed class ResolvedItem
    {
        public IProduct Product { get; set; }
        public IProductSize Size { get; set; }
        public decimal Amount { get; set; }
        public List<ResolvedModifier> Modifiers { get; } = new List<ResolvedModifier>();
    }

    private sealed class ResolvedModifier
    {
        public IProduct Product { get; set; }
        public IProductGroup Group { get; set; }

        /// <summary>Касса считает модификаторы штуками, дробных не бывает.</summary>
        public int Amount { get; set; }
    }

    private static List<ResolvedItem> ResolveItems(PendingOrder order, List<string> missing)
    {
        var items = new List<ResolvedItem>();

        foreach (var item in order.Items)
        {
            var product = TryGetProduct(item.ProductId);
            if (product == null)
            {
                missing.Add(Describe(item.Name, item.ProductId));
                continue;
            }

            var resolved = new ResolvedItem
            {
                Product = product,
                Amount = item.Amount > 0 ? item.Amount : 1,
                Size = ResolveSize(product, item.SizeId),
            };

            foreach (var modifier in item.Modifiers)
            {
                var modifierProduct = TryGetProduct(modifier.ProductId);
                if (modifierProduct == null)
                {
                    missing.Add(Describe(modifier.Name, modifier.ProductId));
                    continue;
                }

                resolved.Modifiers.Add(new ResolvedModifier
                {
                    Product = modifierProduct,
                    Group = TryGetProductGroup(modifier.GroupId),
                    Amount = modifier.Amount > 0 ? (int)Math.Round(modifier.Amount) : 1,
                });
            }

            items.Add(resolved);
        }

        return items;
    }

    private static IProduct TryGetProduct(string productId)
    {
        if (!Guid.TryParse(productId, out var id))
        {
            return null;
        }

        try
        {
            return PluginContext.Operations.TryGetProductById(id);
        }
        catch
        {
            return null;
        }
    }

    private static IProductGroup TryGetProductGroup(string groupId)
    {
        if (!Guid.TryParse(groupId, out var id))
        {
            return null;
        }

        try
        {
            return PluginContext.Operations.TryGetProductGroupById(id);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Размер обязателен только у товаров, где он вообще заведён.
    /// Не прислали — берём размер по умолчанию, иначе iiko откажет.
    /// </summary>
    private static IProductSize ResolveSize(IProduct product, string sizeId)
    {
        try
        {
            // Размеры живут не у товара, а у его шкалы: нет шкалы — нет и размеров
            var scale = product.Scale;
            if (scale == null)
            {
                return null;
            }

            if (Guid.TryParse(sizeId, out var id))
            {
                var exact = PluginContext.Operations.TryGetProductSizeById(id);
                if (exact != null)
                {
                    return exact;
                }
            }

            // Размер не назвали или он из чужой шкалы — берём тот, что назначен
            // по умолчанию, иначе первый из шкалы
            if (scale.DefaultSize != null)
            {
                return scale.DefaultSize;
            }

            var sizes = PluginContext.Operations.GetProductScaleSizes(scale);
            return sizes != null && sizes.Count > 0 ? sizes[0] : null;
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info($"MamaRoma: размер товара не определён: {exc.Message}");
            return null;
        }
    }

    // ─────────────────────── прочее ───────────────────────

    /// <summary>
    /// Тип заказа ищем по названию из конфига, а если не задано —
    /// по признаку способа обслуживания.
    /// </summary>
    private IOrderType ResolveOrderType(bool isPickup)
    {
        // Сначала код из настроек: единственный способ получить тип напрямую
        var configuredId = isPickup ? _config.PickupOrderTypeId : _config.DeliveryOrderTypeId;
        if (Guid.TryParse(configuredId, out var id))
        {
            try
            {
                var byId = PluginContext.Operations.TryGetOrderTypeById(id);
                if (byId != null)
                {
                    return byId;
                }
                PluginDiagnostics.Info($"MamaRoma: тип заказа {configuredId} в этой базе не найден.");
            }
            catch (Exception exc)
            {
                PluginDiagnostics.Info($"MamaRoma: тип заказа по коду не получен: {exc.Message}");
            }
        }

        // Списка типов заказов V8 не отдаёт вовсе. Поэтому берём его из уже
        // заведённых доставок: там лежат настоящие типы этой точки
        var name = isPickup ? _config.PickupOrderTypeName : _config.DeliveryOrderTypeName;
        var wanted = isPickup
            ? OrderServiceTypes.DeliveryByClient
            : OrderServiceTypes.DeliveryByCourier;

        IOrderType byService = null;

        foreach (var existing in LoadDeliveryOrders())
        {
            var type = FrontOrderValueReader.ReadProperty(existing, "OrderType") as IOrderType;
            if (type == null || !type.IsActive)
            {
                continue;
            }

            if (!string.IsNullOrWhiteSpace(name)
                && string.Equals(type.Name, name, StringComparison.OrdinalIgnoreCase))
            {
                return type;
            }

            if (byService == null && type.OrderServiceType == wanted)
            {
                byService = type;
            }
        }

        return byService;
    }

    /// <summary>Источник заказа по коду из настроек. Не задан — null.</summary>
    private IMarketingSource ResolveMarketingSource()
    {
        if (!Guid.TryParse(_config.MarketingSourceId, out var id))
        {
            return null;
        }

        try
        {
            return PluginContext.Operations.TryGetMarketingSourceById(id);
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info($"MamaRoma: источник заказа не найден: {exc.Message}");
            return null;
        }
    }

    /// <summary>Доставки этой точки без удалённых. Общий источник для поиска.</summary>
    private static IEnumerable<object> LoadDeliveryOrders()
    {
        try
        {
            var orders = PluginContext.Operations.GetDeliveryOrders(false);
            return orders == null ? Enumerable.Empty<object>() : orders.Cast<object>();
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info($"MamaRoma: список доставок недоступен: {exc.Message}");
            return Enumerable.Empty<object>();
        }
    }

    /// <summary>
    /// Желаемое время. Пусто или в прошлом — «как можно скорее»: ставим
    /// текущее время плюс расчётная длительность, иначе iiko отвергнет заказ
    /// как слишком ранний.
    /// </summary>
    private DateTime ResolveExpectedTime(PendingOrder order)
    {
        var fallbackMinutes = order.DeliveryMinutes > 0
            ? order.DeliveryMinutes
            : _config.DefaultDeliveryMinutes;
        var soonest = DateTime.Now.AddMinutes(fallbackMinutes);

        if (string.IsNullOrWhiteSpace(order.ExpectedDeliveryAt))
        {
            return soonest;
        }

        if (!DateTimeOffset.TryParse(
                order.ExpectedDeliveryAt,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal,
                out var parsed))
        {
            return soonest;
        }

        var local = parsed.ToLocalTime().DateTime;
        return local < soonest ? soonest : local;
    }

    private static string NormalizePhone(string phone)
    {
        return string.IsNullOrWhiteSpace(phone) ? string.Empty : phone.Trim();
    }

    private static string Describe(string name, string productId)
    {
        return string.IsNullOrWhiteSpace(name) ? productId : $"{name} ({productId})";
    }

    private static string Trim(string value)
    {
        return (value ?? string.Empty).Trim();
    }

    private static void Append(List<string> parts, string value)
    {
        var trimmed = Trim(value);
        if (!string.IsNullOrWhiteSpace(trimmed))
        {
            parts.Add(trimmed);
        }
    }

    private static void AppendLabeled(List<string> parts, string label, string value)
    {
        var trimmed = Trim(value);
        if (!string.IsNullOrWhiteSpace(trimmed))
        {
            parts.Add($"{label} {trimmed}");
        }
    }

    /// <summary>
    /// Необязательное поле не должно ронять уже собранный заказ: лучше доставка
    /// без почты, чем отказ целиком.
    /// </summary>
    private static void TrySafely(Action action, string what)
    {
        try
        {
            action();
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info($"MamaRoma: {what} пропущено: {exc.Message}");
        }
    }

}
