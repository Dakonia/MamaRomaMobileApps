using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Resto.Front.Api;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Organization;
using Resto.Front.Api.Data.Payments;

namespace Reservly.IikoFrontBridge.Collectors;

internal static class PastOrderHelpers
{
    // Orders closed before this hour on the NEXT calendar day still belong to the previous business day.
    // Example: businessDayEndHour=6 → order closed June 8 at 01:00 → business day = June 7.
    public static DateTime GetBusinessDay(DateTime dt, int businessDayEndHour)
    {
        return dt.Hour < businessDayEndHour ? dt.Date.AddDays(-1) : dt.Date;
    }

    // lookbackDays is counted in BUSINESS days, not calendar days.
    // At 03:00 with businessDayEndHour=6 the current business day is still "yesterday",
    // so without this correction lookback=2 would reach 2 calendar days further back than intended.
    public static IReadOnlyCollection<PastOrder> GetRecentPastOrders(int lookbackDays, int businessDayEndHour = 6)
    {
        var now = DateTime.Now;
        var businessDay = GetBusinessDay(now, businessDayEndHour);
        var earliestBusinessDay = businessDay.AddDays(-Math.Max(lookbackDays, 1) + 1);
        // Business day N starts at businessDayEndHour of calendar day N.
        var minCloseTime = earliestBusinessDay.AddHours(businessDayEndHour);
        return PluginContext.Operations.GetPastOrders(
            orderNumber: null,
            minCloseTime: minCloseTime,
            maxCloseTime: now,
            isEndOfOrderNumber: false
        );
    }

    public static decimal SumPayments(PastOrder order)
    {
        return (order.Payments ?? Array.Empty<PastOrderPayment>())
            .Sum(payment => payment?.Sum ?? 0m);
    }

    public static decimal SumRevenuePayments(PastOrder order, bool excludeNonRevenuePayments, HashSet<string> treatAsNonRevenue = null)
    {
        var unexposedNonRevenue = GetUnexposedNonRevenueSum(order);
        if (unexposedNonRevenue > 0m)
        {
            return excludeNonRevenuePayments ? 0m : unexposedNonRevenue;
        }

        var payments = order.Payments ?? Array.Empty<PastOrderPayment>();
        if (!excludeNonRevenuePayments)
        {
            return payments.Sum(payment => payment?.Sum ?? 0m);
        }

        return payments
            .Where(payment => payment != null
                && !IsNonRevenuePayment(order, payment)
                && !IsTreatAsNonRevenue(payment, treatAsNonRevenue))
            .Sum(payment => payment.Sum);
    }

    private static bool IsTreatAsNonRevenue(PastOrderPayment payment, HashSet<string> treatAsNonRevenue)
    {
        if (treatAsNonRevenue == null || treatAsNonRevenue.Count == 0 || payment?.PaymentType == null)
            return false;
        var name = GetPaymentTypeName(payment);
        return !string.IsNullOrWhiteSpace(name) && treatAsNonRevenue.Contains(name);
    }

    // Returns true if the payment type name is in the "treat as cash" set.
    // Used for Credit/external payment types (e.g. "Невский тур") that the
    // restaurant wants counted as operational cash rather than card/non-cash.
    private static bool IsTreatAsCash(PastOrderPayment payment, HashSet<string> treatAsCash)
    {
        if (treatAsCash == null || treatAsCash.Count == 0 || payment?.PaymentType == null)
        {
            return false;
        }
        var name = GetPaymentTypeName(payment);
        return !string.IsNullOrWhiteSpace(name) && treatAsCash.Contains(name);
    }

    public static (decimal cash, decimal card) SplitPayments(PastOrder order, HashSet<string> treatAsCash = null)
    {
        decimal cash = 0m;
        decimal nonCash = 0m;

        foreach (var payment in order.Payments ?? Array.Empty<PastOrderPayment>())
        {
            if (payment?.PaymentType == null)
            {
                continue;
            }

            if (payment.PaymentType.Kind == PaymentTypeKind.Cash || IsTreatAsCash(payment, treatAsCash))
            {
                cash += payment.Sum;
            }
            else
            {
                nonCash += payment.Sum;
            }
        }

        return (cash, nonCash);
    }

    public static (decimal cash, decimal nonCash, decimal revenue, decimal nonRevenue, decimal fiscal, decimal nonFiscal)
        SplitPaymentsDetailed(PastOrder order, bool excludeNonRevenuePayments, HashSet<string> treatAsCash = null, HashSet<string> treatAsNonRevenue = null)
    {
        decimal cash = 0m;
        decimal nonCash = 0m;
        decimal revenue = 0m;
        decimal nonRevenue = 0m;
        decimal fiscal = 0m;
        decimal nonFiscal = 0m;

        foreach (var payment in order.Payments ?? Array.Empty<PastOrderPayment>())
        {
            if (payment == null)
            {
                continue;
            }

            var isNonRevenue = IsNonRevenuePayment(order, payment) || IsTreatAsNonRevenue(payment, treatAsNonRevenue);
            var isNonFiscal = IsNonFiscalPayment(payment);
            var includeInRevenueBreakdown = !isNonRevenue || !excludeNonRevenuePayments;
            var sum = payment.Sum;
            if (includeInRevenueBreakdown)
            {
                if (payment.PaymentType?.Kind == PaymentTypeKind.Cash || IsTreatAsCash(payment, treatAsCash))
                {
                    cash += sum;
                }
                else
                {
                    nonCash += sum;
                }
            }

            if (isNonRevenue)
            {
                nonRevenue += sum;
            }
            else
            {
                revenue += sum;
            }

            if (isNonFiscal)
            {
                nonFiscal += sum;
            }
            else
            {
                fiscal += sum;
            }
        }

        var unexposedNonRevenue = GetUnexposedNonRevenueSum(order);
        if (unexposedNonRevenue > 0m)
        {
            nonRevenue += unexposedNonRevenue;
            nonFiscal += unexposedNonRevenue;
        }

        if (!excludeNonRevenuePayments)
        {
            revenue += nonRevenue;
        }

        return (cash, nonCash, revenue, nonRevenue, fiscal, nonFiscal);
    }

    // When excludeNonRevenue=true, only orders with real revenue payments pass.
    // Orders closed as "без выручки" or paid entirely with treatAsNonRevenue types are excluded.
    public static bool ShouldIncludeInRevenue(PastOrder order, bool excludeNonRevenue = false, HashSet<string> treatAsNonRevenue = null)
    {
        if (order == null || order.Deleted || order.Storned)
        {
            return false;
        }

        if (excludeNonRevenue)
        {
            return SumRevenuePayments(order, excludeNonRevenuePayments: true, treatAsNonRevenue) > 0m;
        }

        return SumPayments(order) != 0m || GetUnexposedNonRevenueSum(order) > 0m;
    }

    public static decimal GetUnexposedNonRevenueSum(PastOrder order)
    {
        if (order == null || order.Deleted || order.Storned)
        {
            return 0m;
        }

        var hasNonZeroPayment = (order.Payments ?? Array.Empty<PastOrderPayment>())
            .Any(payment => payment != null && payment.Sum != 0m);
        if (hasNonZeroPayment)
        {
            return 0m;
        }

        var items = FrontOrderValueReader.CollectItems(order);
        var total = FrontOrderValueReader.ReadOrderTotal(order, items);
        return total > 0m ? total : 0m;
    }

    public static string GetOrderId(PastOrder order)
    {
        if (order == null)
        {
            return string.Empty;
        }

        var direct = FrontOrderValueReader.ReadString(order, "Id");
        if (!string.IsNullOrWhiteSpace(direct))
        {
            return direct;
        }

        var number = FrontOrderValueReader.ReadString(order, "Number", "OrderNumber");
        return !string.IsNullOrWhiteSpace(number)
            ? "past-" + number + "-" + order.CloseTime.ToString("yyyyMMddHHmmss")
            : "past-" + order.CloseTime.ToString("yyyyMMddHHmmss");
    }

    public static string GetPaymentTypeName(PastOrderPayment payment)
    {
        if (payment?.PaymentType == null)
        {
            return string.Empty;
        }

        var name = FrontOrderValueReader.ReadString(payment.PaymentType, "Name", "Title");
        return !string.IsNullOrWhiteSpace(name)
            ? name
            : payment.PaymentType.ToString();
    }

    public static string GetPaymentKindName(PastOrderPayment payment)
    {
        return payment?.PaymentType?.Kind.ToString() ?? string.Empty;
    }

    public static string GetPaymentCategory(PastOrderPayment payment)
    {
        var kind = GetPaymentKindName(payment);
        if (string.IsNullOrWhiteSpace(kind))
        {
            return string.Empty;
        }

        switch (kind.Trim().ToLowerInvariant())
        {
            case "cash":
                return "cash";
            case "card":
            case "sberbank":
            case "trpos":
            case "smartsale":
                return "card";
            case "credit":
                return "credit";
            case "writeoff":
                return "writeoff";
            case "voucher":
                return "voucher";
            case "external":
                return "external";
            default:
                return kind.Trim().ToLowerInvariant();
        }
    }

    public static string GetPaymentTypeId(PastOrderPayment payment)
    {
        return FrontOrderValueReader.ReadString(payment?.PaymentType, "Id", "PaymentTypeId", "ExternalId");
    }

    public static string GetPaymentTypeCode(PastOrderPayment payment)
    {
        return FrontOrderValueReader.ReadString(payment?.PaymentType, "Code", "ExternalId", "PrintName");
    }

    public static bool? ReadPaymentTypeBool(PastOrderPayment payment, params string[] propertyNames)
    {
        var paymentType = payment?.PaymentType;
        if (paymentType == null)
        {
            return null;
        }

        foreach (var propertyName in propertyNames)
        {
            var value = FrontOrderValueReader.ReadProperty(paymentType, propertyName);
            if (value == null)
            {
                continue;
            }

            try
            {
                return Convert.ToBoolean(value, CultureInfo.InvariantCulture);
            }
            catch
            {
                var text = (value.ToString() ?? string.Empty).Trim();
                if (text.Equals("true", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
                if (text.Equals("false", StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }
            }
        }

        return null;
    }

    public static bool IsPaymentProcessedAsDiscount(PastOrderPayment payment)
    {
        return ReadPaymentTypeBool(payment, "ProcessAsDiscount") == true;
    }

    public static bool IsPaymentFiscalizedAsDiscount(PastOrderPayment payment)
    {
        return ReadPaymentTypeBool(payment, "FiscalizeAsDiscount") == true;
    }

    public static bool IsPaymentPrintedOnCheque(PastOrderPayment payment)
    {
        return ReadPaymentTypeBool(payment, "PrintCheque") == true;
    }

    public static string GetWriteoffReason(PastOrder order)
    {
        return FrontOrderValueReader.ReadString(order, "WriteoffReason", "WriteOffReason", "Reason", "Comment");
    }

    public static string GetPaymentComment(PastOrder order, PastOrderPayment payment)
    {
        var additionalData = GetPaymentAdditionalData(payment);
        return FirstNonEmpty(
            FrontOrderValueReader.ReadString(payment, "Comment", "Reason", "Description"),
            FrontOrderValueReader.ReadString(additionalData, "Comment", "Reason", "Description", "Info", "Data"),
            FrontOrderValueReader.ReadString(payment?.PaymentType, "Comment", "PrintName"),
            GetWriteoffReason(order)
        );
    }

    public static FrontOrderPersonInfo GetPaymentCounteragent(PastOrderPayment payment)
    {
        var additionalData = GetPaymentAdditionalData(payment);
        var id = FirstNonEmpty(
            FrontOrderValueReader.ReadString(payment, "CounteragentUserId", "CounteragentId", "UserId", "ClientId", "GuestId"),
            FrontOrderValueReader.ReadString(additionalData, "CounteragentUserId", "CounteragentId", "UserId", "ClientId", "GuestId")
        );
        var name = FirstNonEmpty(
            FrontOrderValueReader.ReadString(payment, "CounteragentName", "UserName", "ClientName", "GuestName", "Name"),
            FrontOrderValueReader.ReadString(additionalData, "CounteragentName", "UserName", "ClientName", "GuestName", "Name")
        );
        var phone = FirstNonEmpty(
            FrontOrderValueReader.ReadString(payment, "CounteragentPhone", "Phone", "ClientPhone", "GuestPhone"),
            FrontOrderValueReader.ReadString(additionalData, "CounteragentPhone", "Phone", "ClientPhone", "GuestPhone")
        );

        if (!string.IsNullOrWhiteSpace(id) && (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(phone)))
        {
            var user = TryFindUser(id);
            if (user != null)
            {
                name = FirstNonEmpty(name, FrontOrderValueReader.ReadString(user, "Name", "FullName", "DisplayName"));
                phone = FirstNonEmpty(phone, FrontOrderValueReader.ReadString(user, "CellPhone", "Phone", "MobilePhone"));
            }
        }

        return new FrontOrderPersonInfo
        {
            Id = id,
            Name = name,
            Phone = phone,
        };
    }

    public static bool IsWriteoffPayment(PastOrderPayment payment)
    {
        return GetPaymentKindName(payment).Equals("Writeoff", StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsNonRevenuePayment(PastOrder order, PastOrderPayment payment)
    {
        return IsNonRevenuePayment(payment, GetWriteoffReason(order));
    }

    public static bool IsNonRevenuePayment(PastOrderPayment payment)
    {
        return IsNonRevenuePayment(payment, string.Empty);
    }

    private static bool IsNonRevenuePayment(PastOrderPayment payment, string extraSearchText)
    {
        if (IsWriteoffPayment(payment))
        {
            return true;
        }

        if (IsPaymentProcessedAsDiscount(payment) || IsPaymentFiscalizedAsDiscount(payment))
        {
            return true;
        }

        if (FrontOrderValueReader.ReadProperty(payment?.PaymentType, "DiscountType") != null)
        {
            return true;
        }

        var text = BuildPaymentSearchText(payment, extraSearchText);
        return ContainsAny(
            text,
            "без выруч",
            "без оплаты",
            "безоплат",
            "представ",
            "представитель",
            "себесто",
            "служеб",
            "персонал",
            "комплимент",
            "comp",
            "complimentary",
            "non revenue",
            "non-revenue",
            "writeoff",
            "write-off",
            "write off",
            "no revenue"
        );
    }

    public static bool IsNonFiscalPayment(PastOrderPayment payment)
    {
        if (ReadPaymentTypeBool(payment, "PrintCheque") == false || IsPaymentFiscalizedAsDiscount(payment))
        {
            return true;
        }

        var text = BuildPaymentSearchText(payment);
        return ContainsAny(
            text,
            "нефиск",
            "не фиск",
            "non fiscal",
            "non-fiscal",
            "nonfiscal",
            "external"
        );
    }

    public static bool IsDeliveryOrder(IOrderType orderType)
    {
        if (orderType == null)
        {
            return false;
        }

        var serviceType = orderType.OrderServiceType.ToString();
        if (serviceType.IndexOf("Delivery", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            return true;
        }

        var name = orderType.Name ?? string.Empty;
        return name.IndexOf("достав", StringComparison.OrdinalIgnoreCase) >= 0
            || name.IndexOf("delivery", StringComparison.OrdinalIgnoreCase) >= 0
            || name.IndexOf("pickup", StringComparison.OrdinalIgnoreCase) >= 0
            || name.IndexOf("самовывоз", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static string BuildPaymentSearchText(PastOrderPayment payment, string extraSearchText = "")
    {
        if (payment == null)
        {
            return string.Empty;
        }

        var additionalData = GetPaymentAdditionalData(payment);

        var parts = new[]
        {
            GetPaymentTypeName(payment),
            GetPaymentKindName(payment),
            FrontOrderValueReader.ReadString(payment, "Name", "Title", "Comment", "Reason", "Description"),
            FrontOrderValueReader.ReadString(additionalData, "Name", "Title", "Comment", "Reason", "Description", "Info", "Data"),
            FrontOrderValueReader.ReadString(payment.PaymentType, "Code", "ExternalId", "Comment", "PrintName"),
            FrontOrderValueReader.ReadString(payment.PaymentType, "Name", "Title"),
            FrontOrderValueReader.ReadString(FrontOrderValueReader.ReadProperty(payment.PaymentType, "DiscountType"), "Name", "Title"),
            extraSearchText,
            payment.ToString(),
            payment.PaymentType?.ToString(),
            additionalData?.ToString(),
        };

        return string.Join(" ", parts.Where(part => !string.IsNullOrWhiteSpace(part))).ToLowerInvariant();
    }

    private static object GetPaymentAdditionalData(PastOrderPayment payment)
    {
        return FrontOrderValueReader.ReadProperty(payment, "AdditionalData")
               ?? FrontOrderValueReader.ReadProperty(payment, "PaymentAdditionalData")
               ?? FrontOrderValueReader.ReadProperty(payment, "AdditionalInfo")
               ?? FrontOrderValueReader.ReadProperty(payment, "Data");
    }

    private static object TryFindUser(string userId)
    {
        if (string.IsNullOrWhiteSpace(userId))
        {
            return null;
        }

        try
        {
            var normalizedId = userId.Trim();
            return PluginContext.Operations.GetUsers()
                .FirstOrDefault(user =>
                    FrontOrderValueReader.ReadString(user, "Id", "UserId").Equals(normalizedId, StringComparison.OrdinalIgnoreCase));
        }
        catch
        {
            return null;
        }
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

    private static bool ContainsAny(string haystack, params string[] needles)
    {
        if (string.IsNullOrWhiteSpace(haystack))
        {
            return false;
        }

        foreach (var needle in needles)
        {
            if (haystack.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return true;
            }
        }

        return false;
    }
}
