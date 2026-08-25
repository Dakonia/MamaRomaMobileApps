using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;

namespace Reservly.IikoFrontBridge.Collectors;

internal static class FrontOrderValueReader
{
    // "Combos" — задокументированное IOrder.Combos (IReadOnlyList<IOrderCombo>), см.
    // https://iiko.github.io/front.api.sdk/v8/html/T_Resto_Front_Api_Data_Orders_IOrderCombo.htm.
    // Это ОТДЕЛЬНАЯ от Items коллекция для комбо/сет-предложений (бизнес-ланч и т.п.) — раньше
    // мы её не читали вообще, такие заказы полностью выпадали из аналитики блюд. IOrderCombo
    // имеет собственные Name/Price/Amount прямо на верхнем уровне (в отличие от IOrderProductItem,
    // где имя нужно доставать через Product), поэтому существующий TryBuildItemRecord подхватит
    // его без изменений — как только коллекция реально enumerated.
    private static readonly string[] DirectItemCollectionNames =
    {
        "Items", "Entries", "OrderItems", "ProductItems", "Dishes", "Combos",
    };

    private static readonly object CostDiagnosticGate = new object();
    private static volatile bool _costDiagnosticLogged;

    private static readonly string[] NestedItemCollectionNames =
    {
        "Components", "Items", "Entries", "Children", "ProductItems", "Parts", "AssignedModifiers",
    };

    public static object ReadProperty(object obj, string propertyName)
    {
        if (obj == null || string.IsNullOrWhiteSpace(propertyName))
        {
            return null;
        }

        try
        {
            var prop = obj.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance);
            return prop == null ? null : prop.GetValue(obj, null);
        }
        catch
        {
            return null;
        }
    }

    public static string ReadString(object obj, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            var value = ReadProperty(obj, propertyName);
            if (value == null)
            {
                continue;
            }

            var text = value.ToString() ?? string.Empty;
            text = text.Trim();
            if (!string.IsNullOrWhiteSpace(text) && !text.StartsWith("Resto.Front.", StringComparison.OrdinalIgnoreCase))
            {
                return text;
            }
        }

        return string.Empty;
    }

    public static string ReadNestedName(object obj, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            var value = ReadProperty(obj, propertyName);
            if (value == null)
            {
                continue;
            }

            var name = ReadString(value, "ProductCustomName", "CustomName", "Name", "Title");
            if (!string.IsNullOrWhiteSpace(name))
            {
                return name;
            }
        }

        return string.Empty;
    }

    public static decimal ReadDecimal(object obj, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            var value = ReadProperty(obj, propertyName);
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

        return 0m;
    }

    private static void LogCostDiagnosticOnce(object item, object product, string dishName)
    {
        if (_costDiagnosticLogged)
        {
            return;
        }
        lock (CostDiagnosticGate)
        {
            if (_costDiagnosticLogged)
            {
                return;
            }
            _costDiagnosticLogged = true;
            try
            {
                var sb = new StringBuilder();
                sb.Append("COST DIAGNOSTIC dish='").Append(dishName).Append("' ");
                AppendScalarProperties(sb, "item", item);
                if (product != null)
                {
                    sb.Append(" ");
                    AppendScalarProperties(sb, "product", product);
                }
                PluginDiagnostics.Warning(sb.ToString());
            }
            catch (Exception ex)
            {
                PluginDiagnostics.Error("Cost diagnostic dump failed", ex);
            }
        }
    }

    private static void AppendScalarProperties(StringBuilder sb, string label, object obj)
    {
        var type = obj.GetType();
        sb.Append(label).Append('[').Append(type.Name).Append("](");
        var first = true;
        foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            if (prop.GetIndexParameters().Length > 0)
            {
                continue;
            }
            object value;
            try
            {
                value = prop.GetValue(obj, null);
            }
            catch
            {
                continue;
            }
            if (value != null && !(value is string) && !(value is ValueType))
            {
                continue;
            }
            if (!first)
            {
                sb.Append("; ");
            }
            first = false;
            sb.Append(prop.Name).Append('=').Append(value);
        }
        sb.Append(')');
    }

    public static bool ReadBool(object obj, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            var value = ReadProperty(obj, propertyName);
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
            }
        }

        return false;
    }

    public static bool HasMeaningfulDate(object obj, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            var value = ReadProperty(obj, propertyName);
            if (value == null)
            {
                continue;
            }

            DateTime dt;
            if (value is DateTime)
            {
                dt = (DateTime)value;
                if (IsMeaningfulDate(dt))
                {
                    return true;
                }
            }
            else if (value is DateTimeOffset)
            {
                var dto = (DateTimeOffset)value;
                if (IsMeaningfulDate(dto.DateTime))
                {
                    return true;
                }
            }
            else if (DateTime.TryParse(value.ToString(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out dt))
            {
                if (IsMeaningfulDate(dt))
                {
                    return true;
                }
            }
            else if (DateTime.TryParse(value.ToString(), CultureInfo.GetCultureInfo("ru-RU"), DateTimeStyles.None, out dt))
            {
                if (IsMeaningfulDate(dt))
                {
                    return true;
                }
            }
        }

        return false;
    }

    public static bool HasReadableObject(object obj, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            var value = ReadProperty(obj, propertyName);
            if (value == null)
            {
                continue;
            }

            if (value is string)
            {
                if (!string.IsNullOrWhiteSpace((string)value))
                {
                    return true;
                }
                continue;
            }

            if (value.GetType().IsValueType)
            {
                if (!Equals(value, Activator.CreateInstance(value.GetType())))
                {
                    return true;
                }
                continue;
            }

            return true;
        }

        return false;
    }

    public static IEnumerable<object> ReadEnumerable(object obj, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            var value = ReadProperty(obj, propertyName);
            if (value == null || value is string)
            {
                continue;
            }

            var enumerable = value as IEnumerable;
            if (enumerable == null)
            {
                continue;
            }

            foreach (var item in enumerable)
            {
                if (item != null)
                {
                    yield return item;
                }
            }
        }
    }

    public static List<FrontDeliveryItemRecord> CollectItems(object order)
    {
        var result = new List<FrontDeliveryItemRecord>();
        if (order == null)
        {
            return result;
        }

        var seenIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var seenRefs = new HashSet<int>();

        foreach (var item in EnumerateTopLevelItems(order))
        {
            CollectItemRecursive(item, result, seenIds, seenRefs, 0);
        }

        return result;
    }

    public static decimal ReadOrderTotal(object order, List<FrontDeliveryItemRecord> items = null)
    {
        var total = ReadDecimal(order, "ResultSum");
        if (total > 0m)
        {
            return total;
        }

        total = ReadDecimal(order, "FullSum");
        if (total > 0m)
        {
            return total;
        }

        total = ReadDecimal(order, "TotalSum", "Sum");
        if (total > 0m)
        {
            return total;
        }

        var collectedItems = items ?? CollectItems(order);
        return collectedItems.Sum(item => item.Cost);
    }

    public static int ReadGuestCount(object order)
    {
        if (order == null)
        {
            return 0;
        }

        var estimated = ReadDecimal(
            order,
            "EstimatedGuestsCount",
            "GuestsCount",
            "GuestCount",
            "CustomerCount",
            "CustomersCount",
            "PersonsCount",
            "PersonCount"
        );
        if (estimated > 0m)
        {
            return (int)Math.Ceiling(estimated);
        }

        var guestsCount = ReadEnumerable(order, "Guests").Count();
        if (guestsCount > 0)
        {
            return guestsCount;
        }

        var innerOrder = ReadProperty(order, "Order");
        if (innerOrder != null && !ReferenceEquals(innerOrder, order))
        {
            return ReadGuestCount(innerOrder);
        }

        return 0;
    }

    public static bool IsClosedCurrentOrder(object order, string status)
    {
        if (!string.IsNullOrWhiteSpace(status)
            && (status.IndexOf("Closed", StringComparison.OrdinalIgnoreCase) >= 0
                || status.IndexOf("Paid", StringComparison.OrdinalIgnoreCase) >= 0
                || status.IndexOf("Deleted", StringComparison.OrdinalIgnoreCase) >= 0
                || status.IndexOf("Cancelled", StringComparison.OrdinalIgnoreCase) >= 0))
        {
            return true;
        }

        if (ReadBool(order, "IsClosed", "Closed", "IsPaid", "IsPayed"))
        {
            return true;
        }

        return HasMeaningfulDate(
            order,
            "CloseTime",
            "ClosedAt",
            "WhenClosed",
            "CloseDate",
            "PaymentTime",
            "PayTime",
            "CashRegisterCloseTime"
        );
    }

    public static bool IsPrebillOrder(object order, string status)
    {
        if (!string.IsNullOrWhiteSpace(status)
            && (status.IndexOf("Bill", StringComparison.OrdinalIgnoreCase) >= 0
                || status.IndexOf("PreBill", StringComparison.OrdinalIgnoreCase) >= 0
                || status.IndexOf("Precheck", StringComparison.OrdinalIgnoreCase) >= 0
                || status.IndexOf("PreCheque", StringComparison.OrdinalIgnoreCase) >= 0
                || status.IndexOf("Preliminary", StringComparison.OrdinalIgnoreCase) >= 0
                || status.IndexOf("Printed", StringComparison.OrdinalIgnoreCase) >= 0
                || status.IndexOf("предч", StringComparison.OrdinalIgnoreCase) >= 0))
        {
            return true;
        }

        if (ReadBool(
            order,
            "IsBillPrinted",
            "BillPrinted",
            "IsPreBill",
            "IsPrecheck",
            "IsPreCheque",
            "PrecheckPrinted",
            "PreChequePrinted"
        ))
        {
            return true;
        }

        if (HasMeaningfulDate(
            order,
            "BillTime",
            "PreBillTime",
            "PrecheckTime",
            "PreChequeTime",
            "BillPrintTime",
            "PrintBillTime",
            "PreliminaryChequeTime",
            "ChequePrintTime"
        ))
        {
            return true;
        }

        return HasReadableObject(
            order,
            "Precheck",
            "PreCheque",
            "PrintedBill",
            "PreliminaryCheque"
        );
    }

    public static (string groupPath, string category) ReadItemGroupInfo(object item)
    {
        var product = ReadProperty(item, "Product")
                      ?? ReadProperty(item, "MenuItem")
                      ?? ReadProperty(item, "Dish")
                      ?? ReadProperty(item, "SimpleProduct")
                      ?? ReadProperty(item, "Template")
                      ?? ReadProperty(item, "Service");

        var groupPath = ReadString(item, "GroupPath", "ProductGroupPath", "CategoryPath", "MenuGroupPath");
        if (string.IsNullOrWhiteSpace(groupPath))
        {
            groupPath = ReadString(product, "GroupPath", "ProductGroupPath", "CategoryPath", "MenuGroupPath");
        }

        if (string.IsNullOrWhiteSpace(groupPath))
        {
            var group = ReadProperty(item, "Group")
                        ?? ReadProperty(item, "ProductGroup")
                        ?? ReadProperty(item, "Category")
                        ?? ReadProperty(item, "MenuGroup")
                        ?? (product != null
                            ? (ReadProperty(product, "Group")
                               ?? ReadProperty(product, "ParentGroup")
                               ?? ReadProperty(product, "ProductGroup")
                               ?? ReadProperty(product, "Category")
                               ?? ReadProperty(product, "MenuGroup"))
                            : null);
            if (group != null)
            {
                var chain = new List<string>();
                var seenRefs2 = new HashSet<int>();
                var current = group;
                while (current != null
                       && seenRefs2.Add(System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(current))
                       && chain.Count < 8)
                {
                    var n = ReadString(current, "Name", "Title");
                    if (!string.IsNullOrWhiteSpace(n)) chain.Insert(0, n);
                    current = ReadProperty(current, "Parent")
                              ?? ReadProperty(current, "ParentGroup")
                              ?? ReadProperty(current, "Group")
                              ?? ReadProperty(current, "Owner");
                }

                if (chain.Count > 0) groupPath = string.Join("/", chain);
            }
        }

        var category = ReadNestedName(product, "ItemCategory", "ProductCategory", "Category");
        if (string.IsNullOrWhiteSpace(category) && product != null)
        {
            var catObj = ReadProperty(product, "ItemCategory");
            if (catObj != null) category = ReadString(catObj, "Code", "Name", "Title");
        }

        return (groupPath ?? string.Empty, category ?? string.Empty);
    }

    public static string GetFirstTableNumber(object order)
    {
        var tables = ReadEnumerable(order, "Tables").ToList();
        foreach (var table in tables)
        {
            var number = ReadString(table, "Number", "Name", "Title");
            if (!string.IsNullOrWhiteSpace(number))
            {
                return number;
            }
        }

        var singleTable = ReadProperty(order, "Table");
        if (singleTable != null)
        {
            var number = ReadString(singleTable, "Number", "Name", "Title");
            if (!string.IsNullOrWhiteSpace(number))
            {
                return number;
            }
        }

        return ReadString(order, "TableNumber", "TableName", "TabName");
    }

    public static string DescribeObject(object obj, int maxProperties = 20)
    {
        if (obj == null)
        {
            return "null";
        }

        try
        {
            var parts = new List<string>();
            foreach (var prop in obj.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance).Take(maxProperties))
            {
                try
                {
                    var value = prop.GetValue(obj, null);
                    if (value is string || value == null || value.GetType().IsValueType)
                    {
                        parts.Add(prop.Name + "=" + (value ?? "null"));
                    }
                    else if (value is IEnumerable)
                    {
                        var count = 0;
                        foreach (var _ in (IEnumerable)value)
                        {
                            count++;
                            if (count > 50)
                            {
                                break;
                            }
                        }
                        parts.Add(prop.Name + "=list(" + count + ")");
                    }
                    else
                    {
                        parts.Add(prop.Name + "=" + value.GetType().Name);
                    }
                }
                catch
                {
                    parts.Add(prop.Name + "=ERR");
                }
            }

            return string.Join("; ", parts);
        }
        catch (Exception exc)
        {
            return obj.GetType().FullName + ": " + exc.Message;
        }
    }

    private static bool IsMeaningfulDate(DateTime value)
    {
        return value > DateTime.MinValue.AddDays(1) && value.Year > 1900;
    }

    private static IEnumerable<object> EnumerateTopLevelItems(object order)
    {
        foreach (var item in ReadEnumerable(order, DirectItemCollectionNames))
        {
            yield return item;
        }

        var innerOrder = ReadProperty(order, "Order");
        if (innerOrder != null && !ReferenceEquals(innerOrder, order))
        {
            foreach (var item in ReadEnumerable(innerOrder, DirectItemCollectionNames))
            {
                yield return item;
            }
        }

        foreach (var guest in ReadEnumerable(order, "Guests"))
        {
            foreach (var item in ReadEnumerable(guest, DirectItemCollectionNames))
            {
                yield return item;
            }
        }
    }

    private static void CollectItemRecursive(
        object item,
        List<FrontDeliveryItemRecord> result,
        HashSet<string> seenIds,
        HashSet<int> seenRefs,
        int depth)
    {
        if (item == null || depth > 4)
        {
            return;
        }

        var refId = RuntimeHelpers.GetHashCode(item);
        if (!seenRefs.Add(refId))
        {
            return;
        }

        if (IsDeletedItem(item))
        {
            return;
        }

        var record = TryBuildItemRecord(item);
        if (record != null)
        {
            var itemId = ReadString(item, "Id");
            var key = !string.IsNullOrWhiteSpace(itemId)
                ? itemId
                : record.Name + "|" + record.Amount.ToString(CultureInfo.InvariantCulture) + "|" + record.NetSum.ToString(CultureInfo.InvariantCulture);
            if (seenIds.Add(key))
            {
                result.Add(record);
            }
            return;
        }

        foreach (var nested in ReadEnumerable(item, NestedItemCollectionNames))
        {
            CollectItemRecursive(nested, result, seenIds, seenRefs, depth + 1);
        }
    }

    private static FrontDeliveryItemRecord TryBuildItemRecord(object item)
    {
        var name = ReadString(item, "ProductCustomName", "CustomName", "DishName", "Name", "Title");
        if (string.IsNullOrWhiteSpace(name))
        {
            name = ReadNestedName(item, "Product", "MenuItem", "Dish", "SimpleProduct", "Template", "Service");
        }
        if (string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        var amount = ReadDecimal(item, "Amount", "Quantity", "Count");
        if (amount <= 0m)
        {
            amount = 1m;
        }

        var price = ReadDecimal(item, "Price", "OpenPrice", "UnitPrice");
        var grossSum = ReadDecimal(item, "SumWithoutDiscounts", "GrossSum", "FullSum", "PriceSum", "CostWithoutDiscounts");
        if (grossSum == 0m && price > 0m)
        {
            grossSum = price * amount;
        }

        var netSum = ReadDecimal(item, "SumWithDiscounts", "NetSum", "ResultSum", "Sum", "TotalSum");
        if (netSum == 0m)
        {
            netSum = grossSum;
        }
        if (grossSum == 0m)
        {
            grossSum = netSum;
        }
        var discountSum = Math.Max(0m, grossSum - netSum);
        if (price == 0m && grossSum > 0m && amount > 0m)
        {
            price = grossSum / amount;
        }

        // IOrderProductItem.Cost is the documented iikoFront SDK field for COGS (confirmed via
        // https://iiko.github.io/front.api.sdk/v7/html/P_Resto_Front_Api_Data_Orders_IOrderProductItem_Cost.htm).
        // It is unit-scale like Price, so it needs the same * amount treatment.
        var unitCost = ReadDecimal(item, "Cost", "UnitCardinalCost", "CostPrice", "UnitCost");
        var costSum = unitCost > 0m ? unitCost * amount : ReadDecimal(item, "CardinalSum", "CostSum");

        var product = ReadProperty(item, "Product")
                      ?? ReadProperty(item, "MenuItem")
                      ?? ReadProperty(item, "Dish")
                      ?? ReadProperty(item, "SimpleProduct")
                      ?? ReadProperty(item, "Template")
                      ?? ReadProperty(item, "Service");

        if (costSum == 0m)
        {
            LogCostDiagnosticOnce(item, product, name);
        }
        var productId = FirstNonEmpty(
            ReadString(product, "Id", "ProductId", "ExternalId"),
            ReadString(item, "ProductId", "DishId", "MenuItemId", "ProductGuid")
        );
        var groupInfo = ProductGroupResolver.Resolve(product, productId, ReadGroupInfo(item, product));
        // IProduct.KitchenName — цех/отделение приготовления товара (см. iikoFront Front API V8 SDK,
        // https://iiko.github.io/front.api.sdk/v8/html/T_Resto_Front_Api_Data_Assortment_IProduct.htm).
        // Это свойство ТОВАРА (не заказа), поэтому доступно и для PastOrderItem.Product в закрытых
        // заказах — в отличие от IOrderCookingItem.Kitchen, который есть только у живых позиций.
        // "Выручка бара" в iiko office считается именно по цеху, а не по группе меню.
        var kitchenName = ReadString(product, "KitchenName");

        return new FrontDeliveryItemRecord
        {
            ProductId = productId,
            Name = name,
            Amount = amount,
            Price = price,
            Cost = netSum,
            CostSum = costSum,
            GrossSum = grossSum,
            DiscountSum = discountSum,
            NetSum = netSum,
            GroupName = groupInfo.name,
            GroupPath = groupInfo.path,
            GroupLevel1 = groupInfo.level1,
            GroupLevel2 = groupInfo.level2,
            GroupLevel3 = groupInfo.level3,
            ProductCategory = groupInfo.category,
            KitchenName = kitchenName,
        };
    }

    private static (string name, string path, string level1, string level2, string level3, string category) ReadGroupInfo(object item, object product)
    {
        var directPath = ReadString(
            item,
            "GroupPath",
            "ProductGroupPath",
            "CategoryPath",
            "MenuGroupPath"
        );
        if (string.IsNullOrWhiteSpace(directPath))
        {
            directPath = ReadString(
                product,
                "GroupPath",
                "ProductGroupPath",
                "CategoryPath",
                "MenuGroupPath"
            );
        }

        var group = ReadProperty(item, "Group")
                    ?? ReadProperty(item, "ProductGroup")
                    ?? ReadProperty(item, "Category")
                    ?? ReadProperty(item, "MenuGroup")
                    ?? ReadProperty(product, "Group")
                    ?? ReadProperty(product, "ParentGroup")
                    ?? ReadProperty(product, "ProductGroup")
                    ?? ReadProperty(product, "Category")
                    ?? ReadProperty(product, "MenuGroup");

        var chain = ReadGroupChain(group);
        if (string.IsNullOrWhiteSpace(directPath) && chain.Count > 0)
        {
            directPath = string.Join("/", chain);
        }

        var parts = SplitGroupPath(directPath);
        var name = parts.Count > 0 ? parts[parts.Count - 1] : string.Empty;
        if (string.IsNullOrWhiteSpace(name))
        {
            name = ReadString(group, "Name", "Title");
        }

        var category = ReadNestedName(product, "ItemCategory", "ProductCategory", "Category");
        if (string.IsNullOrWhiteSpace(category))
        {
            category = ReadString(FrontOrderValueReader.ReadProperty(product, "ItemCategory"), "Code", "Name", "Title");
        }

        return (
            name,
            directPath,
            parts.Count > 0 ? parts[0] : string.Empty,
            parts.Count > 1 ? parts[1] : string.Empty,
            parts.Count > 2 ? parts[2] : string.Empty,
            category
        );
    }

    private static List<string> ReadGroupChain(object group)
    {
        var result = new List<string>();
        var seen = new HashSet<int>();
        var current = group;

        while (current != null && seen.Add(RuntimeHelpers.GetHashCode(current)) && result.Count < 8)
        {
            var name = ReadString(current, "Name", "Title");
            if (!string.IsNullOrWhiteSpace(name))
            {
                result.Insert(0, name);
            }

            current = ReadProperty(current, "Parent")
                      ?? ReadProperty(current, "ParentGroup")
                      ?? ReadProperty(current, "Group")
                      ?? ReadProperty(current, "Owner");
        }

        return result;
    }

    private static List<string> SplitGroupPath(string groupPath)
    {
        if (string.IsNullOrWhiteSpace(groupPath))
        {
            return new List<string>();
        }

        return groupPath
            .Replace("\\", "/")
            .Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Trim())
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .Take(8)
            .ToList();
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

    private static bool IsDeletedItem(object item)
    {
        if (ReadBool(item, "Deleted", "IsDeleted"))
        {
            return true;
        }

        var status = ReadString(item, "Status");
        return status.IndexOf("Deleted", StringComparison.OrdinalIgnoreCase) >= 0
            || status.IndexOf("Cancelled", StringComparison.OrdinalIgnoreCase) >= 0;
    }
}
