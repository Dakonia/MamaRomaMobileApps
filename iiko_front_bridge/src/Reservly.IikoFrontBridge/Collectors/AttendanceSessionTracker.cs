using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Resto.Front.Api;
using Resto.Front.Api.Data.Security;

namespace Reservly.IikoFrontBridge.Collectors;

internal sealed class AttendanceSessionTracker : IDisposable
{
    private sealed class PersistedState
    {
        public List<OpenSessionState> OpenSessions { get; set; } = new List<OpenSessionState>();
        public List<DailyAttendanceState> DailyTotals { get; set; } = new List<DailyAttendanceState>();
    }

    internal sealed class SnapshotResult
    {
        public FrontAttendancePayload Payload { get; set; } = new FrontAttendancePayload();
        public int OpenRecordsCount { get; set; }
        public long ClosedStateVersion { get; set; }
        public string EligibleOpenFingerprint { get; set; } = string.Empty;
    }

    private sealed class OpenSessionState
    {
        public string FrontUserId { get; set; } = string.Empty;
        public string EmployeeName { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
        public DateTimeOffset OpenedAt { get; set; }
    }

    private sealed class DailyAttendanceState
    {
        public string FrontUserId { get; set; } = string.Empty;
        public string EmployeeName { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
        public DateTime WorkDate { get; set; }
        public decimal TotalHours { get; set; }
        public DateTimeOffset? FirstClockIn { get; set; }
        public DateTimeOffset? LastClockOut { get; set; }
    }

    private readonly object _gate = new object();
    private readonly Dictionary<string, OpenSessionState> _openSessions = new Dictionary<string, OpenSessionState>();
    private readonly Dictionary<string, DailyAttendanceState> _dailyTotals = new Dictionary<string, DailyAttendanceState>();
    private readonly IDisposable _subscription;
    private readonly string _stateFilePath;
    private long _closedStateVersion;

    public AttendanceSessionTracker(string baseDirectory)
    {
        _stateFilePath = Path.Combine(baseDirectory, "attendance-state.json");
        LoadState();
        SeedOpenSessions();
        _subscription = PluginContext.Notifications.UserSessionChanged.Subscribe(
            new ActionObserver<IReadOnlyList<IUser>>(
                OnUserSessionChanged,
                exc =>
                {
                    PluginContext.Log.Error($"Reservly attendance tracker notification failed. {exc.Message}");
                    PluginDiagnostics.Error("Attendance tracker notification failed.", exc);
                }
            )
        );
    }

    public SnapshotResult BuildSnapshot(int lookbackDays, int minAttendanceMinutesToSend)
    {
        var now = DateTimeOffset.Now;
        var result = new SnapshotResult();
        var minHoursToSend = Math.Round(minAttendanceMinutesToSend / 60m, 2, MidpointRounding.AwayFromZero);
        var eligibleOpenKeys = new List<string>();
        var stateChanged = false;

        lock (_gate)
        {
            var cutoffDate = now.Date.AddDays(-lookbackDays);
            foreach (var staleKey in _dailyTotals
                         .Where(pair => pair.Value.WorkDate < cutoffDate)
                         .Select(pair => pair.Key)
                         .ToList())
            {
                _dailyTotals.Remove(staleKey);
                stateChanged = true;
            }

            foreach (var daily in _dailyTotals.Values.OrderBy(x => x.WorkDate).ThenBy(x => x.EmployeeName))
            {
                if (daily.TotalHours < minHoursToSend)
                {
                    continue;
                }
                result.Payload.Records.Add(ToRecord(daily));
            }

            foreach (var open in _openSessions.Values)
            {
                var current = BuildOpenSessionSnapshot(open, now, minHoursToSend);
                if (current == null)
                {
                    continue;
                }
                result.OpenRecordsCount += 1;
                eligibleOpenKeys.Add(BuildDailyKey(open.FrontUserId, open.OpenedAt.Date));

                var existing = result.Payload.Records.FirstOrDefault(
                    record => record.FrontUserId == current.FrontUserId && record.Date == current.Date
                );
                if (existing == null)
                {
                    result.Payload.Records.Add(current);
                    continue;
                }

                existing.HoursWorked = current.HoursWorked;
                existing.ClockIn = current.ClockIn;
                existing.ClockOut = current.ClockOut;
                existing.EmployeeName = current.EmployeeName;
                existing.Phone = current.Phone;
            }
            result.ClosedStateVersion = _closedStateVersion;
            result.EligibleOpenFingerprint = string.Join("|", eligibleOpenKeys.OrderBy(value => value));
        }

        if (stateChanged)
        {
            SaveState();
        }
        return result;
    }

    private void SeedOpenSessions()
    {
        var now = DateTimeOffset.Now;
        var users = PluginContext.Operations.GetUsers(fromAllDepartments: true);
        var hasChanges = false;
        lock (_gate)
        {
            var openUsers = users.Where(user => user.IsSessionOpen).ToList();
            var openUserIds = new HashSet<string>(openUsers.Select(user => user.Id.ToString()));

            foreach (var staleOpenSession in _openSessions.Values
                         .Where(session => !openUserIds.Contains(session.FrontUserId))
                         .ToList())
            {
                AccumulateClosedSession(staleOpenSession, now);
                _openSessions.Remove(staleOpenSession.FrontUserId);
                _closedStateVersion += 1;
                hasChanges = true;
                PluginDiagnostics.Info(
                    $"Recovered stale open session at startup as closed: user={staleOpenSession.EmployeeName}, id={staleOpenSession.FrontUserId}"
                );
            }

            foreach (var user in openUsers)
            {
                var frontUserId = user.Id.ToString();
                if (_openSessions.TryGetValue(frontUserId, out var existing))
                {
                    existing.EmployeeName = user.Name ?? existing.EmployeeName;
                    existing.Phone = user.CellPhone ?? existing.Phone;
                    continue;
                }

                _openSessions[frontUserId] = new OpenSessionState
                {
                    FrontUserId = frontUserId,
                    EmployeeName = user.Name ?? string.Empty,
                    Phone = user.CellPhone ?? string.Empty,
                    OpenedAt = now,
                };
                hasChanges = true;
            }
        }

        if (hasChanges)
        {
            SaveState();
        }

        if (_openSessions.Count > 0)
        {
            PluginContext.Log.Info(
                $"Reservly attendance tracker seeded {_openSessions.Count} open sessions at startup."
            );
            PluginDiagnostics.Info(
                $"Attendance tracker seeded {_openSessions.Count} open sessions at startup."
            );
        }
    }

    private void OnUserSessionChanged(IReadOnlyList<IUser> users)
    {
        var now = DateTimeOffset.Now;
        lock (_gate)
        {
            foreach (var user in users)
            {
                var frontUserId = user.Id.ToString();
                if (user.IsSessionOpen)
                {
                    if (_openSessions.TryGetValue(frontUserId, out var existing))
                    {
                        existing.EmployeeName = user.Name ?? existing.EmployeeName;
                        existing.Phone = user.CellPhone ?? existing.Phone;
                        continue;
                    }

                    _openSessions[frontUserId] = new OpenSessionState
                    {
                        FrontUserId = frontUserId,
                        EmployeeName = user.Name ?? string.Empty,
                        Phone = user.CellPhone ?? string.Empty,
                        OpenedAt = now,
                    };
                    SaveState();
                    PluginContext.Log.Info(
                        $"Reservly attendance tracker session opened: user={user.Name}, id={frontUserId}, openedAt={now:O}"
                    );
                    PluginDiagnostics.Info(
                        $"Attendance session opened: user={user.Name}, id={frontUserId}, openedAt={now:O}"
                    );
                    continue;
                }

                if (!_openSessions.TryGetValue(frontUserId, out var state))
                {
                    continue;
                }

                AccumulateClosedSession(state, now);
                _openSessions.Remove(frontUserId);
                _closedStateVersion += 1;
                SaveState();
                PluginContext.Log.Info(
                    $"Reservly attendance tracker session closed: user={state.EmployeeName}, id={frontUserId}, closedAt={now:O}"
                );
                PluginDiagnostics.Info(
                    $"Attendance session closed: user={state.EmployeeName}, id={frontUserId}, closedAt={now:O}"
                );
            }
        }
    }

    private void AccumulateClosedSession(OpenSessionState state, DateTimeOffset closedAt)
    {
        if (closedAt <= state.OpenedAt)
        {
            return;
        }

        var key = BuildDailyKey(state.FrontUserId, state.OpenedAt.Date);
        if (!_dailyTotals.TryGetValue(key, out var daily))
        {
            daily = new DailyAttendanceState
            {
                FrontUserId = state.FrontUserId,
                EmployeeName = state.EmployeeName,
                Phone = state.Phone,
                WorkDate = state.OpenedAt.Date,
            };
            _dailyTotals[key] = daily;
        }

        var durationHours = DecimalHours(closedAt - state.OpenedAt);
        daily.EmployeeName = state.EmployeeName;
        daily.Phone = state.Phone;
        daily.TotalHours = (daily.TotalHours + durationHours).RoundTo2();
        daily.FirstClockIn = daily.FirstClockIn == null || state.OpenedAt < daily.FirstClockIn
            ? state.OpenedAt
            : daily.FirstClockIn;
        daily.LastClockOut = daily.LastClockOut == null || closedAt > daily.LastClockOut
            ? closedAt
            : daily.LastClockOut;
    }

    private FrontAttendanceRecord BuildOpenSessionSnapshot(OpenSessionState open, DateTimeOffset now, decimal minHoursToSend)
    {
        if (now <= open.OpenedAt)
        {
            return null;
        }

        var key = BuildDailyKey(open.FrontUserId, open.OpenedAt.Date);
        _dailyTotals.TryGetValue(key, out var accumulated);

        var totalHours = (accumulated?.TotalHours ?? 0m) + DecimalHours(now - open.OpenedAt);
        if (totalHours < minHoursToSend)
        {
            return null;
        }
        var firstClockIn = accumulated == null || accumulated.FirstClockIn == null || open.OpenedAt < accumulated.FirstClockIn
            ? open.OpenedAt
            : accumulated.FirstClockIn.Value;
        var employeeName = accumulated?.EmployeeName ?? open.EmployeeName;
        var phone = accumulated?.Phone ?? open.Phone;

        return new FrontAttendanceRecord
        {
            FrontUserId = open.FrontUserId,
            EmployeeName = employeeName,
            Phone = phone,
            Date = open.OpenedAt.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            HoursWorked = totalHours.RoundTo2().ToString("0.00", CultureInfo.InvariantCulture),
            ClockIn = firstClockIn.ToString("O", CultureInfo.InvariantCulture),
            ClockOut = now.ToString("O", CultureInfo.InvariantCulture),
        };
    }

    private static FrontAttendanceRecord ToRecord(DailyAttendanceState daily)
    {
        return new FrontAttendanceRecord
        {
            FrontUserId = daily.FrontUserId,
            EmployeeName = daily.EmployeeName,
            Phone = daily.Phone,
            Date = daily.WorkDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            HoursWorked = daily.TotalHours.RoundTo2().ToString("0.00", CultureInfo.InvariantCulture),
            ClockIn = daily.FirstClockIn?.ToString("O", CultureInfo.InvariantCulture) ?? string.Empty,
            ClockOut = daily.LastClockOut?.ToString("O", CultureInfo.InvariantCulture) ?? string.Empty,
        };
    }

    private static string BuildDailyKey(string frontUserId, DateTime workDate)
    {
        return $"{frontUserId}:{workDate:yyyy-MM-dd}";
    }

    private static decimal DecimalHours(TimeSpan span)
    {
        return ((decimal)span.TotalMinutes / 60m).RoundTo2();
    }

    private void LoadState()
    {
        try
        {
            if (!File.Exists(_stateFilePath))
            {
                return;
            }

            var json = File.ReadAllText(_stateFilePath);
            var state = BridgeJson.DeserializeCaseInsensitive<PersistedState>(json);
            if (state == null)
            {
                return;
            }

            lock (_gate)
            {
                _openSessions.Clear();
                _dailyTotals.Clear();

                foreach (var openSession in state.OpenSessions)
                {
                    if (string.IsNullOrWhiteSpace(openSession.FrontUserId))
                    {
                        continue;
                    }
                    _openSessions[openSession.FrontUserId] = openSession;
                }

                foreach (var daily in state.DailyTotals)
                {
                    if (string.IsNullOrWhiteSpace(daily.FrontUserId))
                    {
                        continue;
                    }
                    _dailyTotals[BuildDailyKey(daily.FrontUserId, daily.WorkDate)] = daily;
                }
            }

            PluginDiagnostics.Info(
                $"Attendance tracker state restored: openSessions={_openSessions.Count}, dailyTotals={_dailyTotals.Count}"
            );
        }
        catch (Exception exc)
        {
            PluginContext.Log.Error($"Reservly attendance tracker failed to restore persisted state. {exc.Message}");
            PluginDiagnostics.Error("Attendance tracker failed to restore persisted state.", exc);
        }
    }

    private void SaveState()
    {
        try
        {
            PersistedState state;
            lock (_gate)
            {
                state = new PersistedState
                {
                    OpenSessions = _openSessions.Values
                        .Select(session => new OpenSessionState
                        {
                            FrontUserId = session.FrontUserId,
                            EmployeeName = session.EmployeeName,
                            Phone = session.Phone,
                            OpenedAt = session.OpenedAt,
                        })
                        .ToList(),
                    DailyTotals = _dailyTotals.Values
                        .Select(daily => new DailyAttendanceState
                        {
                            FrontUserId = daily.FrontUserId,
                            EmployeeName = daily.EmployeeName,
                            Phone = daily.Phone,
                            WorkDate = daily.WorkDate,
                            TotalHours = daily.TotalHours,
                            FirstClockIn = daily.FirstClockIn,
                            LastClockOut = daily.LastClockOut,
                        })
                        .ToList(),
                };
            }

            var json = BridgeJson.SerializeCamelCase(state);
            var tmpPath = _stateFilePath + ".tmp";
            File.WriteAllText(tmpPath, json);
            if (File.Exists(_stateFilePath))
                File.Delete(_stateFilePath);
            File.Move(tmpPath, _stateFilePath);
        }
        catch (Exception exc)
        {
            PluginContext.Log.Error($"Reservly attendance tracker failed to persist state. {exc.Message}");
            PluginDiagnostics.Error("Attendance tracker failed to persist state.", exc);
        }
    }

    public void Dispose()
    {
        _subscription.Dispose();
    }
}

internal static class DecimalExtensions
{
    public static decimal RoundTo2(this decimal value)
    {
        return Math.Round(value, 2, MidpointRounding.AwayFromZero);
    }
}
