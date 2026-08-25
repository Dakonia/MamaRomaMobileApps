using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Resto.Front.Api;
using Resto.Front.Api.Data.Common;
using Resto.Front.Api.Data.Orders;

namespace Reservly.IikoFrontBridge.Collectors;

internal sealed class BookingOrderCollector : IDisposable
{
    private static readonly HashSet<string> SkipStatuses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "Deleted", "Cancelled",
    };

    private static readonly TimeSpan ForceResendInterval = TimeSpan.FromMinutes(10);

    private readonly LiveOrderCache _cache;
    private readonly object _gate = new object();
    private IDisposable _subscription;
    private bool _hasEventChanges;
    private DateTimeOffset _lastSentAt = DateTimeOffset.MinValue;

    public BookingOrderCollector(LiveOrderCache cache)
    {
        _cache = cache;

        try
        {
            _subscription = PluginContext.Notifications.OrderChanged.Subscribe(
                new ActionObserver<EntityChangedEventArgs<IOrder>>(
                    _ => OnOrderChanged(),
                    exc =>
                    {
                        PluginContext.Log.Error($"Reservly order change notification failed. {exc.Message}");
                        PluginDiagnostics.Error("Order change notification failed.", exc);
                    }
                )
            );
            PluginDiagnostics.Info("BookingOrderCollector: subscribed to OrderChanged (event-driven mode).");
        }
        catch (Exception exc)
        {
            PluginContext.Log.Warn($"BookingOrderCollector: OrderChanged event unavailable, using polling only. {exc.Message}");
            PluginDiagnostics.Info("BookingOrderCollector: OrderChanged not available, polling-only mode.");
        }
    }

    private void OnOrderChanged()
    {
        lock (_gate)
        {
            _hasEventChanges = true;
        }
        PluginDiagnostics.Info("OrderChanged event received — table orders will sync at next poll cycle.");
    }

    public bool ShouldCollect()
    {
        lock (_gate)
        {
            var now = DateTimeOffset.Now;
            return _hasEventChanges || (now - _lastSentAt >= ForceResendInterval);
        }
    }

    public void CommitCollected(DateTimeOffset collectedAt)
    {
        lock (_gate)
        {
            _hasEventChanges = false;
            _lastSentAt = collectedAt;
        }
    }

    public FrontTableOrdersPayload Collect()
    {
        var payload = new FrontTableOrdersPayload();

        var scan = FrontOrderScanner.GetCurrentTableOrders();
        var orders = scan.Success ? scan.Orders : _cache.GetKnownOrders();
        if (scan.Success)
        {
            _cache.RefreshFromFullScan(orders);
        }

        var seenOrderIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var order in orders)
        {
            try
            {
                var status = (string)FrontOrderScanner.GetStatus(order);

                if (SkipStatuses.Any(s => status.IndexOf(s, StringComparison.OrdinalIgnoreCase) >= 0))
                    continue;

                var orderId = (string)FrontOrderScanner.GetOrderId(order);
                if (string.IsNullOrWhiteSpace(orderId) || !seenOrderIds.Add(orderId))
                    continue;

                var tableNumber = GetTableNumber(order);
                if (string.IsNullOrWhiteSpace(tableNumber))
                {
                    PluginDiagnostics.Info(
                        "BookingOrderCollector: no table number for order. " +
                        $"id={orderId}, status={status}, props={FrontOrderValueReader.DescribeObject((object)order, 24)}"
                    );
                    continue;
                }

                CollectOrderRecord(order, tableNumber, status, payload);
            }
            catch { }
        }

        PluginContext.Log.Info(
            $"Reservly BookingOrderCollector: source={(scan.Success ? "full-scan" : "cache-fallback")}, " +
            $"orders={orders.Count}, table orders built={payload.Orders.Count}, scanError={scan.Error}."
        );
        return payload;
    }

    private static string GetTableNumber(dynamic order)
    {
        return FrontOrderValueReader.GetFirstTableNumber((object)order);
    }

    private static void CollectOrderRecord(dynamic order, string tableNumber, string status, FrontTableOrdersPayload payload)
    {
        var orderId = string.Empty;
        try { orderId = order.Id?.ToString() ?? string.Empty; } catch { }
        if (string.IsNullOrWhiteSpace(orderId)) return;

        var openedAt = DateTimeOffset.MinValue;
        try { openedAt = new DateTimeOffset((DateTime)order.OpenTime, DateTimeOffset.Now.Offset); } catch { }
        if (openedAt == DateTimeOffset.MinValue) return;

        string closedAt = null;
        try
        {
            var closeTime = order.CloseTime;
            if (closeTime != null)
                closedAt = new DateTimeOffset((DateTime)closeTime, DateTimeOffset.Now.Offset)
                    .ToString("O", CultureInfo.InvariantCulture);
        }
        catch { }

        var items = CollectOrderItems(order);
        var totalSum = FrontOrderValueReader.ReadOrderTotal((object)order, items);
        var guestsCount = FrontOrderValueReader.ReadGuestCount((object)order);

        decimal discountSum = 0m;
        try
        {
            foreach (var discount in order.Discounts ?? Enumerable.Empty<dynamic>())
            {
                try { discountSum += (decimal)discount.Sum; } catch { }
            }
        }
        catch { }

        var waiterFrontUserId = string.Empty;
        var waiterName = string.Empty;
        var waiterPhone = string.Empty;
        try
        {
            dynamic waiter = order.Waiter;
            if (waiter != null)
            {
                try { waiterFrontUserId = waiter.Id?.ToString() ?? string.Empty; } catch { }
                try { waiterName = waiter.Name?.ToString() ?? string.Empty; } catch { }
                try { waiterPhone = waiter.CellPhone?.ToString() ?? string.Empty; } catch { }
            }
        }
        catch { }

        payload.Orders.Add(new FrontTableOrderRecord
        {
            OrderId = orderId,
            TableNumber = tableNumber,
            OpenedAt = openedAt.ToString("O", CultureInfo.InvariantCulture),
            ClosedAt = closedAt ?? string.Empty,
            Status = status,
            TotalSum = totalSum,
            DiscountSum = discountSum,
            GuestsCount = guestsCount,
            Items = items,
            WaiterFrontUserId = waiterFrontUserId,
            WaiterName = waiterName,
            WaiterPhone = waiterPhone,
        });
    }

    private static List<FrontDeliveryItemRecord> CollectOrderItems(dynamic order)
    {
        return FrontOrderValueReader.CollectItems((object)order);
    }

    public void Dispose()
    {
        _subscription?.Dispose();
    }
}
