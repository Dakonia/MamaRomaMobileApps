using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Reservly.IikoFrontBridge;

internal static class PluginDiagnostics
{
    private enum DiagnosticsLevel
    {
        Info = 1,
        Warning = 2,
        Error = 3,
        Off = 4,
    }

    private static readonly object Gate = new object();
    private static string _logPath = string.Empty;
    private static DiagnosticsLevel _minimumLevel = DiagnosticsLevel.Warning;
    private static readonly Queue<string> _recentEntries = new Queue<string>();
    private const int RecentEntriesCapacity = 150;

    public static void Initialize(string baseDirectory)
    {
        var logsDirectory = Path.Combine(baseDirectory, "logs");
        Directory.CreateDirectory(logsDirectory);
        _logPath = Path.Combine(logsDirectory, "reservly-bridge.log");
    }

    public static void Configure(string minimumLevel)
    {
        _minimumLevel = ParseLevel(minimumLevel);
    }

    public static void Info(string message)
    {
        Write("INFO", message, null);
    }

    public static void Warning(string message)
    {
        Write("WARN", message, null);
    }

    public static void Error(string message, Exception exception = null)
    {
        Write("ERROR", message, exception);
    }

    public static List<string> GetRecentLogs()
    {
        lock (Gate)
        {
            return new List<string>(_recentEntries);
        }
    }

    private static void Write(string level, string message, Exception exception)
    {
        var line = new StringBuilder()
            .Append(DateTimeOffset.Now.ToString("O"))
            .Append(" [")
            .Append(level)
            .Append("] ")
            .Append(message);

        if (exception != null)
        {
            line.Append(" | ").Append(exception.GetType().Name).Append(": ").Append(exception.Message);
        }

        var text = line.ToString();

        lock (Gate)
        {
            _recentEntries.Enqueue(text);
            while (_recentEntries.Count > RecentEntriesCapacity)
                _recentEntries.Dequeue();

            if (ShouldWrite(level) && !string.IsNullOrWhiteSpace(_logPath))
            {
                try
                {
                    RotateIfNeeded();
                    File.AppendAllText(_logPath, text + Environment.NewLine, Encoding.UTF8);
                }
                catch
                {
                }
            }
        }
    }

    private static bool ShouldWrite(string level)
    {
        if (_minimumLevel == DiagnosticsLevel.Off)
        {
            return false;
        }

        var current = ParseLevel(level);
        return current >= _minimumLevel;
    }

    private static DiagnosticsLevel ParseLevel(string value)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        switch (normalized)
        {
            case "debug":
            case "trace":
            case "info":
                return DiagnosticsLevel.Info;
            case "warning":
            case "warn":
                return DiagnosticsLevel.Warning;
            case "error":
                return DiagnosticsLevel.Error;
            case "off":
            case "none":
                return DiagnosticsLevel.Off;
            default:
                return DiagnosticsLevel.Warning;
        }
    }

    private static void RotateIfNeeded()
    {
        if (string.IsNullOrWhiteSpace(_logPath) || !File.Exists(_logPath))
        {
            return;
        }

        var info = new FileInfo(_logPath);
        if (info.Length < 5 * 1024 * 1024)
        {
            return;
        }

        var archivePath = _logPath + ".1";
        if (File.Exists(archivePath))
        {
            File.Delete(archivePath);
        }
        File.Move(_logPath, archivePath);
    }
}
