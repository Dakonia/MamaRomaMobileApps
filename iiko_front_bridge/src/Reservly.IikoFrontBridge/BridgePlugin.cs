using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Resto.Front.Api;
using Resto.Front.Api.Attributes;
using Resto.Front.Api.Data.Common;
using Resto.Front.Api.Data.Orders;
using Reservly.IikoFrontBridge.Collectors;
using Reservly.IikoFrontBridge.MamaRoma;

namespace Reservly.IikoFrontBridge;

[PluginLicenseModuleId(19011701)]
public sealed class BridgePlugin : IFrontPlugin, IDisposable
{
    private const string PluginVersion = "0.4.9";
    private const int LicenseModuleId = 19011701;

    private sealed class ReportSyncRule
    {
        public string ReportId { get; set; } = string.Empty;
        public int IntervalMinutes { get; set; }
    }

    private sealed class ReportSyncState
    {
        public DateTimeOffset LastAttemptAt { get; set; } = DateTimeOffset.MinValue;
        public string LastPayloadHash { get; set; } = string.Empty;
    }

    private sealed class EventSyncState
    {
        public DateTimeOffset LastSentAt { get; set; } = DateTimeOffset.MinValue;
        public string LastPayloadHash { get; set; } = string.Empty;
    }

    private sealed class PayloadDeltaResult
    {
        public object Payload { get; set; } = new object();
        public Action Commit { get; set; }
        public int TotalRecords { get; set; }
        public int ChangedRecords { get; set; }
    }

    private sealed class EventBuildResult
    {
        public List<QueuedFrontEvent> Events { get; } = new List<QueuedFrontEvent>();

        public void Add(FrontEventEnvelope frontEvent, Action commit = null)
        {
            var queuedEvent = new QueuedFrontEvent
            {
                Event = frontEvent,
            };
            if (commit != null)
            {
                queuedEvent.Commits.Add(commit);
            }
            Events.Add(queuedEvent);
        }

        public void AddCommitToLastEvent(Action commit)
        {
            if (commit == null || Events.Count == 0)
            {
                return;
            }

            Events[Events.Count - 1].Commits.Add(commit);
        }
    }

    private sealed class QueuedFrontEvent
    {
        public FrontEventEnvelope Event { get; set; } = new FrontEventEnvelope();
        public List<Action> Commits { get; } = new List<Action>();

        public void Commit()
        {
            foreach (var commit in Commits)
            {
                commit();
            }
        }
    }

    private enum EventAddResult
    {
        Queued,
        Duplicate,
        Failed,
    }

    private readonly BridgeConfig _config;
    private readonly BackendClient _backendClient;
    private readonly AttendanceSessionTracker _attendanceSessionTracker;
    private readonly BookingOrderCollector _bookingOrderCollector;
    private readonly LiveOrderCache _liveOrderCache;
    private readonly DishSnapshotCache _dishSnapshotCache = new DishSnapshotCache();
    private readonly CashSessionCollector _cashSessionCollector;
    private readonly IDisposable _deliveryOrderChangedSubscription;
    private readonly Timer _timer;
    private readonly SemaphoreSlim _syncLock = new SemaphoreSlim(1, 1);
    private readonly Dictionary<string, ReportSyncState> _reportSyncStates = new Dictionary<string, ReportSyncState>();
    private readonly Dictionary<string, EventSyncState> _eventSyncStates = new Dictionary<string, EventSyncState>();
    private readonly Dictionary<string, string> _recordPayloadHashes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    private string _lastAttendancePayloadHash = string.Empty;
    private long _lastAttendanceClosedStateVersion = -1;
    private string _lastAttendanceEligibleOpenFingerprint = string.Empty;
    private DateTimeOffset _lastAttendanceOpenSentAt = DateTimeOffset.MinValue;
    private DateTimeOffset _lastPingSentAt = DateTimeOffset.MinValue;
    private IDisposable _licenseSlot;
    private int _deliveryOrderChangeSignal;

    /// <summary>
    /// Интеграция с мобильным приложением сети. Живёт своим таймером и своим
    /// клиентом — цикл Reservly её не касается. Null, если секция не настроена.
    /// </summary>
    private readonly MamaRomaWorker _mamaRomaWorker;

    public BridgePlugin()
    {
        var baseDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)
                            ?? AppDomain.CurrentDomain.BaseDirectory;
        PluginDiagnostics.Initialize(baseDirectory);
        _config = BridgeConfig.Load(baseDirectory);
        PluginDiagnostics.Configure(_config.DiagnosticsLogLevel);
        _backendClient = new BackendClient(_config, baseDirectory);
        _attendanceSessionTracker = new AttendanceSessionTracker(baseDirectory);
        _cashSessionCollector = new CashSessionCollector(baseDirectory);
        _liveOrderCache = new LiveOrderCache();
        _bookingOrderCollector = new BookingOrderCollector(_liveOrderCache);
        _deliveryOrderChangedSubscription = SubscribeDeliveryOrderChanged();

        // Интеграция приложения поднимается последней и в своей песочнице:
        // если она не настроена или упала при старте, TryCreate вернёт null,
        // а сбор данных для Reservly запустится как обычно
        _mamaRomaWorker = MamaRomaWorker.TryCreate(_config.MamaRoma, baseDirectory);

        _timer = new Timer(OnTimer, null, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(_config.PollIntervalSeconds));
        PluginContext.Log.Info($"Reservly iikoFront bridge started. Poll interval: {_config.PollIntervalSeconds}s.");
        PluginDiagnostics.Info(
            $"Bridge started. PollIntervalSeconds={_config.PollIntervalSeconds}, " +
            $"SyncAttendance={_config.SyncAttendance}, SyncRevenue={_config.SyncRevenue}, " +
            $"SyncDeliveries={_config.SyncDeliveries}, SyncReportSnapshots={_config.SyncReportSnapshots}, " +
            $"SyncTableOrders={_config.SyncTableOrders}, SyncLiveRevenue={_config.SyncLiveRevenue}, " +
            $"SyncStopList={_config.SyncStopList}, " +
            $"SyncBridgeStatus={_config.SyncBridgeStatus}, OfflineQueue={_config.OfflineQueueEnabled}, " +
            $"SyncOrderLifecycle={_config.SyncOrderLifecycle}, SyncOrderAudit={_config.SyncOrderAudit}, " +
            $"SyncDailyReconciliation={_config.SyncDailyReconciliation}, " +
            $"ExcludeNonRevenuePayments={_config.ExcludeNonRevenuePayments}, " +
            $"DiagnosticsLogLevel={_config.DiagnosticsLogLevel}"
        );
    }

    private IDisposable SubscribeDeliveryOrderChanged()
    {
        try
        {
            var subscription = PluginContext.Notifications.DeliveryOrderChanged.Subscribe(
                new ActionObserver<EntityChangedEventArgs<IDeliveryOrder>>(
                    _ =>
                    {
                        Interlocked.Exchange(ref _deliveryOrderChangeSignal, 1);
                        PluginDiagnostics.Info("DeliveryOrderChanged event received — deliveries will be reconciled on next poll.");
                    },
                    exc =>
                    {
                        PluginDiagnostics.Info($"DeliveryOrderChanged subscription error: {exc.Message}");
                    }
                )
            );
            PluginDiagnostics.Info("BridgePlugin: subscribed to DeliveryOrderChanged.");
            return subscription;
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info($"BridgePlugin: DeliveryOrderChanged not available, polling deliveries only. {exc.Message}");
            return null;
        }
    }

    private async void OnTimer(object _)
    {
        if (!await _syncLock.WaitAsync(0))
        {
            return;
        }

        try
        {
            await PushSnapshotAsync(CancellationToken.None);
        }
        catch (Exception exc)
        {
            PluginContext.Log.Error($"Reservly bridge sync failed. {exc.Message}");
            PluginDiagnostics.Error("Bridge sync failed.", exc);
        }
        finally
        {
            _syncLock.Release();
        }
    }

    private async Task PushSnapshotAsync(CancellationToken cancellationToken)
    {
        var terminal = PluginContext.Operations.GetHostTerminal();
        var buildResult = BuildEvents();
        if (buildResult.Events.Count == 0)
        {
            PluginDiagnostics.Info("No events collected for this poll cycle.");
            return;
        }

        var installationId = string.IsNullOrWhiteSpace(_config.InstallationId)
            ? PluginContext.Operations.GetOrganizationFingerprint().ToString()
            : _config.InstallationId;
        var terminalName = terminal?.ToString() ?? "iikoFront";
        var sentCount = 0;
        var failedCount = 0;

        foreach (var queuedEvent in buildResult.Events)
        {
            var envelope = new FrontEnvelope
            {
                InstallationId = installationId,
                TerminalName = terminalName,
                BatchId = Guid.NewGuid().ToString("N"),
                Events = new List<FrontEventEnvelope> { queuedEvent.Event },
            };

            try
            {
                await _backendClient.PushAsync(envelope, cancellationToken);
                queuedEvent.Commit();
                sentCount++;
            }
            catch (Exception exc)
            {
                failedCount++;
                PluginContext.Log.Error(
                    $"Reservly bridge failed to push event '{queuedEvent.Event.Type}'. {exc.Message}"
                );
                PluginDiagnostics.Error(
                    $"Bridge failed to push event '{queuedEvent.Event.Type}'.",
                    exc
                );
            }
        }

        PluginDiagnostics.Info(
            $"Bridge push cycle finished: collected={buildResult.Events.Count}, sent={sentCount}, failed={failedCount}"
        );
    }

    private EventBuildResult BuildEvents()
    {
        var capturedAt = DateTimeOffset.Now;
        var result = new EventBuildResult();

        if (capturedAt - _lastPingSentAt >= TimeSpan.FromSeconds(_config.PingIntervalSeconds))
        {
            result.Add(
                new FrontEventEnvelope
                {
                    Type = "ping",
                    CapturedAt = capturedAt,
                    Payload = new
                    {
                        pluginVersion = PluginVersion,
                        api = "V8",
                    },
                },
                () => _lastPingSentAt = capturedAt
            );
        }

        if (_config.SyncBridgeStatus)
        {
            TryAddHashedEvent(
                result,
                capturedAt,
                "bridge_status",
                () => CollectBridgeStatus(capturedAt),
                TimeSpan.FromMinutes(_config.BridgeStatusSyncIntervalMinutes)
            );
        }

        if (_config.SyncEmployees)
        {
            TryAddHashedEvent(
                result,
                capturedAt,
                "employees",
                () => EmployeeCollector.Collect(),
                TimeSpan.FromMinutes(_config.EmployeesSyncIntervalMinutes)
            );
        }

        TryAddLicenseStatus(result, capturedAt);

        if (_config.SyncAttendance)
        {
            var attendanceSnapshot = _attendanceSessionTracker.BuildSnapshot(
                _config.AttendanceLookbackDays,
                _config.MinAttendanceMinutesToSend
            );
            var attendanceHash = ComputePayloadHash(attendanceSnapshot.Payload);
            var closedStateChanged =
                attendanceSnapshot.ClosedStateVersion != _lastAttendanceClosedStateVersion;
            var eligibleOpenChanged =
                attendanceSnapshot.EligibleOpenFingerprint != _lastAttendanceEligibleOpenFingerprint;

            if (attendanceSnapshot.Payload.Records.Count == 0)
            {
                if (closedStateChanged || eligibleOpenChanged || attendanceSnapshot.OpenRecordsCount == 0)
                {
                    _lastAttendanceClosedStateVersion = attendanceSnapshot.ClosedStateVersion;
                    _lastAttendanceEligibleOpenFingerprint = attendanceSnapshot.EligibleOpenFingerprint;
                    _lastAttendancePayloadHash = attendanceHash;
                    _lastAttendanceOpenSentAt = DateTimeOffset.MinValue;
                }
            }
            else
            {
                var hourlyOpenRefresh =
                    attendanceSnapshot.OpenRecordsCount > 0
                    && _lastAttendanceOpenSentAt != DateTimeOffset.MinValue
                    && capturedAt - _lastAttendanceOpenSentAt >= TimeSpan.FromHours(1)
                    && _lastAttendancePayloadHash != attendanceHash;

                if (closedStateChanged || eligibleOpenChanged || hourlyOpenRefresh)
                {
                    result.Add(
                        new FrontEventEnvelope
                        {
                            Type = "attendance",
                            CapturedAt = capturedAt,
                            Payload = attendanceSnapshot.Payload,
                        },
                        () =>
                        {
                            _lastAttendanceClosedStateVersion = attendanceSnapshot.ClosedStateVersion;
                            _lastAttendanceEligibleOpenFingerprint = attendanceSnapshot.EligibleOpenFingerprint;
                            _lastAttendancePayloadHash = attendanceHash;
                            _lastAttendanceOpenSentAt = attendanceSnapshot.OpenRecordsCount > 0
                                ? capturedAt
                                : DateTimeOffset.MinValue;
                        }
                    );
                    PluginDiagnostics.Info(
                        $"Attendance snapshot queued: records={attendanceSnapshot.Payload.Records.Count}, " +
                        $"openRecords={attendanceSnapshot.OpenRecordsCount}, closedStateChanged={closedStateChanged}, " +
                        $"eligibleOpenChanged={eligibleOpenChanged}, hourlyOpenRefresh={hourlyOpenRefresh}, hash={attendanceHash}"
                    );
                }
            }
        }

        var treatAsCash = _config.TreatAsCashPaymentTypes?.Count > 0
            ? new System.Collections.Generic.HashSet<string>(_config.TreatAsCashPaymentTypes, System.StringComparer.OrdinalIgnoreCase)
            : null;
        var treatAsNonRevenue = _config.TreatAsNonRevenuePaymentTypes?.Count > 0
            ? new System.Collections.Generic.HashSet<string>(_config.TreatAsNonRevenuePaymentTypes, System.StringComparer.OrdinalIgnoreCase)
            : null;

        if (_config.SyncRevenue)
        {
            TryAddHashedEvent(
                result,
                capturedAt,
                "revenue",
                () => RevenueCollector.Collect(
                    _liveOrderCache,
                    _config.PastOrdersLookbackDays,
                    _config.BusinessDayEndHour,
                    _config.ExcludeNonRevenuePayments,
                    treatAsCash,
                    treatAsNonRevenue
                ),
                null
            );
        }

        if (_config.SyncDeliveries)
        {
            if (Interlocked.Exchange(ref _deliveryOrderChangeSignal, 0) == 1)
            {
                PluginDiagnostics.Info("Delivery change signal consumed before deliveries full scan.");
            }
            TryAddHashedEvent(
                result,
                capturedAt,
                "deliveries",
                () => DeliveryCollector.Collect(_config.PastOrdersLookbackDays, _config.BusinessDayEndHour),
                null
            );
        }

        if (_config.SyncReportSnapshots)
        {
            foreach (var rule in BuildReportSyncRules())
            {
                if (string.IsNullOrWhiteSpace(rule.ReportId))
                {
                    continue;
                }

                TryAddReportSnapshot(result, capturedAt, rule);
            }
        }

        if (_config.SyncTableOrders && _bookingOrderCollector.ShouldCollect())
        {
            var addResult = TryAddHashedEvent(
                result,
                capturedAt,
                "table_orders",
                () => _bookingOrderCollector.Collect(),
                null
            );
            if (addResult == EventAddResult.Queued)
            {
                result.AddCommitToLastEvent(() => _bookingOrderCollector.CommitCollected(capturedAt));
            }
            else if (addResult == EventAddResult.Duplicate)
            {
                _bookingOrderCollector.CommitCollected(capturedAt);
            }
        }

        if (_config.SyncLiveRevenue)
        {
            TryAddHashedEvent(
                result,
                capturedAt,
                "live_revenue",
                () => LiveRevenueCollector.Collect(
                    _liveOrderCache,
                    _config.BusinessDayEndHour,
                    _config.ExcludeNonRevenuePayments,
                    treatAsCash,
                    treatAsNonRevenue,
                    _dishSnapshotCache
                ),
                TimeSpan.FromMinutes(_config.LiveRevenueSyncIntervalMinutes)
            );
        }

        if (_config.SyncStopList)
        {
            TryAddHashedEvent(
                result,
                capturedAt,
                "stop_list",
                () => StopListCollector.Collect(),
                TimeSpan.FromMinutes(_config.StopListSyncIntervalMinutes)
            );
        }

        if (_config.SyncOrderLifecycle)
        {
            TryAddHashedEvent(
                result,
                capturedAt,
                "order_lifecycle",
                () => OrderLifecycleCollector.Collect(
                    _liveOrderCache,
                    _config.PastOrdersLookbackDays,
                    _config.BusinessDayEndHour,
                    _config.ExcludeNonRevenuePayments
                ),
                TimeSpan.FromMinutes(_config.OrderLifecycleSyncIntervalMinutes)
            );
        }

        if (_config.SyncOrderAudit)
        {
            TryAddHashedEvent(
                result,
                capturedAt,
                "order_audit",
                () => OrderAuditCollector.Collect(
                    _liveOrderCache,
                    _config.PastOrdersLookbackDays,
                    _config.BusinessDayEndHour
                ),
                TimeSpan.FromMinutes(_config.OrderAuditSyncIntervalMinutes)
            );
        }

        if (_config.SyncDailyReconciliation)
        {
            TryAddHashedEvent(
                result,
                capturedAt,
                "daily_reconciliation",
                () => DailyReconciliationCollector.Collect(
                    _config.PastOrdersLookbackDays,
                    _config.BusinessDayEndHour,
                    _config.ExcludeNonRevenuePayments,
                    treatAsNonRevenue
                ),
                TimeSpan.FromMinutes(_config.DailyReconciliationSyncIntervalMinutes)
            );
        }

        if (_config.SyncCashSession)
        {
            try
            {
                var cashSessionPayload = _cashSessionCollector.TryCollect(_config.BusinessDayEndHour);
                if (cashSessionPayload != null)
                {
                    result.Add(new FrontEventEnvelope
                    {
                        Type = "cash_session_closed",
                        CapturedAt = capturedAt,
                        Payload = cashSessionPayload,
                    });
                    PluginDiagnostics.Info(
                        $"CashSession: queued cash_session_closed for business date {cashSessionPayload.BusinessDate}"
                    );

                    // Касса закрылась — все заказы бизнес-дня гарантированно закрыты в iikoFront.
                    // Форсируем финальный снимок live_revenue (минуя обычный интервал), чтобы блюда/
                    // выручка за только что закрытый день ушли в backend полными, а не ждали
                    // следующего обычного опроса по таймеру.
                    if (_config.SyncLiveRevenue)
                    {
                        TryAddHashedEvent(
                            result,
                            capturedAt,
                            "live_revenue",
                            () => LiveRevenueCollector.Collect(
                                _liveOrderCache,
                                _config.BusinessDayEndHour,
                                _config.ExcludeNonRevenuePayments,
                                treatAsCash,
                                treatAsNonRevenue,
                                _dishSnapshotCache
                            ),
                            null
                        );
                        PluginDiagnostics.Info(
                            $"CashSession: forced final live_revenue snapshot for business date {cashSessionPayload.BusinessDate}"
                        );
                    }
                }
            }
            catch (Exception exc)
            {
                PluginContext.Log.Error($"Reservly bridge failed to collect cash session event. {exc.Message}");
                PluginDiagnostics.Error("Failed to collect cash session event.", exc);
            }
        }

        return result;
    }

    private BridgeStatusPayload CollectBridgeStatus(DateTimeOffset capturedAt)
    {
        var terminal = PluginContext.Operations.GetHostTerminal();
        var queueStats = _backendClient.GetQueueStats();
        return new BridgeStatusPayload
        {
            CapturedAt = capturedAt.ToString("O"),
            TerminalName = terminal?.ToString() ?? "iikoFront",
            PluginVersion = PluginVersion,
            Api = "V8",
            OfflineQueueEnabled = _config.OfflineQueueEnabled,
            OfflineQueueDepth = queueStats.Depth,
            OfflineQueueOldestAt = queueStats.OldestAt.HasValue ? queueStats.OldestAt.Value.ToString("O") : string.Empty,
            LastPushSuccessAt = _backendClient.LastPushSuccessAt.HasValue ? _backendClient.LastPushSuccessAt.Value.ToString("O") : string.Empty,
            LastPushErrorAt = _backendClient.LastPushErrorAt.HasValue ? _backendClient.LastPushErrorAt.Value.ToString("O") : string.Empty,
            LastPushError = _backendClient.LastPushError,
            Config = new Dictionary<string, object>
            {
                ["syncEmployees"] = _config.SyncEmployees,
                ["syncAttendance"] = _config.SyncAttendance,
                ["syncRevenue"] = _config.SyncRevenue,
                ["syncDeliveries"] = _config.SyncDeliveries,
                ["syncReportSnapshots"] = _config.SyncReportSnapshots,
                ["syncTableOrders"] = _config.SyncTableOrders,
                ["syncLiveRevenue"] = _config.SyncLiveRevenue,
                ["syncStopList"] = _config.SyncStopList,
                ["syncBridgeStatus"] = _config.SyncBridgeStatus,
                ["syncOrderLifecycle"] = _config.SyncOrderLifecycle,
                ["syncOrderAudit"] = _config.SyncOrderAudit,
                ["syncDailyReconciliation"] = _config.SyncDailyReconciliation,
                ["excludeNonRevenuePayments"] = _config.ExcludeNonRevenuePayments,
                ["treatAsCashPaymentTypes"] = _config.TreatAsCashPaymentTypes ?? new System.Collections.Generic.List<string>(),
                ["treatAsNonRevenuePaymentTypes"] = _config.TreatAsNonRevenuePaymentTypes ?? new System.Collections.Generic.List<string>(),
                ["pollIntervalSeconds"] = _config.PollIntervalSeconds,
                ["businessDayEndHour"] = _config.BusinessDayEndHour,
                ["stopListSyncIntervalMinutes"] = _config.StopListSyncIntervalMinutes,
                ["diagnosticsLogLevel"] = _config.DiagnosticsLogLevel,
            },
            RecentLogs = PluginDiagnostics.GetRecentLogs(),
        };
    }

    private void TryAddLicenseStatus(EventBuildResult result, DateTimeOffset capturedAt)
    {
        if (!_eventSyncStates.TryGetValue("license_status", out var state))
        {
            state = new EventSyncState();
            _eventSyncStates["license_status"] = state;
        }

        if (capturedAt - state.LastSentAt < TimeSpan.FromMinutes(_config.LicenseStatusSyncIntervalMinutes))
        {
            return;
        }

        var payload = CollectLicenseStatus(capturedAt);
        var payloadHash = ComputePayloadHash(payload);
        result.Add(
            new FrontEventEnvelope
            {
                Type = "license_status",
                CapturedAt = capturedAt,
                Payload = payload,
            },
            () =>
            {
                state.LastSentAt = capturedAt;
                state.LastPayloadHash = payloadHash;
            }
        );
    }

    private LicenseStatusPayload CollectLicenseStatus(DateTimeOffset capturedAt)
    {
        var payload = new LicenseStatusPayload
        {
            ModuleId = LicenseModuleId,
            CheckedAt = capturedAt.ToString("O"),
            Enabled = true,
            PluginVersion = PluginVersion,
        };

        try
        {
            _licenseSlot?.Dispose();
            _licenseSlot = null;
            _licenseSlot = PluginContext.Licensing.AcquireSlot(LicenseModuleId, BuildLicenseClientId());
            payload.SlotAcquired = _licenseSlot != null;
        }
        catch (Exception exc)
        {
            _licenseSlot = null;
            payload.SlotAcquired = false;
            payload.Error = exc.Message;
        }

        return payload;
    }

    private Guid BuildLicenseClientId()
    {
        var raw = string.IsNullOrWhiteSpace(_config.InstallationId)
            ? PluginContext.Operations.GetOrganizationFingerprint().ToString()
            : _config.InstallationId;
        if (Guid.TryParse(raw, out var parsed))
        {
            return parsed;
        }

        using (var sha = SHA256.Create())
        {
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(raw));
            var guidBytes = new byte[16];
            Array.Copy(bytes, guidBytes, guidBytes.Length);
            return new Guid(guidBytes);
        }
    }

    private EventAddResult TryAddHashedEvent(
        EventBuildResult result,
        DateTimeOffset capturedAt,
        string eventType,
        Func<object> payloadFactory,
        TimeSpan? resendInterval)
    {
        try
        {
            var payload = payloadFactory();
            var delta = BuildPayloadDelta(eventType, payload);
            payload = delta.Payload;
            if (delta.TotalRecords > 0 && delta.ChangedRecords == 0)
            {
                PluginDiagnostics.Info(
                    $"Event '{eventType}' skipped: no changed records out of {delta.TotalRecords}."
                );
                return EventAddResult.Duplicate;
            }

            var payloadHash = ComputeEventPayloadHash(payload);
            if (!_eventSyncStates.TryGetValue(eventType, out var state))
            {
                state = new EventSyncState();
                _eventSyncStates[eventType] = state;
            }

            var isDuplicate = state.LastPayloadHash == payloadHash;
            var resendDue = resendInterval.HasValue && capturedAt - state.LastSentAt >= resendInterval.Value;
            if (resendInterval.HasValue && state.LastSentAt != DateTimeOffset.MinValue && !resendDue)
            {
                return EventAddResult.Duplicate;
            }
            if (isDuplicate)
            {
                return EventAddResult.Duplicate;
            }

            result.Add(
                new FrontEventEnvelope
                {
                    Type = eventType,
                    CapturedAt = capturedAt,
                    Payload = payload,
                },
                () =>
                {
                    state.LastPayloadHash = payloadHash;
                    state.LastSentAt = capturedAt;
                    delta.Commit?.Invoke();
                }
            );
            if (delta.TotalRecords > 0)
            {
                PluginDiagnostics.Info(
                    $"Event '{eventType}' delta queued: changed={delta.ChangedRecords}, total={delta.TotalRecords}, hash={payloadHash}"
                );
            }
            return EventAddResult.Queued;
        }
        catch (Exception exc)
        {
            PluginContext.Log.Error($"Reservly bridge failed to collect event '{eventType}'. {exc.Message}");
            PluginDiagnostics.Error($"Failed to collect event '{eventType}'.", exc);
            return EventAddResult.Failed;
        }
    }

    private IEnumerable<ReportSyncRule> BuildReportSyncRules()
    {
        return new[]
        {
            new ReportSyncRule
            {
                ReportId = _config.AttendanceReportId,
                IntervalMinutes = _config.AttendanceReportSyncIntervalMinutes,
            },
            new ReportSyncRule
            {
                ReportId = _config.RevenueReportId,
                IntervalMinutes = _config.RevenueReportSyncIntervalMinutes,
            },
            new ReportSyncRule
            {
                ReportId = _config.DeliveryReportId,
                IntervalMinutes = _config.DeliveryReportSyncIntervalMinutes,
            },
        };
    }

    private PayloadDeltaResult BuildPayloadDelta(string eventType, object payload)
    {
        var result = new PayloadDeltaResult
        {
            Payload = payload,
        };

        if (payload == null)
        {
            return result;
        }

        var commits = new List<Action>();
        switch ((eventType ?? string.Empty).Trim().ToLowerInvariant())
        {
            case "table_orders":
                if (payload is FrontTableOrdersPayload tableOrders)
                {
                    tableOrders.Orders = FilterChangedRecords(
                        "table_orders.orders",
                        tableOrders.Orders,
                        record => record.OrderId,
                        result,
                        out var tableOrdersCommit
                    );
                    commits.Add(tableOrdersCommit);
                }
                break;

            case "order_lifecycle":
                if (payload is FrontOrderLifecyclePayload lifecycle)
                {
                    lifecycle.Orders = FilterChangedRecords(
                        "order_lifecycle.orders",
                        lifecycle.Orders,
                        record => record.OrderId,
                        result,
                        out var lifecycleCommit
                    );
                    commits.Add(lifecycleCommit);
                }
                break;

            case "order_audit":
                if (payload is FrontOrderAuditPayload audit)
                {
                    audit.Events = FilterChangedRecords(
                        "order_audit.events",
                        audit.Events,
                        record => FirstNonEmpty(record.EventKey, record.AuditType + ":" + record.OrderId + ":" + record.OccurredAt),
                        result,
                        out var auditCommit
                    );
                    commits.Add(auditCommit);
                }
                break;

            case "deliveries":
                if (payload is FrontDeliveriesPayload deliveries)
                {
                    deliveries.Orders = FilterChangedRecords(
                        "deliveries.orders",
                        deliveries.Orders,
                        record => record.OrderId,
                        result,
                        out var ordersCommit
                    );
                    commits.Add(ordersCommit);
                    deliveries.Metrics = FilterChangedRecords(
                        "deliveries.metrics",
                        deliveries.Metrics,
                        record => record.Date,
                        result,
                        out var metricsCommit
                    );
                    commits.Add(metricsCommit);
                }
                break;
        }

        if (commits.Count > 0)
        {
            result.Commit = () =>
            {
                foreach (var commit in commits)
                {
                    commit?.Invoke();
                }
            };
        }

        return result;
    }

    private List<TRecord> FilterChangedRecords<TRecord>(
        string statePrefix,
        List<TRecord> records,
        Func<TRecord, string> keyFactory,
        PayloadDeltaResult result,
        out Action commit)
    {
        var changed = new List<TRecord>();
        var pendingHashes = new List<KeyValuePair<string, string>>();
        var source = records ?? new List<TRecord>();
        result.TotalRecords += source.Count;

        foreach (var record in source)
        {
            if (record == null)
            {
                continue;
            }

            var recordHash = ComputePayloadHash(record);
            var recordKey = FirstNonEmpty(keyFactory(record), "hash:" + recordHash);
            var stateKey = statePrefix + ":" + recordKey;
            if (_recordPayloadHashes.TryGetValue(stateKey, out var previousHash) && previousHash == recordHash)
            {
                continue;
            }

            changed.Add(record);
            pendingHashes.Add(new KeyValuePair<string, string>(stateKey, recordHash));
        }

        result.ChangedRecords += changed.Count;
        commit = () =>
        {
            foreach (var pair in pendingHashes)
            {
                _recordPayloadHashes[pair.Key] = pair.Value;
            }
        };
        return changed;
    }

    private void TryAddReportSnapshot(EventBuildResult result, DateTimeOffset capturedAt, ReportSyncRule rule)
    {
        if (!_reportSyncStates.TryGetValue(rule.ReportId, out var state))
        {
            state = new ReportSyncState();
            _reportSyncStates[rule.ReportId] = state;
        }

        if (capturedAt - state.LastAttemptAt < TimeSpan.FromMinutes(rule.IntervalMinutes))
        {
            return;
        }

        try
        {
            var reportResult = ReportSnapshotCollector.Collect(rule.ReportId, _config.ReportSessionPin);
            if (reportResult == null || reportResult.Payload == null || string.IsNullOrWhiteSpace(reportResult.Payload.Markup))
            {
                PluginDiagnostics.Info($"Report snapshot skipped: reportId={rule.ReportId}, reason=empty");
                AddReportSnapshotStatus(
                    result,
                    capturedAt,
                    rule.ReportId,
                    "skipped_empty",
                    "empty",
                    reportResult,
                    null,
                    () => state.LastAttemptAt = capturedAt
                );
                return;
            }

            if (reportResult.IsUnavailable)
            {
                PluginDiagnostics.Info(
                    $"Report snapshot skipped: reportId={rule.ReportId}, reason=unavailable, currentUser={reportResult.Payload.CurrentUser}"
                );
                AddReportSnapshotStatus(
                    result,
                    capturedAt,
                    rule.ReportId,
                    "skipped_unavailable",
                    "unavailable",
                    reportResult,
                    null,
                    () => state.LastAttemptAt = capturedAt
                );
                return;
            }

            if (state.LastPayloadHash == reportResult.PayloadHash)
            {
                PluginDiagnostics.Info(
                    $"Report snapshot skipped: reportId={rule.ReportId}, reason=duplicate, currentUser={reportResult.Payload.CurrentUser}"
                );
                AddReportSnapshotStatus(
                    result,
                    capturedAt,
                    rule.ReportId,
                    "skipped_duplicate",
                    "duplicate",
                    reportResult,
                    null,
                    () => state.LastAttemptAt = capturedAt
                );
                return;
            }

            result.Add(
                new FrontEventEnvelope
                {
                    Type = "report_snapshot",
                    CapturedAt = capturedAt,
                    Payload = reportResult.Payload,
                },
                () =>
                {
                    state.LastAttemptAt = capturedAt;
                    state.LastPayloadHash = reportResult.PayloadHash;
                }
            );
            PluginDiagnostics.Info(
                $"Report snapshot queued: reportId={rule.ReportId}, currentUser={reportResult.Payload.CurrentUser}, hash={reportResult.PayloadHash}"
            );
            AddReportSnapshotStatus(result, capturedAt, rule.ReportId, "queued", "new_markup", reportResult, null);
        }
        catch (Exception exc)
        {
            PluginContext.Log.Error($"Reservly bridge failed to collect report '{rule.ReportId}'. {exc.Message}");
            PluginDiagnostics.Error($"Failed to collect report '{rule.ReportId}'.", exc);
            AddReportSnapshotStatus(
                result,
                capturedAt,
                rule.ReportId,
                "error",
                "exception",
                null,
                exc,
                () => state.LastAttemptAt = capturedAt
            );
        }
    }

    private static void AddReportSnapshotStatus(
        EventBuildResult resultBuilder,
        DateTimeOffset capturedAt,
        string reportId,
        string status,
        string reason,
        ReportSnapshotResult result,
        Exception exception,
        Action commit = null)
    {
        var payload = result?.Payload;
        resultBuilder.Add(
            new FrontEventEnvelope
            {
                Type = "report_snapshot_status",
                CapturedAt = capturedAt,
                Payload = new ReportSnapshotStatusPayload
                {
                    ReportId = reportId,
                    AttemptedAt = capturedAt.ToString("O"),
                    Status = status,
                    Reason = reason,
                    MarkupLength = payload?.Markup?.Length ?? 0,
                    CurrentUser = payload?.CurrentUser ?? string.Empty,
                    CashRegister = payload?.CashRegister ?? string.Empty,
                    Unavailable = result?.IsUnavailable ?? false,
                    Error = exception?.Message ?? string.Empty,
                },
            },
            commit
        );
    }

    private static string ComputePayloadHash(object payload)
    {
        var json = BridgeJson.SerializeCamelCase(payload);
        using (var sha = SHA256.Create())
        {
            var bytes = Encoding.UTF8.GetBytes(json);
            var hash = sha.ComputeHash(bytes);
            return BitConverter.ToString(hash).Replace("-", string.Empty);
        }
    }

    private static string ComputeEventPayloadHash(object payload)
    {
        if (payload is FrontLiveRevenuePayload liveRevenue)
        {
            var capturedAt = liveRevenue.CapturedAt;
            try
            {
                liveRevenue.CapturedAt = string.Empty;
                return ComputePayloadHash(liveRevenue);
            }
            finally
            {
                liveRevenue.CapturedAt = capturedAt;
            }
        }

        if (payload is FrontStopListPayload stopList)
        {
            var capturedAt = stopList.CapturedAt;
            try
            {
                stopList.CapturedAt = string.Empty;
                return ComputePayloadHash(stopList);
            }
            finally
            {
                stopList.CapturedAt = capturedAt;
            }
        }

        if (payload is FrontDailyReconciliationPayload reconciliation)
        {
            var capturedAtValues = new List<string>();
            try
            {
                foreach (var day in reconciliation.Days)
                {
                    capturedAtValues.Add(day.CapturedAt);
                    day.CapturedAt = string.Empty;
                }
                return ComputePayloadHash(reconciliation);
            }
            finally
            {
                for (var index = 0; index < reconciliation.Days.Count && index < capturedAtValues.Count; index++)
                {
                    reconciliation.Days[index].CapturedAt = capturedAtValues[index];
                }
            }
        }

        return ComputePayloadHash(payload);
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

    public void Dispose()
    {
        PluginContext.Log.Info("Reservly iikoFront bridge stopped.");
        PluginDiagnostics.Info("Bridge stopped.");
        _mamaRomaWorker?.Dispose();
        _timer.Dispose();
        _attendanceSessionTracker.Dispose();
        _cashSessionCollector.Dispose();
        _bookingOrderCollector.Dispose();
        _liveOrderCache.Dispose();
        _deliveryOrderChangedSubscription?.Dispose();
        _licenseSlot?.Dispose();
        _syncLock.Dispose();
    }
}
