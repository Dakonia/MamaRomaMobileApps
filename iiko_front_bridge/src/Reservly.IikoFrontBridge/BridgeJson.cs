using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Web.Script.Serialization;

namespace Reservly.IikoFrontBridge;

internal static class BridgeJson
{
    public static string SerializeCamelCase(object value)
    {
        return CreateSerializer().Serialize(NormalizeForJson(value, camelCase: true));
    }

    public static string Serialize(object value)
    {
        return CreateSerializer().Serialize(NormalizeForJson(value, camelCase: false));
    }

    public static T DeserializeCaseInsensitive<T>(string json)
    {
        var serializer = CreateSerializer();
        var raw = serializer.DeserializeObject(json);
        return (T)ConvertValue(raw, typeof(T));
    }

    private static JavaScriptSerializer CreateSerializer()
    {
        return new JavaScriptSerializer
        {
            MaxJsonLength = int.MaxValue,
            RecursionLimit = 512,
        };
    }

    private static object NormalizeForJson(object value, bool camelCase)
    {
        if (value == null)
        {
            return null;
        }

        if (value is string || value is bool || IsNumeric(value.GetType()))
        {
            return value;
        }

        if (value is DateTimeOffset dateTimeOffset)
        {
            return dateTimeOffset.ToString("O", CultureInfo.InvariantCulture);
        }

        if (value is DateTime dateTime)
        {
            return dateTime.ToString("O", CultureInfo.InvariantCulture);
        }

        if (value is IDictionary dictionary)
        {
            var result = new Dictionary<string, object>();
            foreach (DictionaryEntry entry in dictionary)
            {
                var key = entry.Key?.ToString() ?? string.Empty;
                result[key] = NormalizeForJson(entry.Value, camelCase);
            }
            return result;
        }

        if (value is IEnumerable enumerable)
        {
            var result = new List<object>();
            foreach (var item in enumerable)
            {
                result.Add(NormalizeForJson(item, camelCase));
            }
            return result;
        }

        var properties = value.GetType()
            .GetProperties(BindingFlags.Instance | BindingFlags.Public)
            .Where(prop => prop.CanRead && prop.GetIndexParameters().Length == 0);
        var obj = new Dictionary<string, object>();
        foreach (var property in properties)
        {
            var key = camelCase ? ToCamelCase(property.Name) : property.Name;
            obj[key] = NormalizeForJson(property.GetValue(value), camelCase);
        }
        return obj;
    }

    private static object ConvertValue(object value, Type targetType)
    {
        if (value == null)
        {
            return null;
        }

        var nullableType = Nullable.GetUnderlyingType(targetType);
        if (nullableType != null)
        {
            return ConvertValue(value, nullableType);
        }

        if (targetType == typeof(string))
        {
            return Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
        }

        if (targetType == typeof(bool))
        {
            return Convert.ToBoolean(value, CultureInfo.InvariantCulture);
        }

        if (targetType == typeof(int))
        {
            return Convert.ToInt32(value, CultureInfo.InvariantCulture);
        }

        if (targetType == typeof(long))
        {
            return Convert.ToInt64(value, CultureInfo.InvariantCulture);
        }

        if (targetType == typeof(decimal))
        {
            return Convert.ToDecimal(value, CultureInfo.InvariantCulture);
        }

        if (targetType == typeof(double))
        {
            return Convert.ToDouble(value, CultureInfo.InvariantCulture);
        }

        if (targetType == typeof(DateTime))
        {
            return DateTime.Parse(Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
        }

        if (targetType == typeof(DateTimeOffset))
        {
            return DateTimeOffset.Parse(Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
        }

        if (targetType.IsEnum)
        {
            return Enum.Parse(targetType, Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty, ignoreCase: true);
        }

        if (targetType.IsGenericType && targetType.GetGenericTypeDefinition() == typeof(List<>))
        {
            var itemType = targetType.GetGenericArguments()[0];
            var list = (IList)Activator.CreateInstance(targetType);
            if (value is IEnumerable enumerable)
            {
                foreach (var item in enumerable)
                {
                    list.Add(ConvertValue(item, itemType));
                }
            }
            return list;
        }

        if (value is IDictionary<string, object> genericMap)
        {
            return ConvertMap(genericMap, targetType);
        }

        if (value is Dictionary<string, object> map)
        {
            return ConvertMap(map, targetType);
        }

        return Convert.ChangeType(value, targetType, CultureInfo.InvariantCulture);
    }

    private static object ConvertMap(IDictionary<string, object> map, Type targetType)
    {
        var instance = Activator.CreateInstance(targetType, nonPublic: true);
        var values = new Dictionary<string, object>(map, StringComparer.OrdinalIgnoreCase);
        foreach (var property in targetType.GetProperties(BindingFlags.Instance | BindingFlags.Public))
        {
            if (!property.CanWrite)
            {
                continue;
            }

            if (!values.TryGetValue(property.Name, out var rawValue))
            {
                continue;
            }

            property.SetValue(instance, ConvertValue(rawValue, property.PropertyType));
        }
        return instance;
    }

    private static bool IsNumeric(Type type)
    {
        type = Nullable.GetUnderlyingType(type) ?? type;
        return type == typeof(byte)
               || type == typeof(short)
               || type == typeof(ushort)
               || type == typeof(int)
               || type == typeof(uint)
               || type == typeof(long)
               || type == typeof(ulong)
               || type == typeof(float)
               || type == typeof(double)
               || type == typeof(decimal);
    }

    private static string ToCamelCase(string value)
    {
        if (string.IsNullOrEmpty(value) || char.IsLower(value[0]))
        {
            return value;
        }

        if (value.Length == 1)
        {
            return value.ToLowerInvariant();
        }

        return char.ToLowerInvariant(value[0]) + value.Substring(1);
    }
}
