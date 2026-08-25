using System;
using System.Globalization;
using Resto.Front.Api.Data.Orders;

namespace Reservly.IikoFrontBridge.Collectors;

internal static class OrderLifecycleCollector
{
    public static FrontOrderLifecyclePayload Collect(
        LiveOrderCache orderCache,
        int lookbackDays,
        int businessDayEndHour,
        bool excludeNonRevenuePayments)
    {
        var payload = new FrontOrderLifecyclePayload();
        var guestResolver = new OrderGuestCountResolver();
        guestResolver.AddOrders(orderCache?.GetKnownOrders());
        CollectCurrentOrders(payload, guestResolver);
        CollectPastOrders(payload, lookbackDays, businessDayEndHour, excludeNonRevenuePayments, guestResolver);
        PluginDiagnostics.Info($"OrderLifecycleCollector: built {payload.Orders.Count} lifecycle records.");
        return payload;
    }

    private static void CollectCurrentOrders(FrontOrderLifecyclePayload payload, OrderGuestCountResolver guestResolver)
    {
        var scan = FrontOrderScanner.GetCurrentTableOrders();
        if (!scan.Success)
        {
            PluginDiagnostics.Info($"OrderLifecycleCollector: current orders scan failed: {scan.Error}");
            return;
        }

        foreach (var order in scan.Orders)
        {
            try
            {
                guestResolver?.AddOrder((object)order);
                var record = BuildCurrentOrderRecord(order);
                if (!string.IsNullOrWhiteSpace(record.OrderId))
                {
                    payload.Orders.Add(record);
                }
            }
            catch (Exception exc)
            {
                PluginDiagnostics.Info($"OrderLifecycleCollector: current order skipped: {exc.Message}");
            }
        }
    }

    private static void CollectPastOrders(
        FrontOrderLifecyclePayload payload,
        int lookbackDays,
        int businessDayEndHour,
        bool excludeNonRevenuePayments,
        OrderGuestCountResolver guestResolver)
    {
        foreach (var order in PastOrderHelpers.GetRecentPastOrders(lookbackDays, businessDayEndHour))
        {
            try
            {
                var record = BuildPastOrderRecord(order, businessDayEndHour, excludeNonRevenuePayments, guestResolver);
                if (!string.IsNullOrWhiteSpace(record.OrderId))
                {
                    payload.Orders.Add(record);
                }
            }
            catch (Exception exc)
            {
                PluginDiagnostics.Info($"OrderLifecycleCollector: past order skipped: {exc.Message}");
            }
        }
    }

    private static FrontOrderLifecycleRecord BuildCurrentOrderRecord(dynamic order)
    {
        var orderObj = (object)order;
        var status = FrontOrderScanner.GetStatus(order);
        var items = FrontOrderValueReader.CollectItems(orderObj);
        var total = FrontOrderValueReader.ReadOrderTotal(orderObj, items);
        var waiter = OrderIntrospection.ReadWaiter(orderObj);
        var prebillAt = OrderIntrospection.ReadDateIso(
            orderObj,
            "BillTime",
            "PreBillTime",
            "PrecheckTime",
            "PreChequeTime",
            "BillPrintTime",
            "PrintBillTime",
            "PreliminaryChequeTime",
            "ChequePrintTime"
        );

        var closedAt = OrderIntrospection.ReadDateIso(order, "CloseTime", "ClosedAt", "WhenClosed");

        return new FrontOrderLifecycleRecord
        {
            OrderId = FrontOrderScanner.GetOrderId(order),
            OrderNumber = OrderIntrospection.ReadOrderNumber(orderObj),
            TableNumber = FrontOrderValueReader.GetFirstTableNumber(orderObj),
            OrderType = OrderIntrospection.ReadOrderTypeName(orderObj),
            ServiceType = OrderIntrospection.ReadServiceType(orderObj),
            Status = status,
            WaiterFrontUserId = waiter.Id,
            WaiterName = waiter.Name,
            OpenedAt = OrderIntrospection.ReadDateIso(orderObj, "OpenTime", "OpenedAt", "CreateTime", "WhenCreated"),
            PrebillAt = prebillAt,
            ClosedAt = closedAt,
            CancelledAt = FrontOrderScanner.IsDeletedOrCancelled(status)
                ? OrderIntrospection.ReadDateIso(orderObj, "DeletedAt", "CancelledAt", "CloseTime", "ClosedAt")
                : string.Empty,
            TotalSum = total,
            PaidSum = 0m,
            RevenueSum = total,
            NonRevenueSum = 0m,
            FiscalSum = total,
            NonFiscalSum = 0m,
            DiscountSum = OrderIntrospection.ReadDiscountSum(orderObj),
            GuestsCount = FrontOrderValueReader.ReadGuestCount(orderObj),
            ItemsCount = items.Count,
            Items = items,
        };
    }

    private static FrontOrderLifecycleRecord BuildPastOrderRecord(
        PastOrder order,
        int businessDayEndHour,
        bool excludeNonRevenuePayments,
        OrderGuestCountResolver guestResolver)
    {
        var items = FrontOrderValueReader.CollectItems(order);
        var payments = PastOrderHelpers.SplitPaymentsDetailed(order, excludeNonRevenuePayments);
        var paidSum = PastOrderHelpers.SumPayments(order);
        var waiter = OrderIntrospection.ReadWaiter(order);
        var status = "Closed";
        if (order.Deleted)
        {
            status = "Deleted";
        }
        else if (order.Storned)
        {
            status = "Storned";
        }

        var closedAt = OrderIntrospection.ReadDateIso(order, "CloseTime", "ClosedAt", "WhenClosed", "PaymentTime");

        return new FrontOrderLifecycleRecord
        {
            OrderId = PastOrderHelpers.GetOrderId(order),
            OrderNumber = OrderIntrospection.ReadOrderNumber(order),
            TableNumber = FrontOrderValueReader.GetFirstTableNumber(order),
            OrderType = OrderIntrospection.ReadOrderTypeName(order),
            ServiceType = OrderIntrospection.ReadServiceType(order),
            Status = status,
            WaiterFrontUserId = waiter.Id,
            WaiterName = waiter.Name,
            OpenedAt = OrderIntrospection.ReadDateIso(order, "OpenTime", "OpenedAt", "CreateTime", "WhenCreated"),
            PrebillAt = OrderIntrospection.ReadDateIso(order, "BillTime", "PreBillTime", "PrecheckTime", "PreChequeTime"),
            ClosedAt = closedAt,
            CancelledAt = order.Deleted ? closedAt : string.Empty,
            TotalSum = FrontOrderValueReader.ReadOrderTotal(order, items),
            PaidSum = paidSum,
            RevenueSum = payments.revenue,
            NonRevenueSum = payments.nonRevenue,
            FiscalSum = payments.fiscal,
            NonFiscalSum = payments.nonFiscal,
            DiscountSum = OrderIntrospection.ReadDiscountSum(order),
            GuestsCount = guestResolver?.ReadPastOrderGuestCount(order) ?? FrontOrderValueReader.ReadGuestCount(order),
            ItemsCount = items.Count,
            Items = items,
        };
    }
}
