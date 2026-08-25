using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Resto.Front.Api;

namespace Reservly.IikoFrontBridge.Collectors;

internal static class LiveRevenueCollector
{
    public static FrontLiveRevenuePayload Collect(
        LiveOrderCache orderCache,
        int businessDayEndHour = 6,
        bool excludeNonRevenuePayments = false,
        HashSet<string> treatAsCashPaymentTypes = null,
        HashSet<string> treatAsNonRevenuePaymentTypes = null,
        DishSnapshotCache dishSnapshotCache = null)
    {
        var today = PastOrderHelpers.GetBusinessDay(DateTime.Now, businessDayEndHour);
        var todayText = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var payload = new FrontLiveRevenuePayload
        {
            Date = todayText,
            CapturedAt = DateTimeOffset.Now.ToString("O", CultureInfo.InvariantCulture),
        };

        CollectCurrentOrders(payload, orderCache, today, businessDayEndHour);
        var guestResolver = new OrderGuestCountResolver();
        guestResolver.AddOrders(orderCache?.GetKnownOrders());
        CollectPastOrders(payload, today, businessDayEndHour, excludeNonRevenuePayments, guestResolver, orderCache, treatAsCashPaymentTypes, treatAsNonRevenuePaymentTypes);
        CollectDeliveryOrders(payload, today, businessDayEndHour, excludeNonRevenuePayments, guestResolver, treatAsNonRevenuePaymentTypes);

        if (dishSnapshotCache != null)
        {
            payload.Dishes = dishSnapshotCache.MergeAndUpdate(payload.Dishes, todayText);
        }

        var expectedRevenue = payload.ClosedSum + payload.DeliverySum;
        var gap = expectedRevenue - payload.DishRevenueSum;
        PluginDiagnostics.Info(
            $"LiveRevenue reconciliation date={todayText}: closedSum={payload.ClosedSum} deliverySum={payload.DeliverySum} " +
            $"dishRevenueSum={payload.DishRevenueSum} gap={gap} " +
            $"skippedNoItemsCount={payload.ClosedOrdersSkippedNoItemsCount} skippedNoItemsSum={payload.ClosedOrdersSkippedNoItemsSum}"
        );

        return payload;
    }

    private static void CollectCurrentOrders(FrontLiveRevenuePayload payload, LiveOrderCache orderCache, DateTime today, int businessDayEndHour)
    {
        try
        {
            var scan = FrontOrderScanner.GetCurrentTableOrders();
            var activeOrders = scan.Success
                ? scan.Orders
                : orderCache.GetActiveOrders();

            if (scan.Success)
                orderCache.RefreshFromFullScan(activeOrders);

            foreach (var order in activeOrders)
            {
                try { ProcessOpenOrder(order, payload, today, businessDayEndHour, orderCache); } catch { }
            }

            PluginDiagnostics.Info(
                $"LiveRevenue: source={(scan.Success ? "full-scan" : "cache-fallback")} orders={activeOrders.Count} " +
                $"open={payload.OpenCount}/{payload.OpenSum} prebill={payload.PrebillCount}/{payload.PrebillSum} " +
                $"items={payload.CurrentOrderItemsCount} withoutItems={payload.CurrentOrdersWithoutItems} " +
                $"skippedClosed={payload.CurrentOrdersSkippedClosed} scanError={scan.Error}"
            );
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info($"LiveRevenue: CollectCurrentOrders exception: {exc.Message}");
        }
    }

    private static void ProcessOpenOrder(dynamic order, FrontLiveRevenuePayload payload, DateTime today, int businessDayEndHour, LiveOrderCache orderCache = null)
    {
        var status = string.Empty;
        try { status = (string)FrontOrderScanner.GetStatus(order); } catch { }
        var orderId = FrontOrderScanner.GetOrderId(order);

        // Skip banquet/reserve orders scheduled for a different business day
        try
        {
            var reserve = FrontOrderValueReader.ReadProperty((object)order, "Reserve");
            if (reserve != null)
            {
                var reserveDate = TryReadReserveDate(reserve);
                if (reserveDate.HasValue)
                {
                    var reserveBusinessDay = PastOrderHelpers.GetBusinessDay(reserveDate.Value, businessDayEndHour);
                    if (reserveBusinessDay != today)
                    {
                        PluginDiagnostics.Info(
                            $"LiveRevenue: skipping future banquet order id={orderId} reserveDay={reserveDate.Value:yyyy-MM-dd} today={today:yyyy-MM-dd}"
                        );
                        return;
                    }
                }
            }
        }
        catch { }

        if (FrontOrderValueReader.IsClosedCurrentOrder((object)order, status))
        {
            payload.CurrentOrdersSkippedClosed++;
            PluginDiagnostics.Info(
                "LiveRevenue: current order skipped as closed. " +
                $"id={orderId}, status={status}, props={FrontOrderValueReader.DescribeObject((object)order, 24)}"
            );
            return;
        }

        var items = FrontOrderValueReader.CollectItems((object)order);
        if (orderCache != null)
        {
            foreach (var item in items)
            {
                if (item.CostSum > 0m && !string.IsNullOrEmpty(item.ProductId) && item.Amount > 0m)
                    orderCache.UpdateProductCost(item.ProductId, item.CostSum / item.Amount);
            }
        }
        var totalSum = FrontOrderValueReader.ReadOrderTotal((object)order, items);
        payload.CurrentOrderItemsCount += items.Count;
        if (items.Count > 0)
        {
            payload.CurrentOrdersWithItems++;
        }
        else
        {
            payload.CurrentOrdersWithoutItems++;
            PluginDiagnostics.Info(
                "LiveRevenue: current order has no readable items. " +
                $"id={orderId}, status={status}, props={FrontOrderValueReader.DescribeObject((object)order, 24)}"
            );
        }

        var isPrebill = FrontOrderValueReader.IsPrebillOrder((object)order, status);
        var guestsCount = FrontOrderValueReader.ReadGuestCount((object)order);

        if (isPrebill)
        {
            payload.PrebillCount++;
            payload.PrebillSum += totalSum;
            payload.PrebillGuestsCount += guestsCount;
        }
        else
        {
            payload.OpenCount++;
            payload.OpenSum += totalSum;
            payload.OpenGuestsCount += guestsCount;
        }
        PluginDiagnostics.Info(
            "LiveRevenue: current order classified. " +
            $"id={orderId}, status={status}, bucket={(isPrebill ? "prebill" : "open")}, total={totalSum}, guests={guestsCount}, items={items.Count}"
        );

        var waiterId = string.Empty;
        var waiterName = string.Empty;
        var waiterPhone = string.Empty;
        try
        {
            dynamic waiter = order.Waiter;
            if (waiter != null)
            {
                try { waiterId = waiter.Id?.ToString() ?? string.Empty; } catch { }
                try { waiterName = waiter.Name?.ToString() ?? string.Empty; } catch { }
                try { waiterPhone = waiter.CellPhone?.ToString() ?? string.Empty; } catch { }
            }
        }
        catch { }

        if (!string.IsNullOrEmpty(waiterId))
            AddToWaiter(payload, waiterId, waiterName, waiterPhone, totalSum, 1, guestsCount);

        // Dish analytics is based on closed past orders only. Open orders can still change or have items deleted.
    }

    private static void CollectDeliveryOrders(
        FrontLiveRevenuePayload payload,
        DateTime today,
        int businessDayEndHour,
        bool excludeNonRevenuePayments,
        OrderGuestCountResolver guestResolver,
        HashSet<string> treatAsNonRevenuePaymentTypes = null)
    {
        // Open (active) delivery orders right now
        try
        {
            var deliveries = PluginContext.Operations.GetDeliveryOrders(includeDeleted: false);
            foreach (var d in deliveries)
            {
                try
                {
                    var status = d.DeliveryStatus.ToString();
                    if (status.IndexOf("Cancelled", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                    if (status.IndexOf("Closed", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                    if (status.IndexOf("Deleted", StringComparison.OrdinalIgnoreCase) >= 0) continue;

                    // Skip deliveries scheduled for a different business day
                    var expectedTime = d.ExpectedDeliverTime;
                    if (expectedTime > DateTime.MinValue.AddDays(1) && expectedTime.Year > 1900)
                    {
                        var deliveryDay = PastOrderHelpers.GetBusinessDay(expectedTime, businessDayEndHour);
                        if (deliveryDay != today) continue;
                    }

                    var items = FrontOrderValueReader.CollectItems((object)d);
                    var guestsCount = Math.Max(1, FrontOrderValueReader.ReadGuestCount((object)d));
                    payload.DeliveryCount++;
                    payload.DeliverySum += FrontOrderValueReader.ReadOrderTotal((object)d, items);
                    payload.DeliveryGuestsCount += guestsCount;
                }
                catch { }
            }
        }
        catch (Exception exc)
        {
            PluginContext.Log.Error($"LiveRevenueCollector: delivery orders failed. {exc.Message}");
        }

        // Closed delivery orders from today's business day (from past orders)
        try
        {
            var pastOrders = PastOrderHelpers.GetRecentPastOrders(2, businessDayEndHour);
            foreach (var order in pastOrders)
            {
                try
                {
                    if (!PastOrderHelpers.ShouldIncludeInRevenue(order, excludeNonRevenuePayments, treatAsNonRevenuePaymentTypes)) continue;
                    if (!PastOrderHelpers.IsDeliveryOrder(order.OrderType)) continue;
                    if (PastOrderHelpers.GetBusinessDay(order.CloseTime, businessDayEndHour) != today) continue;
                    payload.DeliveryCount++;
                    payload.DeliverySum += PastOrderHelpers.SumRevenuePayments(order, excludeNonRevenuePayments);
                    payload.DeliveryGuestsCount += guestResolver?.ReadPastOrderGuestCount(order) ?? 1;
                }
                catch { }
            }
        }
        catch { }
    }

    private static void CollectPastOrders(
        FrontLiveRevenuePayload payload,
        DateTime today,
        int businessDayEndHour,
        bool excludeNonRevenuePayments,
        OrderGuestCountResolver guestResolver,
        LiveOrderCache orderCache = null,
        HashSet<string> treatAsCashPaymentTypes = null,
        HashSet<string> treatAsNonRevenuePaymentTypes = null)
    {
        var lookback = 2;
        var emptyGuid = "00000000-0000-0000-0000-000000000000";

        var userNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var u in PluginContext.Operations.GetUsers(fromAllDepartments: true))
            {
                try
                {
                    var uid = u.Id.ToString();
                    if (!string.IsNullOrEmpty(uid) && !string.IsNullOrEmpty(u.Name))
                        userNames[uid] = u.Name;
                }
                catch { }
            }
        }
        catch { }

        try
        {
            var pastOrders = PastOrderHelpers.GetRecentPastOrders(lookback, businessDayEndHour);
            foreach (var order in pastOrders)
            {
                try
                {
                    if (!PastOrderHelpers.ShouldIncludeInRevenue(order, excludeNonRevenuePayments, treatAsNonRevenuePaymentTypes)) continue;

                    var isDeliveryOrder = PastOrderHelpers.IsDeliveryOrder(order.OrderType);
                    var orderDate = PastOrderHelpers.GetBusinessDay(order.CloseTime, businessDayEndHour);
                    var total = PastOrderHelpers.SumRevenuePayments(order, excludeNonRevenuePayments);
                    var guestsCount = guestResolver?.ReadPastOrderGuestCount(order) ?? FrontOrderValueReader.ReadGuestCount(order);
                    var waiter = OrderIntrospection.ReadWaiter(order);

                    if (!isDeliveryOrder && orderDate == today)
                    {
                        payload.ClosedCount++;
                        payload.ClosedSum += total;
                        payload.ClosedGuestsCount += guestsCount;

                        if (!string.IsNullOrEmpty(waiter.Id) && waiter.Id != emptyGuid)
                        {
                            userNames.TryGetValue(waiter.Id, out var waiterName);
                            AddToWaiter(payload, waiter.Id, FirstNonEmpty(waiter.Name, waiterName), waiter.Phone, total, 1, guestsCount);
                        }
                    }

                    if (orderDate == today)
                    {
                        try
                        {
                            var source = isDeliveryOrder ? "delivery" : "table";
                            var items = FrontOrderValueReader.CollectItems(order);
                            if (orderCache != null)
                            {
                                foreach (var it in items)
                                {
                                    if (it.CostSum == 0m && !string.IsNullOrEmpty(it.ProductId))
                                    {
                                        var unitCost = orderCache.GetProductUnitCost(it.ProductId);
                                        if (unitCost > 0m)
                                            it.CostSum = unitCost * it.Amount;
                                    }
                                }
                            }
                            if (items.Count == 0)
                            {
                                // Заказ реально оплачен (учтён в ClosedSum/DeliverySum выше), но мы не смогли
                                // прочитать его позиции — вся выручка заказа выпадает из аналитики по блюдам.
                                // Раньше это писалось только в PluginContext.Log (локальный лог iikoFront,
                                // к нам не попадает) — теперь считаем и шлём в backend, чтобы расхождение
                                // "выручка по блюдам" vs "выручка ресторана" было измеримо, а не гипотезой.
                                payload.ClosedOrdersSkippedNoItemsCount++;
                                payload.ClosedOrdersSkippedNoItemsSum += total;
                                PluginDiagnostics.Warning(
                                    $"LiveRevenue: PastOrder #{order.Number} has no readable items, total={total} lost from dish analytics"
                                );
                            }
                            else
                            {
                                var paymentSplit = PastOrderHelpers.SplitPaymentsDetailed(order, excludeNonRevenuePayments: true, treatAsCashPaymentTypes, treatAsNonRevenuePaymentTypes);
                                var itemsNetSum = items.Sum(item => item.NetSum);
                                foreach (var item in items)
                                {
                                    try
                                    {
                                        var revenueSum = AllocateOrderRevenueToItem(item.NetSum, itemsNetSum, paymentSplit.revenue);
                                        var nonRevenueSum = Math.Max(0m, item.NetSum - revenueSum);
                                        AddToDish(payload, orderDate, source, item, waiter, revenueSum, nonRevenueSum);
                                        payload.DishRevenueSum += revenueSum;
                                    }
                                    catch { }
                                }
                                PluginContext.Log.Info($"Reservly PastOrder dishes: source={source}, found={items.Count} dishes for order #{order.Number}");
                            }
                        }
                        catch { }
                    }
                }
                catch { }
            }
        }
        catch (Exception exc)
        {
            PluginContext.Log.Error($"LiveRevenueCollector: failed to collect past orders. {exc.Message}");
            PluginDiagnostics.Error("LiveRevenueCollector: past orders failed.", exc);
        }
    }

    private static void AddToWaiter(FrontLiveRevenuePayload payload, string waiterId, string waiterName, string waiterPhone, decimal sum, int count, int guestsCount)
    {
        var rec = payload.Waiters.FirstOrDefault(w => w.WaiterFrontUserId == waiterId);
        if (rec == null)
        {
            rec = new FrontWaiterDayRecord
            {
                WaiterFrontUserId = waiterId,
                WaiterName = waiterName,
                WaiterPhone = waiterPhone,
            };
            payload.Waiters.Add(rec);
        }
        rec.OrdersCount += count;
        rec.GuestsCount += guestsCount;
        rec.TotalSum += sum;
    }

    private static decimal AllocateOrderRevenueToItem(decimal itemNetSum, decimal orderItemsNetSum, decimal orderRevenueSum)
    {
        if (itemNetSum <= 0m)
        {
            return 0m;
        }
        if (orderItemsNetSum <= 0m)
        {
            return Math.Min(itemNetSum, Math.Max(0m, orderRevenueSum));
        }

        var allocated = itemNetSum * Math.Max(0m, orderRevenueSum) / orderItemsNetSum;
        if (allocated < 0m)
        {
            return 0m;
        }
        return allocated > itemNetSum ? itemNetSum : allocated;
    }

    private static void AddToDish(
        FrontLiveRevenuePayload payload,
        DateTime date,
        string source,
        FrontDeliveryItemRecord item,
        FrontOrderPersonInfo waiter,
        decimal revenueSum,
        decimal nonRevenueSum)
    {
        if (item == null || string.IsNullOrWhiteSpace(item.Name))
        {
            return;
        }

        var count = (int)Math.Max(1, Math.Round((double)item.Amount));
        var price = item.Price > 0m
            ? item.Price
            : count > 0 && item.GrossSum > 0m
                ? item.GrossSum / count
                : 0m;
        var dateText = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var waiterId = waiter == null ? string.Empty : waiter.Id;
        var waiterName = waiter == null ? string.Empty : waiter.Name;
        var waiterPhone = waiter == null ? string.Empty : waiter.Phone;
        var rec = payload.Dishes.FirstOrDefault(d =>
            d.Date == dateText
            && d.DishName == item.Name
            && d.GroupPath == item.GroupPath
            && d.Source == source
            && d.WaiterFrontUserId == waiterId
            && d.WaiterName == waiterName);
        if (rec == null)
        {
            rec = new FrontDishRecord
            {
                Date = dateText,
                DishName = item.Name,
                ProductId = item.ProductId,
                GroupName = item.GroupName,
                GroupPath = item.GroupPath,
                GroupLevel1 = item.GroupLevel1,
                GroupLevel2 = item.GroupLevel2,
                GroupLevel3 = item.GroupLevel3,
                ProductCategory = item.ProductCategory,
                KitchenName = item.KitchenName,
                Source = source,
                WaiterFrontUserId = waiterId,
                WaiterName = waiterName,
                WaiterPhone = waiterPhone,
                MinPrice = price,
                MaxPrice = price,
                LastPrice = price,
            };
            payload.Dishes.Add(rec);
        }
        rec.Count += count;
        rec.GrossRevenue += item.GrossSum;
        rec.DiscountSum += item.DiscountSum;
        rec.NetRevenue += item.NetSum;
        rec.Revenue += revenueSum;
        rec.NonRevenueSum += nonRevenueSum;
        rec.CostSum += item.CostSum;
        if (price > 0m)
        {
            rec.LastPrice = price;
            rec.MinPrice = rec.MinPrice == 0m ? price : Math.Min(rec.MinPrice, price);
            rec.MaxPrice = Math.Max(rec.MaxPrice, price);
        }
    }

    private static DateTime? TryReadReserveDate(object reserve)
    {
        foreach (var propName in new[] { "EstimatedStartTime", "StartTime", "ReserveTime", "Date", "OpenTime" })
        {
            var val = FrontOrderValueReader.ReadProperty(reserve, propName);
            if (val is DateTime dt && dt > DateTime.MinValue.AddDays(1) && dt.Year > 1900)
                return dt;
        }
        return null;
    }

    private static string FirstNonEmpty(params string[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return string.Empty;
    }
}
