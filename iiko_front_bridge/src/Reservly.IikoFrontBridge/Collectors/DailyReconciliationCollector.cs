using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Reservly.IikoFrontBridge.Collectors;

internal static class DailyReconciliationCollector
{
    public static FrontDailyReconciliationPayload Collect(
        int lookbackDays,
        int businessDayEndHour,
        bool excludeNonRevenuePayments,
        HashSet<string> treatAsNonRevenuePaymentTypes = null)
    {
        var payload = new FrontDailyReconciliationPayload();
        var buckets = new Dictionary<DateTime, FrontDailyReconciliationRecord>();

        foreach (var order in PastOrderHelpers.GetRecentPastOrders(lookbackDays, businessDayEndHour))
        {
            try
            {
                var workDate = PastOrderHelpers.GetBusinessDay(order.CloseTime, businessDayEndHour);
                if (!buckets.TryGetValue(workDate, out var day))
                {
                    day = new FrontDailyReconciliationRecord
                    {
                        Date = workDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                        Status = "ok",
                        CapturedAt = DateTimeOffset.Now.ToString("O", CultureInfo.InvariantCulture),
                    };
                    buckets[workDate] = day;
                }

                if (order.Deleted)
                {
                    day.DeletedOrdersCount++;
                }
                if (order.Storned)
                {
                    day.StornoOrdersCount++;
                }

                var discountSum = OrderIntrospection.ReadDiscountSum(order);
                var deletedItemsSum = OrderAuditCollector.SumDeletedItems(order);
                day.DiscountsAmount += discountSum;
                day.DeletedItemsAmount += deletedItemsSum;

                if (!PastOrderHelpers.ShouldIncludeInRevenue(order, excludeNonRevenuePayments, treatAsNonRevenuePaymentTypes))
                {
                    continue;
                }

                day.ClosedOrdersCount++;
                var payments = PastOrderHelpers.SplitPaymentsDetailed(order, excludeNonRevenuePayments, treatAsNonRevenue: treatAsNonRevenuePaymentTypes);
                day.RevenueAmount += payments.revenue;
                day.NonRevenueAmount += payments.nonRevenue;
                day.FiscalAmount += payments.fiscal;
                day.NonFiscalAmount += payments.nonFiscal;
            }
            catch (Exception exc)
            {
                PluginDiagnostics.Info($"DailyReconciliationCollector: order skipped: {exc.Message}");
            }
        }

        foreach (var day in buckets.OrderBy(pair => pair.Key).Select(pair => pair.Value))
        {
            FinalizeDay(day);
            payload.Days.Add(day);
        }

        PluginDiagnostics.Info($"DailyReconciliationCollector: built {payload.Days.Count} day records.");
        return payload;
    }

    private static void FinalizeDay(FrontDailyReconciliationRecord day)
    {
        if (day.NonRevenueAmount != 0m)
        {
            day.Warnings.Add("Есть оплаты без выручки / представительские.");
        }
        if (day.NonFiscalAmount != 0m)
        {
            day.Warnings.Add("Есть нефискальные оплаты.");
        }
        if (day.DeletedOrdersCount > 0)
        {
            day.Warnings.Add("Есть удаленные заказы.");
        }
        if (day.StornoOrdersCount > 0)
        {
            day.Warnings.Add("Есть сторно.");
        }
        if (day.DeletedItemsAmount != 0m)
        {
            day.Warnings.Add("Есть удаления блюд.");
        }
        if (day.DiscountsAmount != 0m)
        {
            day.Warnings.Add("Есть скидки.");
        }

        day.DifferenceSum = day.RevenueAmount - day.RevenueEntrySum;
        if (day.RevenueEntrySum != 0m && Math.Abs(day.DifferenceSum) >= 1m)
        {
            day.Status = "mismatch";
            return;
        }

        day.Status = day.Warnings.Count > 0 ? "warning" : "ok";
    }
}
