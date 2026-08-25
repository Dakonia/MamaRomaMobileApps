using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Resto.Front.Api;

namespace Reservly.IikoFrontBridge.Collectors;

internal static class DeliveryCollector
{
    private static readonly object CustomerDiagnosticGate = new object();
    private static volatile bool _customerDiagnosticLogged;

    private static string SafeToString(object value)
    {
        return value?.ToString() ?? string.Empty;
    }

    private static string ReadString(dynamic obj, params string[] propertyNames)
    {
        return FrontOrderValueReader.ReadString((object)obj, propertyNames);
    }

    private static string ReadNestedName(dynamic obj, string propertyName)
    {
        return FrontOrderValueReader.ReadNestedName((object)obj, propertyName);
    }

    // IDeliveryOrder.ClientName — сырое имя, заполняется только когда оператор вводит его вручную без привязки к CRM.
    // IDeliveryOrder.Client (IClient: Name, Surname, Nick) — карточка клиента CRM, привязывается автоматически
    // для онлайн-заказов (по телефону), поэтому имя там, а ClientName остаётся пустым.
    // Источник: https://iiko.github.io/front.api.sdk/v8/html/T_Resto_Front_Api_Data_Orders_IDeliveryOrder.htm
    private static string ReadCustomerName(object order)
    {
        var direct = FrontOrderValueReader.ReadString(order, "ClientName");
        if (!string.IsNullOrWhiteSpace(direct))
        {
            return direct;
        }

        var client = FrontOrderValueReader.ReadProperty(order, "Client");
        if (client != null)
        {
            var first = FrontOrderValueReader.ReadString(client, "Name");
            var last = FrontOrderValueReader.ReadString(client, "Surname");
            var combined = string.Join(" ", new[] { first, last }.Where(part => !string.IsNullOrWhiteSpace(part)));
            if (!string.IsNullOrWhiteSpace(combined))
            {
                return combined;
            }

            var nick = FrontOrderValueReader.ReadString(client, "Nick");
            if (!string.IsNullOrWhiteSpace(nick))
            {
                return nick;
            }
        }

        LogCustomerDiagnosticOnce(order);
        return string.Empty;
    }

    private static void LogCustomerDiagnosticOnce(object order)
    {
        if (_customerDiagnosticLogged)
        {
            return;
        }
        lock (CustomerDiagnosticGate)
        {
            if (_customerDiagnosticLogged)
            {
                return;
            }
            _customerDiagnosticLogged = true;
            try
            {
                PluginDiagnostics.Warning(
                    "DeliveryCollector: customer name empty, order props: " +
                    FrontOrderValueReader.DescribeObject(order, 60)
                );
            }
            catch
            {
            }
        }
    }

    private static void AddAddressPart(List<string> parts, string value)
    {
        if (!string.IsNullOrWhiteSpace(value) && !parts.Contains(value))
        {
            parts.Add(value);
        }
    }

    private static void AddLabeledAddressPart(List<string> parts, string label, string value)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            AddAddressPart(parts, $"{label} {value}");
        }
    }

    private static string FormatAddress(dynamic address)
    {
        if (address == null) return string.Empty;
        try
        {
            var line1 = ReadString(address, "Line1");
            var line2 = ReadString(address, "Line2");
            var explicitLine = ReadString(
                address,
                "FullAddress",
                "AddressLine",
                "Line",
                "Text",
                "FormattedAddress",
                "ExternalCartographyAddress"
            );

            var city = ReadNestedName(address, "City");
            var street = ReadNestedName(address, "Street");
            var house = ReadString(address, "House", "HouseNumber", "BuildingNumber");
            var building = ReadString(address, "Building", "Corpus", "Block");
            var flat = ReadString(address, "Flat", "FlatNumber", "Apartment", "ApartmentNumber");
            var entrance = ReadString(address, "Entrance", "Porch");
            var floor = ReadString(address, "Floor");
            var doorphone = ReadString(address, "Doorphone", "Intercom");
            var comment = ReadString(address, "Comment", "AdditionalInfo", "AdditionalInformation");

            var parts = new List<string>();
            AddAddressPart(parts, explicitLine);
            AddAddressPart(parts, line1);

            if (string.IsNullOrWhiteSpace(explicitLine) && string.IsNullOrWhiteSpace(line1))
            {
                AddAddressPart(parts, city);
                AddAddressPart(parts, street);
                AddAddressPart(parts, house);
                AddAddressPart(parts, building);
            }

            AddAddressPart(parts, line2);
            if (string.IsNullOrWhiteSpace(line2))
            {
                AddLabeledAddressPart(parts, "кв.", flat);
                AddLabeledAddressPart(parts, "подъезд", entrance);
                AddLabeledAddressPart(parts, "этаж", floor);
                AddLabeledAddressPart(parts, "домофон", doorphone);
            }
            AddAddressPart(parts, comment);

            if (parts.Count > 0)
            {
                return string.Join(", ", parts);
            }

            var propDump = string.Empty;
            try
            {
                var sb = new System.Text.StringBuilder();
                foreach (var p in ((object)address).GetType().GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance))
                {
                    try { sb.Append($"{p.Name}={p.GetValue(address)};"); } catch { sb.Append($"{p.Name}=ERR;"); }
                }
                propDump = sb.ToString();
            }
            catch { }
            PluginDiagnostics.Info($"DeliveryCollector: address empty, props: {propDump}");
            return string.Empty;
        }
        catch (Exception ex)
        {
            PluginDiagnostics.Info($"DeliveryCollector: FormatAddress exception: {ex.GetType().Name}: {ex.Message}");
            return string.Empty;
        }
    }

    private static string ExtractCity(dynamic address)
    {
        if (address == null) return string.Empty;
        try
        {
            var city = ReadNestedName(address, "City");
            if (!string.IsNullOrWhiteSpace(city))
            {
                return city;
            }

            var line1 = ReadString(address, "Line1");
            if (!string.IsNullOrWhiteSpace(line1))
            {
                var firstPart = line1.Split(',').FirstOrDefault() ?? string.Empty;
                return firstPart.Trim();
            }

            return string.Empty;
        }
        catch { return string.Empty; }
    }

    private static string GetOrderTypeName(dynamic orderType)
    {
        if (orderType == null) return string.Empty;
        try
        {
            var name = orderType.Name?.ToString() ?? string.Empty;
            return name.Contains('.') ? string.Empty : name;
        }
        catch { return string.Empty; }
    }

    private static List<FrontDeliveryItemRecord> CollectItems(dynamic order)
    {
        var result = new List<FrontDeliveryItemRecord>();
        try
        {
            result = FrontOrderValueReader.CollectItems((object)order);
            if (result.Count == 0)
            {
                PluginDiagnostics.Info(
                    "DeliveryCollector: CollectItems — no readable items. " +
                    $"props={FrontOrderValueReader.DescribeObject((object)order, 24)}"
                );
                return result;
            }
            PluginDiagnostics.Info($"DeliveryCollector: CollectItems added={result.Count} items.");
        }
        catch (Exception ex)
        {
            PluginDiagnostics.Info($"DeliveryCollector: CollectItems exception: {ex.GetType().Name}: {ex.Message}");
        }
        return result;
    }

    public static FrontDeliveriesPayload Collect(int lookbackDays, int businessDayEndHour = 6)
    {
        var payload = new FrontDeliveriesPayload();
        var orders = PluginContext.Operations.GetDeliveryOrders(includeDeleted: false);
        foreach (var order in orders)
        {
            var orderAt = order.CreateTime;
            var items = CollectItems(order);
            var address = FormatAddress(order.Address);
            if (string.IsNullOrWhiteSpace(address))
            {
                payload.OrdersWithoutAddress++;
            }
            if (items.Count == 0)
            {
                payload.OrdersWithoutItems++;
            }

            string closedAt = string.Empty;
            try
            {
                dynamic dynOrder = order;
                var closeTime = dynOrder.CloseTime;
                if (closeTime != null)
                    closedAt = ((DateTime)closeTime).ToString("O", CultureInfo.InvariantCulture);
            }
            catch { }

            var customerName = ReadCustomerName((object)order);

            payload.Orders.Add(new FrontDeliveryRecord
            {
                OrderId = order.Id.ToString(),
                OrderNumber = order.Number.ToString(),
                CustomerName = customerName,
                CustomerPhone = SafeToString(order.Phone),
                DeliveryAddress = address,
                DeliveryCity = ExtractCity(order.Address),
                DeliveryType = GetOrderTypeName(order.OrderType),
                Status = order.DeliveryStatus.ToString(),
                TotalSum = FrontOrderValueReader.ReadOrderTotal((object)order, items),
                OrderAt = orderAt.ToString("O", CultureInfo.InvariantCulture),
                ClosedAt = closedAt,
                DeliveryDate = orderAt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                GuestsCount = FrontOrderValueReader.ReadGuestCount((object)order),
                Items = items,
            });
        }

        var metrics = new Dictionary<DateTime, FrontDeliveryMetricRecord>();
        foreach (var order in PastOrderHelpers.GetRecentPastOrders(lookbackDays, businessDayEndHour))
        {
            if (!PastOrderHelpers.ShouldIncludeInRevenue(order))
            {
                continue;
            }
            if (!PastOrderHelpers.IsDeliveryOrder(order.OrderType))
            {
                continue;
            }

            var workDate = PastOrderHelpers.GetBusinessDay(order.CloseTime, businessDayEndHour);
            if (!metrics.TryGetValue(workDate, out var day))
            {
                day = new FrontDeliveryMetricRecord
                {
                    Date = workDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                };
                metrics[workDate] = day;
            }

            day.TotalAmount += PastOrderHelpers.SumPayments(order);
            day.OrdersCount += 1;
        }

        foreach (var day in metrics.OrderBy(pair => pair.Key).Select(pair => pair.Value))
        {
            payload.Metrics.Add(day);
        }

        return payload;
    }
}
