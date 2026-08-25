using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Resto.Front.Api.Data.Orders;

namespace Reservly.IikoFrontBridge.Collectors;

internal sealed class OrderGuestCountResolver
{
    private readonly List<OrderGuestSnapshot> _snapshots = new List<OrderGuestSnapshot>();

    public void AddOrders(IEnumerable<dynamic> orders)
    {
        if (orders == null)
        {
            return;
        }

        foreach (var order in orders)
        {
            AddOrder((object)order);
        }
    }

    public void AddOrder(object order)
    {
        if (order == null)
        {
            return;
        }

        var guestsCount = FrontOrderValueReader.ReadGuestCount(order);
        if (guestsCount <= 0)
        {
            return;
        }

        var orderNumber = OrderIntrospection.ReadOrderNumber(order);
        var openedAt = NormalizeDateKey(OrderIntrospection.ReadDateIso(order, "OpenTime", "OpenedAt", "WhenOpened", "CreateTime", "CreatedAt"));
        if (string.IsNullOrWhiteSpace(orderNumber) && string.IsNullOrWhiteSpace(openedAt))
        {
            return;
        }

        var tableNumber = FrontOrderValueReader.GetFirstTableNumber(order);
        var existing = _snapshots.FirstOrDefault(snapshot =>
            snapshot.OrderNumber.Equals(orderNumber, StringComparison.OrdinalIgnoreCase)
            && snapshot.OpenedAt.Equals(openedAt, StringComparison.OrdinalIgnoreCase)
            && snapshot.TableNumber.Equals(tableNumber, StringComparison.OrdinalIgnoreCase));
        if (existing != null)
        {
            existing.GuestsCount = Math.Max(existing.GuestsCount, guestsCount);
            return;
        }

        _snapshots.Add(new OrderGuestSnapshot
        {
            OrderNumber = orderNumber,
            OpenedAt = openedAt,
            TableNumber = tableNumber,
            GuestsCount = guestsCount,
        });
    }

    public int ReadPastOrderGuestCount(PastOrder order)
    {
        if (order == null)
        {
            return 0;
        }

        var direct = FrontOrderValueReader.ReadGuestCount(order);
        if (PastOrderHelpers.IsDeliveryOrder(order.OrderType))
        {
            return Math.Max(1, direct);
        }
        if (direct > 0)
        {
            return direct;
        }

        var orderNumber = OrderIntrospection.ReadOrderNumber(order);
        var openedAt = NormalizeDateKey(OrderIntrospection.ReadDateIso(order, "OpenTime", "OpenedAt", "WhenOpened", "CreateTime", "CreatedAt"));
        var tableNumber = FrontOrderValueReader.GetFirstTableNumber(order);
        if (string.IsNullOrWhiteSpace(orderNumber) && string.IsNullOrWhiteSpace(openedAt))
        {
            return 0;
        }

        var exact = _snapshots
            .Where(snapshot =>
                !string.IsNullOrWhiteSpace(snapshot.OrderNumber)
                && snapshot.OrderNumber.Equals(orderNumber, StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrWhiteSpace(snapshot.OpenedAt)
                && snapshot.OpenedAt.Equals(openedAt, StringComparison.OrdinalIgnoreCase)
                && (string.IsNullOrWhiteSpace(tableNumber)
                    || string.IsNullOrWhiteSpace(snapshot.TableNumber)
                    || snapshot.TableNumber.Equals(tableNumber, StringComparison.OrdinalIgnoreCase)))
            .Select(snapshot => snapshot.GuestsCount)
            .DefaultIfEmpty(0)
            .Max();
        if (exact > 0)
        {
            return exact;
        }

        return _snapshots
            .Where(snapshot =>
                !string.IsNullOrWhiteSpace(snapshot.OrderNumber)
                && snapshot.OrderNumber.Equals(orderNumber, StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrWhiteSpace(snapshot.TableNumber)
                && snapshot.TableNumber.Equals(tableNumber, StringComparison.OrdinalIgnoreCase))
            .Select(snapshot => snapshot.GuestsCount)
            .DefaultIfEmpty(0)
            .Max();
    }

    private static string NormalizeDateKey(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        DateTimeOffset parsed;
        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out parsed))
        {
            return parsed.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);
        }

        return value.Trim().Length >= 19 ? value.Trim().Substring(0, 19) : value.Trim();
    }

    private sealed class OrderGuestSnapshot
    {
        public string OrderNumber { get; set; } = string.Empty;
        public string OpenedAt { get; set; } = string.Empty;
        public string TableNumber { get; set; } = string.Empty;
        public int GuestsCount { get; set; }
    }
}
