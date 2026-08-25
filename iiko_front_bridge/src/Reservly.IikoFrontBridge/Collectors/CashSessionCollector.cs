using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Resto.Front.Api;

namespace Reservly.IikoFrontBridge.Collectors;

internal sealed class CashSessionCollector : IDisposable
{
    private readonly object _gate = new object();
    private readonly HashSet<string> _prevOpenRegisterIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    private bool _seeded;
    private string _lastEmittedDate = string.Empty;

    public CashSessionCollector(string baseDirectory) { }

    public FrontCashSessionPayload TryCollect(int businessDayEndHour)
    {
        var currentOpenIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var infos = PluginContext.Operations.GetCashRegisterInfos();
            foreach (var info in infos)
            {
                var session = PluginContext.Operations.TryGetCafeSessionByCashRegister(info);
                if (session != null)
                    currentOpenIds.Add(info.Id.ToString());
            }
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Error("CashSessionCollector: failed to get register state.", exc);
            return null;
        }

        lock (_gate)
        {
            if (!_seeded)
            {
                _prevOpenRegisterIds.UnionWith(currentOpenIds);
                _seeded = true;
                PluginDiagnostics.Info(
                    $"CashSessionCollector: seeded, open registers={_prevOpenRegisterIds.Count}"
                );
                return null;
            }

            var justClosed = _prevOpenRegisterIds
                .Where(id => !currentOpenIds.Contains(id))
                .ToList();

            _prevOpenRegisterIds.Clear();
            _prevOpenRegisterIds.UnionWith(currentOpenIds);

            if (justClosed.Count == 0)
                return null;

            var businessDate = PastOrderHelpers.GetBusinessDay(DateTime.Now, businessDayEndHour);
            var dateStr = businessDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

            if (dateStr == _lastEmittedDate)
            {
                PluginDiagnostics.Info(
                    $"CashSessionCollector: session closed but already emitted for {dateStr}, skipping."
                );
                return null;
            }

            _lastEmittedDate = dateStr;
            PluginDiagnostics.Info(
                $"CashSessionCollector: shift closed detected, registers={string.Join(",", justClosed)}, business_date={dateStr}"
            );

            return new FrontCashSessionPayload
            {
                BusinessDate = dateStr,
                DetectedAt = DateTimeOffset.Now.ToString("O", CultureInfo.InvariantCulture),
            };
        }
    }

    public void Dispose() { }
}
