using System;
using System.Collections.Generic;
using System.IO;
using Reservly.IikoFrontBridge.MamaRoma;

namespace Reservly.IikoFrontBridge;

internal sealed class BridgeConfig
{
    public string BackendUrl { get; set; } = string.Empty;
    public string Secret { get; set; } = string.Empty;
    public string InstallationId { get; set; } = string.Empty;
    public string DiagnosticsLogLevel { get; set; } = "warn";
    public int PollIntervalSeconds { get; set; } = 30;
    public int PingIntervalSeconds { get; set; } = 900;
    public bool SyncEmployees { get; set; } = true;
    public bool SyncAttendance { get; set; } = true;
    public bool SyncRevenue { get; set; } = true;
    public bool SyncDeliveries { get; set; } = true;
    public bool SyncReportSnapshots { get; set; } = false;
    public bool SyncTableOrders { get; set; } = true;
    public bool SyncLiveRevenue { get; set; } = true;
    public bool SyncStopList { get; set; } = true;
    public bool SyncBridgeStatus { get; set; } = true;
    public bool OfflineQueueEnabled { get; set; } = true;
    public bool SyncOrderLifecycle { get; set; } = true;
    public bool SyncOrderAudit { get; set; } = true;
    public bool SyncDailyReconciliation { get; set; } = true;
    public bool SyncCashSession { get; set; } = true;
    public bool ExcludeNonRevenuePayments { get; set; } = true;
    // Payment type names (exact iiko name) that should be counted as cash instead of card.
    // Use for Credit/external types like "Невский тур", "Вкладчики" that represent real cash receipts.
    public List<string> TreatAsCashPaymentTypes { get; set; } = new List<string>();
    // Payment type names (exact iiko name) that should be treated as "без выручки" (non-revenue).
    // Use for shareholder/internal account types like "Вкладчики" — no real money changes hands.
    public List<string> TreatAsNonRevenuePaymentTypes { get; set; } = new List<string>();
    public int LiveRevenueSyncIntervalMinutes { get; set; } = 1;
    public int StopListSyncIntervalMinutes { get; set; } = 5;
    public int BridgeStatusSyncIntervalMinutes { get; set; } = 5;
    public int OrderLifecycleSyncIntervalMinutes { get; set; } = 2;
    public int OrderAuditSyncIntervalMinutes { get; set; } = 5;
    public int DailyReconciliationSyncIntervalMinutes { get; set; } = 30;
    public int EmployeesSyncIntervalMinutes { get; set; } = 1440;
    public int MinAttendanceMinutesToSend { get; set; } = 15;
    public int AttendanceLookbackDays { get; set; } = 3;
    public int PastOrdersLookbackDays { get; set; } = 2;
    public int BusinessDayEndHour { get; set; } = 6;
    public int AttendanceReportSyncIntervalMinutes { get; set; } = 30;
    public int RevenueReportSyncIntervalMinutes { get; set; } = 30;
    public int DeliveryReportSyncIntervalMinutes { get; set; } = 30;
    public int LicenseStatusSyncIntervalMinutes { get; set; } = 15;
    public string AttendanceReportId { get; set; } = "EMPLOYEES_ATTENDANCES_REPORT";
    public string RevenueReportId { get; set; } = "SALES_BY_TYPE_WITH_TAX_SESSION_REPORT";
    public string DeliveryReportId { get; set; } = "DELIVERY_REPORT";
    public string ReportSessionPin { get; set; } = string.Empty;

    /// <summary>
    /// Интеграция с мобильным приложением сети. Отдельная секция со своим адресом
    /// и секретом: настройки здесь никак не влияют на отправку в Reservly.
    /// Секции нет в файле — интеграция просто не запускается.
    /// </summary>
    public MamaRomaConfig MamaRoma { get; set; } = new MamaRomaConfig();

    public static BridgeConfig Load(string baseDirectory)
    {
        var path = Path.Combine(baseDirectory, "bridge.settings.json");
        if (!File.Exists(path))
        {
            throw new FileNotFoundException("bridge.settings.json not found", path);
        }

        var json = File.ReadAllText(path);
        var config = BridgeJson.DeserializeCaseInsensitive<BridgeConfig>(json);
        if (config == null)
        {
            throw new InvalidOperationException("bridge.settings.json is empty");
        }
        if (string.IsNullOrWhiteSpace(config.BackendUrl))
        {
            throw new InvalidOperationException("backendUrl is required");
        }
        if (string.IsNullOrWhiteSpace(config.Secret))
        {
            throw new InvalidOperationException("secret is required");
        }
        if (config.PollIntervalSeconds < 30)
        {
            config.PollIntervalSeconds = 30;
        }
        if (config.PingIntervalSeconds < 30)
        {
            config.PingIntervalSeconds = 30;
        }
        config.DiagnosticsLogLevel = NormalizeDiagnosticsLogLevel(config.DiagnosticsLogLevel);
        if (config.PastOrdersLookbackDays < 1)
        {
            config.PastOrdersLookbackDays = 1;
        }
        if (config.BusinessDayEndHour < 0 || config.BusinessDayEndHour > 12)
        {
            config.BusinessDayEndHour = 6;
        }
        if (config.EmployeesSyncIntervalMinutes < 1)
        {
            config.EmployeesSyncIntervalMinutes = 1;
        }
        if (config.AttendanceLookbackDays < 1)
        {
            config.AttendanceLookbackDays = 1;
        }
        if (config.MinAttendanceMinutesToSend < 1)
        {
            config.MinAttendanceMinutesToSend = 1;
        }
        if (config.AttendanceReportSyncIntervalMinutes < 1)
        {
            config.AttendanceReportSyncIntervalMinutes = 1;
        }
        if (config.RevenueReportSyncIntervalMinutes < 1)
        {
            config.RevenueReportSyncIntervalMinutes = 1;
        }
        if (config.DeliveryReportSyncIntervalMinutes < 1)
        {
            config.DeliveryReportSyncIntervalMinutes = 1;
        }
        if (config.LiveRevenueSyncIntervalMinutes < 1)
        {
            config.LiveRevenueSyncIntervalMinutes = 1;
        }
        if (config.StopListSyncIntervalMinutes < 1)
        {
            config.StopListSyncIntervalMinutes = 1;
        }
        if (config.BridgeStatusSyncIntervalMinutes < 1)
        {
            config.BridgeStatusSyncIntervalMinutes = 1;
        }
        if (config.OrderLifecycleSyncIntervalMinutes < 1)
        {
            config.OrderLifecycleSyncIntervalMinutes = 1;
        }
        if (config.OrderAuditSyncIntervalMinutes < 1)
        {
            config.OrderAuditSyncIntervalMinutes = 1;
        }
        if (config.DailyReconciliationSyncIntervalMinutes < 1)
        {
            config.DailyReconciliationSyncIntervalMinutes = 1;
        }
        if (config.LicenseStatusSyncIntervalMinutes < 1)
        {
            config.LicenseStatusSyncIntervalMinutes = 1;
        }
        // Секции может не быть вовсе — тогда интеграция приложения просто выключена
        if (config.MamaRoma == null)
        {
            config.MamaRoma = new MamaRomaConfig();
        }
        config.MamaRoma.Normalize();

        return config;
    }

    private static string NormalizeDiagnosticsLogLevel(string value)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        switch (normalized)
        {
            case "debug":
            case "trace":
            case "info":
                return "info";
            case "warning":
            case "warn":
                return "warn";
            case "error":
                return "error";
            case "off":
            case "none":
                return "off";
            default:
                return "warn";
        }
    }
}
