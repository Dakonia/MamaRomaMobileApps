using System;
using System.Collections.Generic;
using Resto.Front.Api;

namespace Reservly.IikoFrontBridge.Collectors;

internal sealed class FrontOrderScanResult
{
    public bool Success { get; set; }
    public List<dynamic> Orders { get; set; } = new List<dynamic>();
    public string Error { get; set; } = string.Empty;
}

internal static class FrontOrderScanner
{
    public static FrontOrderScanResult GetCurrentTableOrders()
    {
        var result = new FrontOrderScanResult();

        try
        {
            foreach (var order in PluginContext.Operations.GetOrders(false, true))
            {
                if (order != null)
                {
                    result.Orders.Add((dynamic)order);
                }
            }

            result.Success = true;
            PluginDiagnostics.Info($"FrontOrderScanner: GetOrders(false, true) returned {result.Orders.Count} table orders.");
            return result;
        }
        catch (Exception directExc)
        {
            result.Error = directExc.Message;
            PluginDiagnostics.Info($"FrontOrderScanner: typed GetOrders(false, true) failed: {directExc.GetType().Name}: {directExc.Message}");
        }

        try
        {
            dynamic ops = PluginContext.Operations;
            var orders = ops.GetOrders(false, true);
            foreach (var order in orders)
            {
                if (order != null)
                {
                    result.Orders.Add((dynamic)order);
                }
            }

            result.Success = true;
            result.Error = string.Empty;
            PluginDiagnostics.Info($"FrontOrderScanner: dynamic GetOrders(false, true) returned {result.Orders.Count} table orders.");
            return result;
        }
        catch (Exception dynExc)
        {
            result.Error = dynExc.Message;
            PluginDiagnostics.Info($"FrontOrderScanner: dynamic GetOrders(false, true) failed: {dynExc.GetType().Name}: {dynExc.Message}");
        }

        try
        {
            dynamic ops = PluginContext.Operations;
            var orders = ops.GetOrders();
            foreach (var order in orders)
            {
                if (order != null && !LooksLikeDeliveryOrder(order))
                {
                    result.Orders.Add((dynamic)order);
                }
            }

            result.Success = true;
            result.Error = string.Empty;
            PluginDiagnostics.Info($"FrontOrderScanner: dynamic GetOrders() fallback returned {result.Orders.Count} table orders.");
        }
        catch (Exception fallbackExc)
        {
            result.Success = false;
            result.Error = fallbackExc.Message;
            PluginDiagnostics.Info($"FrontOrderScanner: GetOrders() fallback failed: {fallbackExc.GetType().Name}: {fallbackExc.Message}");
        }

        return result;
    }

    public static string GetOrderId(dynamic order)
    {
        try
        {
            var value = order.Id?.ToString() ?? string.Empty;
            return value.Trim();
        }
        catch
        {
            return string.Empty;
        }
    }

    public static string GetStatus(dynamic order)
    {
        try
        {
            return order.Status?.ToString() ?? string.Empty;
        }
        catch
        {
            return string.Empty;
        }
    }

    public static bool IsDeletedOrCancelled(string status)
    {
        return status.IndexOf("Deleted", StringComparison.OrdinalIgnoreCase) >= 0
            || status.IndexOf("Cancelled", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    public static bool IsClosedDeletedOrCancelled(string status)
    {
        return status.IndexOf("Closed", StringComparison.OrdinalIgnoreCase) >= 0
            || IsDeletedOrCancelled(status);
    }

    private static bool LooksLikeDeliveryOrder(dynamic order)
    {
        try
        {
            var orderType = order.OrderType;
            if (orderType == null)
            {
                return false;
            }

            var serviceType = orderType.OrderServiceType?.ToString() ?? string.Empty;
            var name = orderType.Name?.ToString() ?? string.Empty;
            return serviceType.IndexOf("Delivery", StringComparison.OrdinalIgnoreCase) >= 0
                || name.IndexOf("достав", StringComparison.OrdinalIgnoreCase) >= 0
                || name.IndexOf("delivery", StringComparison.OrdinalIgnoreCase) >= 0
                || name.IndexOf("pickup", StringComparison.OrdinalIgnoreCase) >= 0
                || name.IndexOf("самовывоз", StringComparison.OrdinalIgnoreCase) >= 0;
        }
        catch
        {
            return false;
        }
    }
}
