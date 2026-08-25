using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Resto.Front.Api;
using Resto.Front.Api.Data.Orders;

namespace Reservly.IikoFrontBridge.Collectors;

internal sealed class OrderPaymentSnapshotResolver
{
    private readonly List<OrderPaymentOrderSnapshot> _snapshots = new List<OrderPaymentOrderSnapshot>();

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

        var payments = FrontOrderValueReader
            .ReadEnumerable(order, "Payments", "PaymentItems")
            .Select(BuildPaymentSnapshot)
            .Where(payment => payment != null && payment.HasUsefulData)
            .ToList();

        if (payments.Count == 0)
        {
            return;
        }

        var orderNumber = OrderIntrospection.ReadOrderNumber(order);
        var openedAt = NormalizeDateKey(OrderIntrospection.ReadDateIso(order, "OpenTime", "OpenedAt", "WhenOpened", "CreateTime", "CreatedAt"));
        var tableNumber = FrontOrderValueReader.GetFirstTableNumber(order);
        if (string.IsNullOrWhiteSpace(orderNumber) && string.IsNullOrWhiteSpace(openedAt))
        {
            return;
        }

        var existing = _snapshots.FirstOrDefault(snapshot =>
            snapshot.OrderNumber.Equals(orderNumber, StringComparison.OrdinalIgnoreCase)
            && snapshot.OpenedAt.Equals(openedAt, StringComparison.OrdinalIgnoreCase)
            && snapshot.TableNumber.Equals(tableNumber, StringComparison.OrdinalIgnoreCase));

        if (existing == null)
        {
            existing = new OrderPaymentOrderSnapshot
            {
                OrderNumber = orderNumber,
                OpenedAt = openedAt,
                TableNumber = tableNumber,
            };
            _snapshots.Add(existing);
        }

        existing.Payments.Clear();
        existing.Payments.AddRange(payments);
    }

    public OrderPaymentSnapshot FindNonRevenuePayment(PastOrder order, decimal expectedSum)
    {
        if (order == null)
        {
            return null;
        }

        var orderNumber = OrderIntrospection.ReadOrderNumber(order);
        var openedAt = NormalizeDateKey(OrderIntrospection.ReadDateIso(order, "OpenTime", "OpenedAt", "WhenOpened", "CreateTime", "CreatedAt"));
        var tableNumber = FrontOrderValueReader.GetFirstTableNumber(order);

        var orderMatches = _snapshots
            .Where(snapshot =>
                !string.IsNullOrWhiteSpace(snapshot.OrderNumber)
                && snapshot.OrderNumber.Equals(orderNumber, StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrWhiteSpace(snapshot.OpenedAt)
                && snapshot.OpenedAt.Equals(openedAt, StringComparison.OrdinalIgnoreCase)
                && (string.IsNullOrWhiteSpace(tableNumber)
                    || string.IsNullOrWhiteSpace(snapshot.TableNumber)
                    || snapshot.TableNumber.Equals(tableNumber, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        if (orderMatches.Count == 0)
        {
            orderMatches = _snapshots
                .Where(snapshot =>
                    !string.IsNullOrWhiteSpace(snapshot.OrderNumber)
                    && snapshot.OrderNumber.Equals(orderNumber, StringComparison.OrdinalIgnoreCase)
                    && !string.IsNullOrWhiteSpace(snapshot.TableNumber)
                    && snapshot.TableNumber.Equals(tableNumber, StringComparison.OrdinalIgnoreCase))
                .ToList();
        }

        var candidates = orderMatches
            .SelectMany(snapshot => snapshot.Payments)
            .Where(payment => payment.IsNonRevenue)
            .ToList();

        if (candidates.Count == 0)
        {
            return null;
        }

        if (expectedSum > 0m)
        {
            return candidates
                .OrderBy(payment => Math.Abs(Math.Abs(payment.Sum) - expectedSum))
                .ThenByDescending(payment => payment.HasPaymentType)
                .FirstOrDefault();
        }

        return candidates
            .OrderByDescending(payment => payment.HasPaymentType)
            .FirstOrDefault();
    }

    public OrderPaymentSnapshot FindPaymentCounteragent(PastOrder order, string paymentTypeName, decimal sum)
    {
        if (order == null || string.IsNullOrWhiteSpace(paymentTypeName))
        {
            return null;
        }

        var orderNumber = OrderIntrospection.ReadOrderNumber(order);
        var openedAt = NormalizeDateKey(OrderIntrospection.ReadDateIso(order, "OpenTime", "OpenedAt", "WhenOpened", "CreateTime", "CreatedAt"));

        return _snapshots
            .Where(s => !string.IsNullOrWhiteSpace(s.OrderNumber)
                        && s.OrderNumber.Equals(orderNumber, StringComparison.OrdinalIgnoreCase)
                        && (string.IsNullOrWhiteSpace(openedAt) || s.OpenedAt.Equals(openedAt, StringComparison.OrdinalIgnoreCase)))
            .SelectMany(s => s.Payments)
            .FirstOrDefault(p =>
                p.HasCounteragent
                && !string.IsNullOrWhiteSpace(p.PaymentType)
                && p.PaymentType.Equals(paymentTypeName, StringComparison.OrdinalIgnoreCase)
                && Math.Abs(p.Sum - sum) < 0.01m);
    }

    private static OrderPaymentSnapshot BuildPaymentSnapshot(object payment)
    {
        if (payment == null)
        {
            return null;
        }

        var paymentType = FrontOrderValueReader.ReadProperty(payment, "Type")
                          ?? FrontOrderValueReader.ReadProperty(payment, "PaymentType");
        var additionalData = FrontOrderValueReader.ReadProperty(payment, "AdditionalData")
                             ?? FrontOrderValueReader.ReadProperty(payment, "PaymentAdditionalData")
                             ?? FrontOrderValueReader.ReadProperty(payment, "AdditionalInfo")
                             ?? FrontOrderValueReader.ReadProperty(payment, "Data");
        var discountType = FrontOrderValueReader.ReadProperty(paymentType, "DiscountType");
        var authorizationUser = FrontOrderValueReader.ReadProperty(additionalData, "AuthorizationUser");

        var kind = FrontOrderValueReader.ReadString(paymentType, "Kind");
        var typeName = FirstNonEmpty(
            FrontOrderValueReader.ReadString(paymentType, "Name", "Title"),
            SafeObjectText(paymentType)
        );
        var comment = FirstNonEmpty(
            FrontOrderValueReader.ReadString(payment, "Comment", "Reason", "Description"),
            FrontOrderValueReader.ReadString(additionalData, "Comment", "Reason", "Description", "Info", "Data")
        );
        var processAsDiscount = ReadNullableBool(payment, "IsProcessedAsDiscount")
                                ?? ReadNullableBool(paymentType, "ProcessAsDiscount");
        var fiscalizeAsDiscount = ReadNullableBool(payment, "IsFiscalizedAsDiscount")
                                  ?? ReadNullableBool(paymentType, "FiscalizeAsDiscount");
        var printCheque = ReadNullableBool(paymentType, "PrintCheque");

        var counteragentId = ReadCounteragentId(additionalData);
        var counteragentName = string.Empty;
        var counteragentPhone = string.Empty;
        if (!string.IsNullOrWhiteSpace(counteragentId))
        {
            var resolvedUser = TryFindUser(counteragentId);
            var counteragentUserObj = FrontOrderValueReader.ReadProperty(additionalData, "CounteragentUser")
                                     ?? FrontOrderValueReader.ReadProperty(additionalData, "Counteragent");
            counteragentName = FirstNonEmpty(
                FrontOrderValueReader.ReadString(resolvedUser, "Name", "FullName", "DisplayName"),
                FrontOrderValueReader.ReadString(counteragentUserObj, "Name", "FullName", "DisplayName"),
                FrontOrderValueReader.ReadString(additionalData, "CounteragentName", "UserName")
            );
            counteragentPhone = FirstNonEmpty(
                FrontOrderValueReader.ReadString(resolvedUser, "CellPhone", "Phone", "MobilePhone"),
                FrontOrderValueReader.ReadString(counteragentUserObj, "CellPhone", "Phone", "MobilePhone"),
                FrontOrderValueReader.ReadString(additionalData, "CounteragentPhone")
            );
        }

        var snapshot = new OrderPaymentSnapshot
        {
            Sum = FrontOrderValueReader.ReadDecimal(payment, "Sum", "Amount", "PaymentSum"),
            PaymentType = typeName,
            PaymentTypeId = FrontOrderValueReader.ReadString(paymentType, "Id", "PaymentTypeId", "ExternalId"),
            PaymentTypeCode = FrontOrderValueReader.ReadString(paymentType, "Code", "ExternalId", "PrintName"),
            PaymentKind = kind,
            PaymentCategory = NormalizePaymentCategory(kind),
            PaymentComment = comment,
            PaymentPrintCheque = printCheque,
            PaymentProcessAsDiscount = processAsDiscount,
            PaymentFiscalizeAsDiscount = fiscalizeAsDiscount,
            WriteoffAuthorizationUserId = FrontOrderValueReader.ReadString(authorizationUser, "Id", "UserId"),
            WriteoffAuthorizationUserName = FrontOrderValueReader.ReadString(authorizationUser, "Name", "FullName", "DisplayName"),
            WriteoffAuthorizationUserPhone = FrontOrderValueReader.ReadString(authorizationUser, "CellPhone", "Phone", "MobilePhone"),
            WriteoffRatio = ReadNullableDecimal(additionalData, "Ratio"),
            CounteragentId = counteragentId,
            CounteragentName = counteragentName,
            CounteragentPhone = counteragentPhone,
        };

        snapshot.IsNonRevenue = IsNonRevenueSnapshot(snapshot, payment, paymentType, additionalData, discountType);
        return snapshot;
    }

    private static string ReadCounteragentId(object additionalData)
    {
        if (additionalData == null)
        {
            return string.Empty;
        }

        var raw = FirstNonEmpty(
            FrontOrderValueReader.ReadString(additionalData, "CounteragentUserId"),
            FrontOrderValueReader.ReadString(additionalData, "CounteragentId")
        );

        if (string.IsNullOrWhiteSpace(raw))
        {
            return string.Empty;
        }

        Guid parsed;
        if (Guid.TryParse(raw, out parsed) && parsed == Guid.Empty)
        {
            return string.Empty;
        }

        return raw;
    }

    private static object TryFindUser(string userId)
    {
        if (string.IsNullOrWhiteSpace(userId))
        {
            return null;
        }

        try
        {
            var normalized = userId.Trim();
            return PluginContext.Operations.GetUsers()
                .FirstOrDefault(u =>
                    FrontOrderValueReader.ReadString(u, "Id", "UserId")
                        .Equals(normalized, StringComparison.OrdinalIgnoreCase));
        }
        catch
        {
            return null;
        }
    }

    private static bool IsNonRevenueSnapshot(
        OrderPaymentSnapshot snapshot,
        object payment,
        object paymentType,
        object additionalData,
        object discountType)
    {
        if (snapshot.PaymentKind.Equals("Writeoff", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (snapshot.PaymentProcessAsDiscount == true || snapshot.PaymentFiscalizeAsDiscount == true || discountType != null)
        {
            return true;
        }

        var text = string.Join(
            " ",
            new[]
            {
                snapshot.PaymentType,
                snapshot.PaymentKind,
                snapshot.PaymentComment,
                FrontOrderValueReader.ReadString(payment, "Name", "Title", "Comment", "Reason", "Description"),
                FrontOrderValueReader.ReadString(additionalData, "Name", "Title", "Comment", "Reason", "Description", "Info", "Data"),
                FrontOrderValueReader.ReadString(paymentType, "Code", "ExternalId", "Comment", "PrintName", "Name", "Title"),
                FrontOrderValueReader.ReadString(discountType, "Name", "Title"),
                SafeObjectText(payment),
                SafeObjectText(paymentType),
                SafeObjectText(additionalData),
            }.Where(part => !string.IsNullOrWhiteSpace(part))
        ).ToLowerInvariant();

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
            "маркетинг",
            "проблем",
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

    private static string NormalizePaymentCategory(string kind)
    {
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

    private static bool? ReadNullableBool(object obj, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            var value = FrontOrderValueReader.ReadProperty(obj, propertyName);
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
                var text = value.ToString() ?? string.Empty;
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

    private static decimal? ReadNullableDecimal(object obj, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            var value = FrontOrderValueReader.ReadProperty(obj, propertyName);
            if (value == null)
            {
                continue;
            }

            try
            {
                return Convert.ToDecimal(value, CultureInfo.InvariantCulture);
            }
            catch
            {
                decimal parsed;
                var text = value.ToString();
                if (decimal.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out parsed))
                {
                    return parsed;
                }
                if (decimal.TryParse(text, NumberStyles.Any, CultureInfo.GetCultureInfo("ru-RU"), out parsed))
                {
                    return parsed;
                }
            }
        }

        return null;
    }

    private static bool ContainsAny(string haystack, params string[] needles)
    {
        if (string.IsNullOrWhiteSpace(haystack))
        {
            return false;
        }

        return needles.Any(needle => haystack.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0);
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

    private static string SafeObjectText(object value)
    {
        if (value == null)
        {
            return string.Empty;
        }

        var text = value.ToString() ?? string.Empty;
        text = text.Trim();
        return text.StartsWith("Resto.Front.", StringComparison.OrdinalIgnoreCase) ? string.Empty : text;
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

    private sealed class OrderPaymentOrderSnapshot
    {
        public string OrderNumber { get; set; } = string.Empty;
        public string OpenedAt { get; set; } = string.Empty;
        public string TableNumber { get; set; } = string.Empty;
        public List<OrderPaymentSnapshot> Payments { get; } = new List<OrderPaymentSnapshot>();
    }
}

internal sealed class OrderPaymentSnapshot
{
    public decimal Sum { get; set; }
    public string PaymentType { get; set; } = string.Empty;
    public string PaymentTypeId { get; set; } = string.Empty;
    public string PaymentTypeCode { get; set; } = string.Empty;
    public string PaymentKind { get; set; } = string.Empty;
    public string PaymentCategory { get; set; } = string.Empty;
    public string PaymentComment { get; set; } = string.Empty;
    public bool? PaymentPrintCheque { get; set; }
    public bool? PaymentProcessAsDiscount { get; set; }
    public bool? PaymentFiscalizeAsDiscount { get; set; }
    public string WriteoffAuthorizationUserId { get; set; } = string.Empty;
    public string WriteoffAuthorizationUserName { get; set; } = string.Empty;
    public string WriteoffAuthorizationUserPhone { get; set; } = string.Empty;
    public decimal? WriteoffRatio { get; set; }
    public bool IsNonRevenue { get; set; }
    public string CounteragentId { get; set; } = string.Empty;
    public string CounteragentName { get; set; } = string.Empty;
    public string CounteragentPhone { get; set; } = string.Empty;

    public bool HasPaymentType => !string.IsNullOrWhiteSpace(PaymentType);
    public bool HasCounteragent => !string.IsNullOrWhiteSpace(CounteragentId) || !string.IsNullOrWhiteSpace(CounteragentName);

    public bool HasUsefulData =>
        HasPaymentType
        || !string.IsNullOrWhiteSpace(PaymentKind)
        || !string.IsNullOrWhiteSpace(PaymentComment)
        || HasCounteragent
        || Sum != 0m;
}
