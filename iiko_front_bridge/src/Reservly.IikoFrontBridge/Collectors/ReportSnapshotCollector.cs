using System;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using Resto.Front.Api;

namespace Reservly.IikoFrontBridge.Collectors;

internal static class ReportSnapshotCollector
{
    public static ReportSnapshotResult Collect(string reportId, string reportSessionPin = null)
    {
        var hostPointOfSaleRegisters = PluginContext.Operations
            .GetHostTerminalPointsOfSale()
            .Where(pos => pos?.CashRegister != null)
            .Select(pos => pos.CashRegister)
            .ToList();

        var cashRegister =
            hostPointOfSaleRegisters.FirstOrDefault(
                info => PluginContext.Operations.TryGetCafeSessionByCashRegister(info) != null
            )
            ?? hostPointOfSaleRegisters.FirstOrDefault()
            ?? PluginContext.Operations
                .GetCashRegisterInfos()
                .FirstOrDefault(info => PluginContext.Operations.TryGetCafeSessionByCashRegister(info) != null)
            ?? PluginContext.Operations.GetCashRegisterInfos().FirstOrDefault();

        var currentUser = PluginContext.Operations.GetCurrentUser();
        var cashRegisterName = cashRegister?.ToString() ?? string.Empty;

        // If no one is logged in and a service PIN is configured — open a temporary personal session,
        // get the report, then close the session. The PIN belongs to a designated service employee
        // in iiko (configured in bridge.settings.json as reportSessionPin).
        Action closeSession = () => { };

        if (currentUser == null && !string.IsNullOrEmpty(reportSessionPin))
        {
            try
            {
                var creds = PluginContext.Operations.AuthenticateByPin(reportSessionPin);
                PluginContext.Operations.OpenPersonalSession(creds);
                closeSession = () =>
                {
                    try { PluginContext.Operations.ClosePersonalSession(creds); }
                    catch (Exception ex) { PluginDiagnostics.Warning($"Report snapshot: ClosePersonalSession failed: {ex.Message}"); }
                };
                currentUser = PluginContext.Operations.GetCurrentUser();
                PluginDiagnostics.Info($"Report snapshot: opened session via PIN, user={currentUser?.Name ?? "unknown"}");
            }
            catch (Exception ex)
            {
                PluginDiagnostics.Warning($"Report snapshot: PIN auth failed: {ex.Message}");
            }
        }

        var markup = string.Empty;
        try
        {
            var document = PluginContext.Operations.GetReportMarkupById(reportId, cashRegister);
            if (document != null)
            {
                XElement xml = document;
                markup = xml?.ToString(SaveOptions.DisableFormatting) ?? string.Empty;
            }
        }
        finally
        {
            closeSession();
        }

        var isUnavailable = markup.Contains("Отчет недоступен");
        var currentUserName = currentUser?.Name ?? string.Empty;

        PluginContext.Log.Info(
            $"Reservly report snapshot: reportId={reportId}, currentUser={currentUserName}, cashRegister={cashRegister}, " +
            $"hostPosRegisters={hostPointOfSaleRegisters.Count}, markupLength={markup.Length}, unavailable={isUnavailable}"
        );
        PluginDiagnostics.Info(
            $"Report snapshot collected: reportId={reportId}, currentUser={currentUserName}, " +
            $"markupLength={markup.Length}, unavailable={isUnavailable}"
        );

        return new ReportSnapshotResult
        {
            Payload = new ReportSnapshotPayload
            {
                ReportId = reportId,
                Markup = markup,
                CurrentUser = currentUserName,
                CashRegister = cashRegisterName,
                Unavailable = isUnavailable,
            },
            PayloadHash = ComputeHash(markup),
            IsUnavailable = isUnavailable,
        };
    }

    private static string ComputeHash(string value)
    {
        using (var sha = SHA256.Create())
        {
            var bytes = Encoding.UTF8.GetBytes(value ?? string.Empty);
            var hash = sha.ComputeHash(bytes);
            return BitConverter.ToString(hash).Replace("-", string.Empty);
        }
    }
}
