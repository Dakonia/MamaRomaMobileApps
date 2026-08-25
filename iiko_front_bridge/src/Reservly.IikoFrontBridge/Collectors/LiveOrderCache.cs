using System;
using System.Collections.Generic;
using System.Linq;
using Resto.Front.Api;
using Resto.Front.Api.Data.Common;
using Resto.Front.Api.Data.Orders;

namespace Reservly.IikoFrontBridge.Collectors;

internal sealed class LiveOrderCache : IDisposable
{
    private readonly Dictionary<Guid, dynamic> _orders = new Dictionary<Guid, dynamic>();
    private readonly Dictionary<Guid, dynamic> _knownOrders = new Dictionary<Guid, dynamic>();
    private readonly Dictionary<string, decimal> _productUnitCosts = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
    // OrderStatus в SDK не хранит "предчек отменён" как факт (только New/Bill/Closed/Deleted) —
    // ловим отмену как живой откат статуса Bill (счёт напечатан) обратно на New (стол снова открыт).
    private readonly Dictionary<Guid, string> _lastStatus = new Dictionary<Guid, string>();
    private readonly List<PrebillCancellationRecord> _detectedPrebillCancellations = new List<PrebillCancellationRecord>();
    private readonly object _lock = new object();
    private IDisposable _subscription;
    private bool _seeded;

    public LiveOrderCache()
    {
        try
        {
            _subscription = PluginContext.Notifications.OrderChanged.Subscribe(
                new ActionObserver<EntityChangedEventArgs<IOrder>>(
                    OnOrderChanged,
                    exc =>
                    {
                        PluginDiagnostics.Info($"LiveOrderCache: OrderChanged error: {exc.Message}");
                    }
                )
            );
            PluginDiagnostics.Info("LiveOrderCache: subscribed to OrderChanged event.");
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info($"LiveOrderCache: OrderChanged subscribe failed: {exc.Message}");
        }
    }

    private void OnOrderChanged(EntityChangedEventArgs<IOrder> args)
    {
        try
        {
            if (args.Entity == null)
            {
                PluginDiagnostics.Info("LiveOrderCache: OnOrderChanged Entity=null (notification-only mode, no entity data).");
                return;
            }

            dynamic order = (dynamic)args.Entity;

            Guid id = Guid.Empty;
            try { id = args.Entity.Id; } catch { }
            if (id == Guid.Empty)
            {
                try { id = new Guid(args.Entity.Id.ToString()); } catch { }
            }
            if (id == Guid.Empty)
            {
                PluginDiagnostics.Info("LiveOrderCache: OnOrderChanged Entity.Id empty, skipping.");
                return;
            }

            var status = string.Empty;
            try { status = order.Status?.ToString() ?? string.Empty; } catch { }

            var isActiveTerminal = FrontOrderScanner.IsClosedDeletedOrCancelled(status);
            var isRemoved = FrontOrderScanner.IsDeletedOrCancelled(status);

            int cacheSize;
            int knownSize;
            lock (_lock)
            {
                string previousStatus;
                _lastStatus.TryGetValue(id, out previousStatus);

                if (string.Equals(previousStatus, "Bill", StringComparison.OrdinalIgnoreCase)
                    && string.Equals(status, "New", StringComparison.OrdinalIgnoreCase))
                {
                    _detectedPrebillCancellations.Add(new PrebillCancellationRecord
                    {
                        OrderId = id,
                        DetectedAt = DateTimeOffset.Now,
                        Order = order,
                    });
                    PluginDiagnostics.Info($"LiveOrderCache: detected prebill cancellation for order {id} (status Bill -> New).");
                }

                if (isRemoved)
                {
                    _lastStatus.Remove(id);
                }
                else
                {
                    _lastStatus[id] = status;
                }

                if (isActiveTerminal)
                {
                    _orders.Remove(id);
                }
                else
                {
                    _orders[id] = order;
                }

                if (isRemoved)
                {
                    _knownOrders.Remove(id);
                }
                else
                {
                    _knownOrders[id] = order;
                }

                cacheSize = _orders.Count;
                knownSize = _knownOrders.Count;
            }

            PluginDiagnostics.Info($"LiveOrderCache: order {id} status={status} activeTerminal={isActiveTerminal} knownSize={knownSize} cacheSize={cacheSize}");
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info($"LiveOrderCache: OnOrderChanged exception: {exc.GetType().Name}: {exc.Message}");
        }
    }

    public List<PrebillCancellationRecord> DrainDetectedPrebillCancellations()
    {
        lock (_lock)
        {
            if (_detectedPrebillCancellations.Count == 0)
            {
                return new List<PrebillCancellationRecord>();
            }
            var result = new List<PrebillCancellationRecord>(_detectedPrebillCancellations);
            _detectedPrebillCancellations.Clear();
            return result;
        }
    }

    public List<dynamic> GetActiveOrders()
    {
        lock (_lock)
        {
            return _orders.Values.ToList();
        }
    }

    public List<dynamic> GetKnownOrders()
    {
        lock (_lock)
        {
            return _knownOrders.Values.ToList();
        }
    }

    public void RefreshFromFullScan(IEnumerable<dynamic> orders)
    {
        if (orders == null)
        {
            return;
        }

        var active = new Dictionary<Guid, dynamic>();
        var known = new Dictionary<Guid, dynamic>();

        foreach (var order in orders)
        {
            try
            {
                var idText = (string)FrontOrderScanner.GetOrderId(order);
                Guid id;
                if (!Guid.TryParse(idText, out id) || id == Guid.Empty)
                {
                    continue;
                }

                var status = (string)FrontOrderScanner.GetStatus(order);
                if (FrontOrderScanner.IsDeletedOrCancelled(status))
                {
                    continue;
                }

                known[id] = order;
                if (!FrontOrderScanner.IsClosedDeletedOrCancelled(status))
                {
                    active[id] = order;
                }
            }
            catch { }
        }

        lock (_lock)
        {
            _orders.Clear();
            foreach (var pair in active)
            {
                _orders[pair.Key] = pair.Value;
            }

            foreach (var pair in known)
            {
                _knownOrders[pair.Key] = pair.Value;
            }
            _seeded = true;
        }
    }

    // Kept for older call paths. Full scans are now done by FrontOrderScanner.
    public void SeedIfEmpty()
    {
        lock (_lock)
        {
            if (_seeded) return;
            _seeded = true;
        }

        PluginDiagnostics.Info("LiveOrderCache: starting seed scan...");

        var scan = FrontOrderScanner.GetCurrentTableOrders();
        if (scan.Success)
        {
            RefreshFromFullScan(scan.Orders);
            PluginDiagnostics.Info($"LiveOrderCache: seeded from full scan, orders={scan.Orders.Count}.");
        }
        else
        {
            PluginDiagnostics.Info($"LiveOrderCache: seed failed: {scan.Error}");
        }
    }

    // Populated from live IOrderProductItem.Cost while orders are open.
    // IPastOrderItem does not expose Cost, so this cache bridges the gap.
    public void UpdateProductCost(string productId, decimal unitCost)
    {
        if (string.IsNullOrEmpty(productId) || unitCost <= 0m) return;
        lock (_lock)
        {
            _productUnitCosts[productId] = unitCost;
        }
    }

    public decimal GetProductUnitCost(string productId)
    {
        if (string.IsNullOrEmpty(productId)) return 0m;
        lock (_lock)
        {
            decimal val;
            return _productUnitCosts.TryGetValue(productId, out val) ? val : 0m;
        }
    }

    public void Dispose()
    {
        _subscription?.Dispose();
    }
}

internal sealed class PrebillCancellationRecord
{
    public Guid OrderId { get; set; }
    public DateTimeOffset DetectedAt { get; set; }
    public dynamic Order { get; set; }
}
