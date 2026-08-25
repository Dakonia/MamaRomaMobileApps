using System;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Reservly.IikoFrontBridge.Collectors;

internal sealed class FrontOrderPersonInfo
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
}

internal static class OrderIntrospection
{
    public static string ReadDateIso(object obj, params string[] propertyNames)
    {
        var dt = ReadDate(obj, propertyNames);
        return dt.HasValue ? dt.Value.ToString("O", CultureInfo.InvariantCulture) : string.Empty;
    }

    public static DateTimeOffset? ReadDate(object obj, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            var value = FrontOrderValueReader.ReadProperty(obj, propertyName);
            if (value == null)
            {
                continue;
            }

            if (value is DateTimeOffset dto && IsMeaningfulDate(dto.DateTime))
            {
                return dto;
            }

            if (value is DateTime dt && IsMeaningfulDate(dt))
            {
                return dt.Kind == DateTimeKind.Utc
                    ? new DateTimeOffset(dt)
                    : new DateTimeOffset(dt, DateTimeOffset.Now.Offset);
            }

            if (DateTimeOffset.TryParse(value.ToString(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsedDto)
                && IsMeaningfulDate(parsedDto.DateTime))
            {
                return parsedDto;
            }

            if (DateTime.TryParse(value.ToString(), CultureInfo.GetCultureInfo("ru-RU"), DateTimeStyles.None, out var parsedDt)
                && IsMeaningfulDate(parsedDt))
            {
                return parsedDt.Kind == DateTimeKind.Utc
                    ? new DateTimeOffset(parsedDt)
                    : new DateTimeOffset(parsedDt, DateTimeOffset.Now.Offset);
            }
        }

        return null;
    }

    public static string ReadOrderNumber(object order)
    {
        return FrontOrderValueReader.ReadString(order, "Number", "OrderNumber", "Num");
    }

    public static string ReadOrderTypeName(object order)
    {
        var orderType = FrontOrderValueReader.ReadProperty(order, "OrderType");
        if (orderType == null)
        {
            return FrontOrderValueReader.ReadString(order, "OrderTypeName", "Type");
        }

        return FrontOrderValueReader.ReadString(orderType, "Name", "Title");
    }

    public static string ReadServiceType(object order)
    {
        var orderType = FrontOrderValueReader.ReadProperty(order, "OrderType");
        if (orderType == null)
        {
            return FrontOrderValueReader.ReadString(order, "ServiceType", "OrderServiceType");
        }

        return FrontOrderValueReader.ReadString(orderType, "OrderServiceType", "ServiceType");
    }

    public static FrontOrderPersonInfo ReadWaiter(object order)
    {
        var person = new FrontOrderPersonInfo();
        var waiter = FrontOrderValueReader.ReadProperty(order, "Waiter")
                     ?? FrontOrderValueReader.ReadProperty(order, "Server")
                     ?? FrontOrderValueReader.ReadProperty(order, "Cashier")
                     ?? FrontOrderValueReader.ReadProperty(order, "Creator");
        if (waiter == null)
        {
            return person;
        }

        person.Id = FrontOrderValueReader.ReadString(waiter, "Id", "UserId", "EmployeeId");
        person.Name = FrontOrderValueReader.ReadString(waiter, "Name", "FullName", "DisplayName");
        person.Phone = FrontOrderValueReader.ReadString(waiter, "CellPhone", "Phone", "MobilePhone");
        return person;
    }

    public static decimal ReadDiscountSum(object order)
    {
        decimal total = 0m;
        foreach (var discount in FrontOrderValueReader.ReadEnumerable(
                     order,
                     "Discounts",
                     "AppliedDiscounts",
                     "DiscountItems",
                     "DiscountsInfo"))
        {
            var sum = FrontOrderValueReader.ReadDecimal(discount, "Sum", "DiscountSum", "Amount", "ResultSum", "Total");
            total += Math.Abs(sum);
        }

        return total;
    }

    public static string BuildEventKey(params object[] parts)
    {
        var raw = string.Join(
            "|",
            parts.Select(part => Convert.ToString(part, CultureInfo.InvariantCulture) ?? string.Empty)
        );
        using (var sha = SHA256.Create())
        {
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(raw));
            return BitConverter.ToString(bytes).Replace("-", string.Empty).ToLowerInvariant();
        }
    }

    private static bool IsMeaningfulDate(DateTime value)
    {
        return value > DateTime.MinValue.AddDays(1) && value.Year > 1900;
    }
}
