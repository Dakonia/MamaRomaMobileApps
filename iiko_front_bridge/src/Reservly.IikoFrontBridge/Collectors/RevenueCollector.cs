using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Reservly.IikoFrontBridge.Collectors;

internal static class RevenueCollector
{
    public static FrontRevenuePayload Collect(
        LiveOrderCache orderCache,
        int lookbackDays,
        int businessDayEndHour = 6,
        bool excludeNonRevenuePayments = false,
        HashSet<string> treatAsCashPaymentTypes = null,
        HashSet<string> treatAsNonRevenuePaymentTypes = null)
    {
        var payload = new FrontRevenuePayload();
        var buckets = new Dictionary<System.DateTime, FrontRevenueDayRecord>();
        var orders = PastOrderHelpers.GetRecentPastOrders(lookbackDays, businessDayEndHour);
        var guestResolver = new OrderGuestCountResolver();
        guestResolver.AddOrders(orderCache?.GetKnownOrders());

        foreach (var order in orders)
        {
            if (!PastOrderHelpers.ShouldIncludeInRevenue(order, excludeNonRevenuePayments, treatAsNonRevenuePaymentTypes))
            {
                continue;
            }

            var workDate = PastOrderHelpers.GetBusinessDay(order.CloseTime, businessDayEndHour);
            if (!buckets.TryGetValue(workDate, out var day))
            {
                day = new FrontRevenueDayRecord
                {
                    Date = workDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                };
                buckets[workDate] = day;
            }

            var paymentTotals = PastOrderHelpers.SplitPaymentsDetailed(order, excludeNonRevenuePayments, treatAsCashPaymentTypes, treatAsNonRevenuePaymentTypes);

            day.TotalAmount += paymentTotals.revenue;
            day.RevenueAmount += paymentTotals.revenue;
            day.NonRevenueAmount += paymentTotals.nonRevenue;
            day.CashAmount += paymentTotals.cash;
            day.CardAmount += paymentTotals.nonCash;
            day.FiscalAmount += paymentTotals.fiscal;
            day.NonFiscalAmount += paymentTotals.nonFiscal;
            day.ReceiptsCount += 1;
            day.GuestsCount += guestResolver.ReadPastOrderGuestCount(order);
        }

        foreach (var day in buckets.OrderBy(pair => pair.Key).Select(pair => pair.Value))
        {
            payload.Days.Add(day);
        }

        return payload;
    }
}
