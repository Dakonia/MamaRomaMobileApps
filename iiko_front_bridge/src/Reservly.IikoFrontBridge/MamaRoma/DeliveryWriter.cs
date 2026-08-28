using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Resto.Front.Api;
using Resto.Front.Api.Data.Assortment;
using Resto.Front.Api.Data.Brd;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Organization;
using Resto.Front.Api.Data.Search;
using Resto.Front.Api.Data.Security;
using Resto.Front.Api.Editors;
using Resto.Front.Api.Editors.Stubs;
using Reservly.IikoFrontBridge.Collectors;
using System.Text.RegularExpressions;

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
    private static readonly Guid EmptyLineAddressStreetId = Guid.Parse("f8aaf1ec-8f46-907f-9357-e4c27bab5f78");
    private const string OrderExternalDataKey = "mamaroma.orderId";
    private const string OrderOriginName = "Мобильное";
    private const string OrderSourceTitle = "Мобильное приложение";

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
            var already = FindExisting(order);
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
            // лучше отказаться сразу, чем оставить в iiko недособранный заказ.
            // Если в настройках задан аварийный товар, неизвестные позиции
            // заводим им с явным комментарием менеджеру.
            var unresolved = new List<string>();
            var resolved = ResolveItems(order, unresolved, result.MissingProducts);
            if (unresolved.Count > 0)
            {
                result.Status = "failed";
                result.Error = "Не найдены товары: " + string.Join(", ", unresolved);
                return result;
            }
            if (resolved.Count == 0)
            {
                result.Status = "failed";
                result.Error = "В заказе нет позиций";
                return result;
            }
            if (result.MissingProducts.Count > 0)
            {
                result.Error = "Использованы аварийные позиции: " + string.Join(", ", result.MissingProducts);
            }

            var deliveryOperator = PluginContext.Operations.GetCurrentUser();
            var expectedAt = ResolveExpectedTime(order);
            var duration = TimeSpan.FromMinutes(
                order.DeliveryMinutes > 0 ? order.DeliveryMinutes : _config.DefaultDeliveryMinutes
            );

            // Самовывоз идёт без адреса — так требует API
            var address = isPickup ? null : BuildAddress(order);

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
                    OrderItemCourse.Default,
                    item.PredefinedPrice
                );

                if (!string.IsNullOrWhiteSpace(item.CustomName))
                {
                    TrySafely(() => editSession.SetProductItemCustomName(
                            TrimTo(item.CustomName, 80),
                            deliveryOrder,
                            addedItem),
                        "SetProductItemCustomName");
                }

                if (!string.IsNullOrWhiteSpace(item.Comment))
                {
                    TrySafely(() => editSession.ChangeOrderItemComment(
                            TrimTo(item.Comment, 255),
                            deliveryOrder,
                            addedItem),
                        "ChangeOrderItemComment");
                }

                var addedModifierKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var addedGroupAmounts = new Dictionary<Guid, int>();
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
                    MarkModifierAdded(
                        addedModifierKeys,
                        addedGroupAmounts,
                        modifier.Product,
                        modifier.Group,
                        modifier.Amount
                    );
                }

                AddDefaultAndMandatoryModifiers(
                    editSession,
                    deliveryOrder,
                    addedItem,
                    item.Product,
                    addedModifierKeys,
                    addedGroupAmounts
                );
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

            var comment = BuildComment(order, result.MissingProducts);
            if (!string.IsNullOrWhiteSpace(comment))
            {
                TrySafely(() => editSession.ChangeDeliveryComment(comment, deliveryOrder),
                    "ChangeDeliveryComment");
            }

            TrySafely(() => editSession.ChangeOrderOriginName(OrderOriginName, deliveryOrder),
                "ChangeOrderOriginName");

            // Видимый внешний номер: без технического UUID, чтобы менеджер видел
            // человеческое происхождение заказа.
            var externalNumber = BuildExternalNumber(order);
            if (!string.IsNullOrWhiteSpace(externalNumber))
            {
                TrySafely(() => editSession.ChangeOrderExternalNumber(externalNumber, deliveryOrder),
                    "ChangeOrderExternalNumber");
            }

            // Скрытый мост для статусов и защиты от дублей. iiko хранит его только
            // в iikoFront во время жизни заказа, наружу менеджеру не показывает.
            if (!string.IsNullOrWhiteSpace(order.OrderId))
            {
                TrySafely(() => editSession.AddOrderExternalData(OrderExternalDataKey, order.OrderId, false, deliveryOrder),
                    "AddOrderExternalData");
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
    /// Line1 — то, по чему находят дом. Подъезд, этаж, квартира и домофон
    /// идут в отдельные поля iiko. Line2 используем только как запасную строку,
    /// если какое-то значение пришлось укоротить перед отправкой.
    /// </summary>
    private static AddressDto BuildAddress(PendingOrder order)
    {
        var source = order?.Address;
        if (source == null)
        {
            return null;
        }

        var line2Fallback = new List<string>();
        var address = new AddressDto
        {
            Line1 = BuildLine1(source),
            Flat = AddressWindowValue(source.Flat, "кв.", 50, line2Fallback),
            Entrance = AddressWindowValue(source.Entrance, "под.", 30, line2Fallback),
            Floor = AddressWindowValue(source.Floor, "эт.", 20, line2Fallback),
            Doorphone = AddressWindowValue(source.Doorphone, "домофон", 50, line2Fallback),
            Index = Trim(source.PostalCode),
            AdditionalInfo = BuildNotes(order),
        };
        address.Line2 = string.Join(", ", line2Fallback);

        if (UseLineAddressFormat())
        {
            address.StreetId = EmptyLineAddressStreetId;
            address.House = string.Empty;
            address.Building = string.Empty;
            PluginDiagnostics.Info("MamaRoma: адрес доставки передан в новом формате iiko Line1.");
            return address;
        }

        var street = ResolveStreet(source);
        if (street != null)
        {
            address.StreetId = street.Id;
            PluginDiagnostics.Info(
                $"MamaRoma: улица доставки «{source.Street}» сопоставлена с iiko «{street.Name}» ({street.Id})."
            );
        }
        else
        {
            var defaultStreet = ResolveDefaultStreet();
            if (defaultStreet != null)
            {
                address.StreetId = defaultStreet.Id;
                PluginDiagnostics.Info(
                    $"MamaRoma: улица доставки «{source.Street}» не найдена, адрес передан строкой Line1 через улицу iiko «{defaultStreet.Name}» ({defaultStreet.Id})."
                );
            }
            else if (!string.IsNullOrWhiteSpace(source.Street))
            {
                address.StreetId = EmptyLineAddressStreetId;
                PluginDiagnostics.Info(
                    $"MamaRoma: улица доставки «{source.Street}» не найдена в iiko, используем пустую улицу iiko ({EmptyLineAddressStreetId})."
                );
            }
        }

        // House заполняем и отдельно: часть отчётов iiko смотрит именно на него
        var house = BuildHouse(source);
        if (!string.IsNullOrWhiteSpace(house))
        {
            address.House = TrimTo(house, 20);
        }
        if (!string.IsNullOrWhiteSpace(source.Building))
        {
            // Поле в iiko короткое: «литер Д» уже не помещается целиком,
            // поэтому пишем сжато — «лит.Д», «к.2», «стр.3»
            address.Building = TrimTo(BuildingShort(source.Building), 10);
        }

        return address;
    }

    private static bool UseLineAddressFormat()
    {
        try
        {
            var restaurant = PluginContext.Operations.GetHostRestaurant();
            var settings = FrontOrderValueReader.ReadProperty(restaurant, "AddressShowTypeSettings");
            if (settings == null)
            {
                return false;
            }

            var useNewFormat = ReadBool(settings, "UseNewFormat");
            var addressShowType = FrontOrderValueReader.ReadString(settings, "AddressShowType");
            return useNewFormat
                   || string.Equals(addressShowType, "City", StringComparison.OrdinalIgnoreCase)
                   || string.Equals(addressShowType, "International", StringComparison.OrdinalIgnoreCase)
                   || string.Equals(addressShowType, "NoPostCode", StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info($"MamaRoma: настройки формата адреса iiko не прочитаны: {exc.Message}");
            return false;
        }
    }

    /// <summary>
    /// iikoFront требует StreetId из справочника улиц даже когда адрес передан
    /// строкой Line1. Приложение отдаёт человеческое название, поэтому ищем
    /// улицу локально на терминале и терпимо относимся к сокращениям.
    /// </summary>
    private static IStreet ResolveStreet(PendingOrderAddress source)
    {
        var raw = Trim(source?.Street);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var expected = NormalizeStreetName(raw);
        if (string.IsNullOrWhiteSpace(expected))
        {
            return null;
        }

        var candidates = new Dictionary<Guid, IStreet>();

        foreach (var query in StreetSearchQueries(raw))
        {
            try
            {
                var found = PluginContext.Operations.SearchStreets(
                    query,
                    SearchType.Prefix,
                    StreetFields.Name,
                    null
                );
                AddStreetCandidates(candidates, found);
            }
            catch (Exception exc)
            {
                PluginDiagnostics.Info($"MamaRoma: поиск улицы «{query}» не удался: {exc.Message}");
            }
        }

        var exact = candidates.Values.FirstOrDefault(
            street => NormalizeStreetName(street.Name) == expected
        );
        if (exact != null)
        {
            return exact;
        }

        try
        {
            AddStreetCandidates(candidates, PluginContext.Operations.GetActiveStreets());
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info($"MamaRoma: список активных улиц iiko не получен: {exc.Message}");
        }

        return candidates.Values
            .Where(street => NormalizeStreetName(street.Name) == expected)
            .OrderBy(street => street.Name.Length)
            .FirstOrDefault();
    }

    private static IStreet ResolveDefaultStreet()
    {
        try
        {
            return PluginContext.Operations.GetActiveStreets()
                .FirstOrDefault(street =>
                {
                    var name = Trim(street.Name);
                    return name.Length > 0 && name.All(ch => ch == '-' || ch == '—' || char.IsWhiteSpace(ch));
                });
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info($"MamaRoma: стандартная улица iiko не найдена: {exc.Message}");
            return null;
        }
    }

    private static void AddStreetCandidates(
        IDictionary<Guid, IStreet> target,
        IEnumerable<IStreet> streets
    )
    {
        if (streets == null)
        {
            return;
        }

        foreach (var street in streets)
        {
            if (street != null && !target.ContainsKey(street.Id))
            {
                target[street.Id] = street;
            }
        }
    }

    private static IEnumerable<string> StreetSearchQueries(string street)
    {
        var raw = Trim(street);
        var core = StreetCore(raw);
        var queries = new[]
        {
            raw,
            core,
            "проспект " + core,
            "пр-кт " + core,
            core + " проспект",
            core + " пр-кт",
        };

        return queries
            .Select(Trim)
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Distinct(StringComparer.OrdinalIgnoreCase);
    }

    private static string StreetCore(string value)
    {
        return NormalizeStreetName(value);
    }

    private static string NormalizeStreetName(string value)
    {
        var normalized = Trim(value).ToLowerInvariant().Replace('ё', 'е');
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return string.Empty;
        }

        normalized = normalized
            .Replace("пр-кт", " ")
            .Replace("просп.", " ")
            .Replace("пр.", " ")
            .Replace("ул.", " ")
            .Replace("наб.", " ")
            .Replace("ш.", " ");
        normalized = Regex.Replace(
            normalized,
            @"\b(проспект|просп|пр|улица|ул|набережная|наб|шоссе|ш|переулок|пер|аллея|ал|бульвар|бул|площадь|пл)\b",
            " "
        );
        normalized = Regex.Replace(normalized, @"[^0-9a-zа-я]+", " ");
        return string.Join(" ", normalized.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries));
    }

    /// <summary>
    /// Разбирает значение корпуса на слово и остаток: «литер Д» → («лит», «Д»),
    /// «корпус 2» → («корп», «2»), «5» → («корп», «5»).
    ///
    /// В адресах сети встречается и корпус, и строение, и литера, а гость
    /// пишет их как придётся: «лит. Д», «литера Д», «литД».
    /// </summary>
    private static (string word, string value) SplitBuilding(string raw)
    {
        var text = Trim(raw);
        if (string.IsNullOrWhiteSpace(text))
        {
            return (string.Empty, string.Empty);
        }

        var lowered = text.ToLowerInvariant();

        foreach (var known in BuildingWords)
        {
            if (!lowered.StartsWith(known.prefix, StringComparison.Ordinal))
            {
                continue;
            }

            var rest = text.Substring(known.prefix.Length).TrimStart('.', ' ', '-', '№');
            if (!string.IsNullOrWhiteSpace(rest))
            {
                return (known.word, rest.Trim());
            }
        }

        return ("корп", text);
    }

    /// <summary>
    /// Слова, которыми в адресах называют вторую часть дома. Порядок важен:
    /// длинные написания идут первыми, иначе «литера Д» разберётся как
    /// «литер» плюс «а Д».
    /// </summary>
    private static readonly (string prefix, string word)[] BuildingWords =
    {
        ("литера", "лит"),
        ("литер", "лит"),
        ("лит", "лит"),
        ("строение", "стр"),
        ("стр", "стр"),
        ("корпус", "корп"),
        ("корп", "корп"),
        ("кор", "корп"),
        ("к", "корп"),
    };

    /// <summary>«лит.Д», «к.2» — короткая запись для узкого поля кассы.</summary>
    private static string BuildingShort(string raw)
    {
        var (word, value) = SplitBuilding(raw);
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var shortWord = word == "корп" ? "к" : word;
        return shortWord + "." + value;
    }

    /// <summary>«корп. 2», «лит. Д» — как это читает курьер в накладной.</summary>
    private static string BuildingForHuman(string raw)
    {
        var (word, value) = SplitBuilding(raw);
        return string.IsNullOrWhiteSpace(value) ? string.Empty : word + ". " + value;
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
            // «корп. литер Д» — бессмыслица на накладной: слово подбираем
            // по самому значению, а если оно уже названо, не дублируем
            parts.Add(BuildingForHuman(source.Building));
        }
        // Строения в iiko отдельным полем нет — дописываем в строку адреса
        if (!string.IsNullOrWhiteSpace(source.Construction))
        {
            parts.Add("стр. " + Trim(source.Construction));
        }

        return string.Join(", ", parts);
    }

    private static string AddressWindowValue(
        string value,
        string label,
        int maxLength,
        List<string> fallbackParts
    )
    {
        var trimmed = Trim(value);
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return string.Empty;
        }

        var safe = trimmed.Length <= maxLength ? trimmed : trimmed.Substring(0, maxLength);
        if (!string.Equals(safe, trimmed, StringComparison.Ordinal))
        {
            fallbackParts.Add(label + " " + trimmed);
        }

        return safe;
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

    /// <summary>Комментарий к заказу: сначала оплата, затем текст гостя.</summary>
    private static string BuildComment(PendingOrder order, IEnumerable<string> fallbackItems)
    {
        var parts = new List<string>();
        Append(parts, BuildMoneyLine(order));
        Append(parts, order.Comment);
        Append(parts, order.Address == null ? string.Empty : order.Address.Comment);
        Append(parts, BuildFallbackSummary(fallbackItems));
        return TrimTo(string.Join(". ", parts), 1000);
    }

    private static string BuildFallbackSummary(IEnumerable<string> fallbackItems)
    {
        if (fallbackItems == null)
        {
            return string.Empty;
        }

        var items = fallbackItems
            .Select(Trim)
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return items.Count == 0
            ? string.Empty
            : "ВНИМАНИЕ: не найдены позиции, добавлен аварийный товар: " + string.Join("; ", items);
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

        var method = Trim(payment.Method).ToLowerInvariant();
        if (payment.IsPaid)
        {
            if (method == "online_sbp")
            {
                return "Оплачено в приложении: СБП";
            }
            return "Оплачено в приложении";
        }

        if (method == "cash_on_delivery")
        {
            return payment.ChangeFromKopecks > 0
                ? $"Наличные с {Money(payment.ChangeFromKopecks)}"
                : "Наличные";
        }

        if (method == "card_on_delivery")
        {
            return "Оплата картой";
        }

        if (method == "online_sbp")
        {
            return "Оплата СБП";
        }

        if (method == "online_card")
        {
            return "Оплата картой онлайн";
        }

        var label = string.IsNullOrWhiteSpace(payment.MethodLabel) ? payment.Method : payment.MethodLabel;
        return string.IsNullOrWhiteSpace(label) ? string.Empty : "Оплата " + label;
    }

    private static string BuildNotes(PendingOrder order)
    {
        var parts = new List<string>();
        Append(parts, string.IsNullOrWhiteSpace(order?.MarketingSource) ? OrderSourceTitle : order.MarketingSource);

        var payment = order?.Payment;
        if (payment != null)
        {
            if (payment.PointsSpent > 0)
            {
                parts.Add("Списано баллов: " + payment.PointsSpent);
            }
            if (payment.PointsEarned > 0)
            {
                parts.Add("Начислено баллов: " + payment.PointsEarned);
            }
            if (payment.DiscountKopecks > 0)
            {
                var discount = "Скидка: " + Money(payment.DiscountKopecks);
                if (!string.IsNullOrWhiteSpace(payment.PromoCode))
                {
                    discount += " по промокоду " + payment.PromoCode;
                }
                parts.Add(discount);
            }
        }

        return string.Join(". ", parts);
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
    private static string BuildExternalNumber(PendingOrder order)
    {
        var number = Trim(order?.OrderNumber);
        return string.IsNullOrWhiteSpace(number) ? OrderOriginName : OrderOriginName + " " + number;
    }

    private static object FindExisting(PendingOrder order)
    {
        var orderId = Trim(order?.OrderId);
        var externalNumber = BuildExternalNumber(order);
        if (string.IsNullOrWhiteSpace(orderId))
        {
            return null;
        }

        try
        {
            foreach (var candidate in LoadDeliveryOrders())
            {
                var storedOrderId = ReadOrderExternalData(candidate, OrderExternalDataKey);
                if (string.Equals(storedOrderId, orderId, StringComparison.OrdinalIgnoreCase))
                {
                    return candidate;
                }

                var external = FrontOrderValueReader.ReadString(candidate, "ExternalNumber");
                if (string.Equals(external, orderId, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(external, externalNumber, StringComparison.OrdinalIgnoreCase))
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

    private static string ReadOrderExternalData(object order, string key)
    {
        try
        {
            var frontOrder = order as IOrder;
            if (frontOrder == null)
            {
                return string.Empty;
            }
            return PluginContext.Operations.TryGetOrderExternalDataByKey(frontOrder, key) ?? string.Empty;
        }
        catch
        {
            return string.Empty;
        }
    }

    // ─────────────────────── позиции ───────────────────────

    private sealed class ResolvedItem
    {
        public IProduct Product { get; set; }
        public IProductSize Size { get; set; }
        public decimal Amount { get; set; }
        public decimal? PredefinedPrice { get; set; }
        public string CustomName { get; set; } = string.Empty;
        public string Comment { get; set; } = string.Empty;
        public List<ResolvedModifier> Modifiers { get; } = new List<ResolvedModifier>();
    }

    private sealed class ResolvedModifier
    {
        public IProduct Product { get; set; }
        public IProductGroup Group { get; set; }

        /// <summary>Касса считает модификаторы штуками, дробных не бывает.</summary>
        public int Amount { get; set; }
    }

    private List<ResolvedItem> ResolveItems(
        PendingOrder order,
        List<string> missing,
        List<string> fallbackWarnings
    )
    {
        var items = new List<ResolvedItem>();

        foreach (var item in order.Items)
        {
            var product = TryGetProduct(item.ProductId);
            if (product == null)
            {
                var description = Describe(item.Name, item.ProductId);
                var fallback = ResolveMissingProductFallback(description, item.Amount);
                if (fallback == null)
                {
                    missing.Add(description);
                    continue;
                }

                fallbackWarnings.Add(description);
                items.Add(fallback);
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
                    var description = Describe(modifier.Name, modifier.ProductId);
                    var fallback = ResolveMissingProductFallback(description, modifier.Amount);
                    if (fallback == null)
                    {
                        missing.Add(description);
                        continue;
                    }

                    fallbackWarnings.Add(description);
                    items.Add(fallback);
                    continue;
                }

                resolved.Modifiers.Add(new ResolvedModifier
                {
                    Product = modifierProduct,
                    Group = ResolveModifierGroup(product, modifierProduct, TryGetProductGroup(modifier.GroupId)),
                    Amount = modifier.Amount > 0 ? (int)Math.Round(modifier.Amount) : 1,
                });
            }

            items.Add(resolved);
        }

        AppendCutlery(order, missing, fallbackWarnings, items);
        return items;
    }

    private ResolvedItem ResolveMissingProductFallback(string description, decimal amount)
    {
        if (string.IsNullOrWhiteSpace(_config.MissingProductFallbackProductId))
        {
            return null;
        }

        var product = TryGetProduct(_config.MissingProductFallbackProductId);
        if (product == null)
        {
            PluginDiagnostics.Info(
                $"MamaRoma: аварийный товар «{_config.MissingProductFallbackProductName}» не найден в iiko ({_config.MissingProductFallbackProductId})."
            );
            return null;
        }

        var fallbackName = string.IsNullOrWhiteSpace(_config.MissingProductFallbackProductName)
            ? "Аварийная позиция"
            : _config.MissingProductFallbackProductName;

        return new ResolvedItem
        {
            Product = product,
            Amount = amount > 0 ? amount : 1,
            Size = ResolveSize(product, _config.MissingProductFallbackProductSizeId),
            PredefinedPrice = 0m,
            CustomName = "НЕ НАЙДЕНО: " + description,
            Comment = $"Аварийная замена через «{fallbackName}». Нужно вручную заменить на: {description}",
        };
    }

    private void AppendCutlery(
        PendingOrder order,
        List<string> missing,
        List<string> fallbackWarnings,
        List<ResolvedItem> items
    )
    {
        if (order.PersonsCount <= 0 || order.Payment == null || order.Payment.CutleryKopecks <= 0)
        {
            return;
        }

        var name = string.IsNullOrWhiteSpace(_config.CutleryProductName)
            ? "Приборы"
            : _config.CutleryProductName;

        if (string.IsNullOrWhiteSpace(_config.CutleryProductId))
        {
            var description = $"{name} (не задан cutleryProductId)";
            var fallback = ResolveMissingProductFallback(description, order.PersonsCount);
            if (fallback == null)
            {
                missing.Add(description);
                return;
            }

            fallbackWarnings.Add(description);
            items.Add(fallback);
            return;
        }

        var product = TryGetProduct(_config.CutleryProductId);
        if (product == null)
        {
            var description = Describe(name, _config.CutleryProductId);
            var fallback = ResolveMissingProductFallback(description, order.PersonsCount);
            if (fallback == null)
            {
                missing.Add(description);
                return;
            }

            fallbackWarnings.Add(description);
            items.Add(fallback);
            return;
        }

        items.Add(new ResolvedItem
        {
            Product = product,
            Amount = order.PersonsCount,
            Size = ResolveSize(product, _config.CutleryProductSizeId),
            PredefinedPrice = CutleryUnitPrice(order),
        });
    }

    private static decimal CutleryUnitPrice(PendingOrder order)
    {
        if (order.Payment == null || order.PersonsCount <= 0 || order.Payment.CutleryKopecks <= 0)
        {
            return 0m;
        }

        return decimal.Round(order.Payment.CutleryKopecks / 100m / order.PersonsCount, 2);
    }

    private static void AddDefaultAndMandatoryModifiers(
        IEditSession editSession,
        IOrderStub deliveryOrder,
        IOrderProductItemStub addedItem,
        IProduct product,
        ISet<string> alreadyAddedKeys,
        IDictionary<Guid, int> addedGroupAmounts
    )
    {
        AddDefaultAndMandatorySimpleModifiers(
            editSession,
            deliveryOrder,
            addedItem,
            product,
            alreadyAddedKeys
        );
        AddDefaultAndMandatoryGroupModifiers(
            editSession,
            deliveryOrder,
            addedItem,
            product,
            alreadyAddedKeys,
            addedGroupAmounts
        );
    }

    private static void AddDefaultAndMandatorySimpleModifiers(
        IEditSession editSession,
        IOrderStub deliveryOrder,
        IOrderProductItemStub addedItem,
        IProduct product,
        ISet<string> alreadyAddedKeys
    )
    {
        IReadOnlyList<ISimpleModifier> modifiers;
        try
        {
            modifiers = PluginContext.Operations.GetSimpleModifiers(product, null);
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info(
                $"MamaRoma: обязательные модификаторы для «{product.Name}» не прочитаны: {exc.Message}"
            );
            return;
        }

        foreach (var modifier in modifiers ?? Enumerable.Empty<ISimpleModifier>())
        {
            var amount = Math.Max(modifier.MinimumAmount, modifier.DefaultAmount);
            if (amount <= 0 || modifier.Product == null || !alreadyAddedKeys.Add(ModifierKey(modifier.Product, null)))
            {
                continue;
            }

            var payableAmount = PayableAmount(amount, modifier.FreeOfChargeAmount);
            editSession.AddOrderModifierItem(
                amount,
                modifier.Product,
                null,
                deliveryOrder,
                addedItem,
                payableAmount,
                null
            );

            PluginDiagnostics.Info(
                $"MamaRoma: к «{product.Name}» добавлен обязательный модификатор iiko «{modifier.Product.Name}» x{amount}."
            );
        }
    }

    private static void AddDefaultAndMandatoryGroupModifiers(
        IEditSession editSession,
        IOrderStub deliveryOrder,
        IOrderProductItemStub addedItem,
        IProduct product,
        ISet<string> alreadyAddedKeys,
        IDictionary<Guid, int> addedGroupAmounts
    )
    {
        IReadOnlyList<IGroupModifier> groups;
        try
        {
            groups = PluginContext.Operations.GetGroupModifiers(product, null);
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info(
                $"MamaRoma: групповые модификаторы для «{product.Name}» не прочитаны: {exc.Message}"
            );
            return;
        }

        foreach (var group in groups ?? Enumerable.Empty<IGroupModifier>())
        {
            if (group.ProductGroup == null)
            {
                continue;
            }

            var groupId = group.ProductGroup.Id;
            var addedAmount = addedGroupAmounts.TryGetValue(groupId, out var current) ? current : 0;

            foreach (var child in group.Items ?? Enumerable.Empty<IChildModifier>())
            {
                var amount = Math.Max(child.MinimumAmount, child.DefaultAmount);
                if (amount <= 0 || child.Product == null)
                {
                    continue;
                }

                if (AddGroupModifier(
                        editSession,
                        deliveryOrder,
                        addedItem,
                        group,
                        child,
                        amount,
                        alreadyAddedKeys,
                        addedGroupAmounts))
                {
                    addedAmount += amount;
                }
            }

            addedAmount = addedGroupAmounts.TryGetValue(groupId, out current) ? current : addedAmount;
            if (group.MinimumAmount <= 0 || addedAmount >= group.MinimumAmount)
            {
                continue;
            }

            var candidates = (group.Items ?? Enumerable.Empty<IChildModifier>())
                .Where(child => child.Product != null && !alreadyAddedKeys.Contains(ModifierKey(child.Product, group.ProductGroup)))
                .ToList();
            if (candidates.Count == 1)
            {
                AddGroupModifier(
                    editSession,
                    deliveryOrder,
                    addedItem,
                    group,
                    candidates[0],
                    group.MinimumAmount - addedAmount,
                    alreadyAddedKeys,
                    addedGroupAmounts
                );
                continue;
            }

            throw new InvalidOperationException(
                $"У товара «{product.Name}» обязательная группа модификаторов «{group.ProductGroup.Name}», но в iiko не задан вариант по умолчанию. Нужно выбрать модификатор в приложении или настроить default amount в iiko."
            );
        }
    }

    private static bool AddGroupModifier(
        IEditSession editSession,
        IOrderStub deliveryOrder,
        IOrderProductItemStub addedItem,
        IGroupModifier group,
        IChildModifier child,
        int amount,
        ISet<string> alreadyAddedKeys,
        IDictionary<Guid, int> addedGroupAmounts
    )
    {
        if (amount <= 0 || child.Product == null || group.ProductGroup == null)
        {
            return false;
        }

        if (!alreadyAddedKeys.Add(ModifierKey(child.Product, group.ProductGroup)))
        {
            return false;
        }

        var payableAmount = PayableAmount(amount, Math.Max(child.FreeOfChargeAmount, group.FreeOfChargeAmount));
        editSession.AddOrderModifierItem(
            amount,
            child.Product,
            group.ProductGroup,
            deliveryOrder,
            addedItem,
            payableAmount,
            null
        );

        if (addedGroupAmounts.TryGetValue(group.ProductGroup.Id, out var current))
        {
            addedGroupAmounts[group.ProductGroup.Id] = current + amount;
        }
        else
        {
            addedGroupAmounts[group.ProductGroup.Id] = amount;
        }

        PluginDiagnostics.Info(
            $"MamaRoma: к позиции добавлен групповой модификатор iiko «{child.Product.Name}» x{amount} из группы «{group.ProductGroup.Name}»."
        );
        return true;
    }

    private static void MarkModifierAdded(
        ISet<string> alreadyAddedKeys,
        IDictionary<Guid, int> addedGroupAmounts,
        IProduct product,
        IProductGroup group,
        int amount
    )
    {
        if (product == null)
        {
            return;
        }

        alreadyAddedKeys.Add(ModifierKey(product, group));
        if (group == null)
        {
            return;
        }

        if (addedGroupAmounts.TryGetValue(group.Id, out var current))
        {
            addedGroupAmounts[group.Id] = current + amount;
        }
        else
        {
            addedGroupAmounts[group.Id] = amount;
        }
    }

    private static string ModifierKey(IProduct product, IProductGroup group)
    {
        return ((group == null ? Guid.Empty : group.Id) + ":" + product.Id).ToLowerInvariant();
    }

    private static int PayableAmount(int amount, int freeOfChargeAmount)
    {
        return Math.Max(0, amount - Math.Max(0, freeOfChargeAmount));
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
    /// Добавка может быть простой или групповой. Если сервер не знает группу,
    /// ищем её по справочнику модификаторов конкретного блюда.
    /// </summary>
    private static IProductGroup ResolveModifierGroup(
        IProduct parentProduct,
        IProduct modifierProduct,
        IProductGroup configuredGroup
    )
    {
        if (configuredGroup != null || parentProduct == null || modifierProduct == null)
        {
            return configuredGroup;
        }

        try
        {
            var groups = PluginContext.Operations.GetGroupModifiers(parentProduct, null);
            var matches = (groups ?? Enumerable.Empty<IGroupModifier>())
                .Where(group => group.ProductGroup != null)
                .Where(group => (group.Items ?? Enumerable.Empty<IChildModifier>())
                    .Any(child => child.Product != null && child.Product.Id == modifierProduct.Id))
                .Select(group => group.ProductGroup)
                .Distinct()
                .ToList();

            if (matches.Count == 1)
            {
                PluginDiagnostics.Info(
                    $"MamaRoma: группа модификатора «{modifierProduct.Name}» определена автоматически: «{matches[0].Name}»."
                );
                return matches[0];
            }

            if (matches.Count > 1)
            {
                PluginDiagnostics.Info(
                    $"MamaRoma: модификатор «{modifierProduct.Name}» найден в нескольких группах товара «{parentProduct.Name}», нужна явная группа."
                );
            }
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info(
                $"MamaRoma: группа модификатора «{modifierProduct.Name}» не определена: {exc.Message}"
            );
        }

        return null;
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

    private static string TrimTo(string value, int maxLength)
    {
        var trimmed = Trim(value);
        return trimmed.Length <= maxLength ? trimmed : trimmed.Substring(0, maxLength);
    }

    private static bool ReadBool(object source, string property)
    {
        try
        {
            var value = FrontOrderValueReader.ReadProperty(source, property);
            return value is bool flag && flag;
        }
        catch
        {
            return false;
        }
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
