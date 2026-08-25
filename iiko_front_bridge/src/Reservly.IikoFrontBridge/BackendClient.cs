using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Reservly.IikoFrontBridge;

internal sealed class BackendClient
{
    private const int MaxOfflineQueueDepth = 500;

    private sealed class BackendPushException : Exception
    {
        public BackendPushException(string message, bool retryable, Exception inner = null)
            : base(message, inner)
        {
            Retryable = retryable;
        }

        public bool Retryable { get; }
    }

    private readonly HttpClient _httpClient;
    private readonly BridgeConfig _config;
    private readonly string _queueDirectory;

    public BackendClient(BridgeConfig config, string baseDirectory)
    {
        _config = config;
        _queueDirectory = Path.Combine(baseDirectory, "reservly-offline-queue");
        _httpClient = new HttpClient();
        _httpClient.Timeout = TimeSpan.FromSeconds(30);
        _httpClient.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/json")
        );
        _httpClient.DefaultRequestHeaders.Add("X-IikoFront-Secret", config.Secret);
    }

    public DateTimeOffset? LastPushSuccessAt { get; private set; }
    public DateTimeOffset? LastPushErrorAt { get; private set; }
    public string LastPushError { get; private set; } = string.Empty;

    public OfflineQueueStats GetQueueStats()
    {
        var stats = new OfflineQueueStats();
        if (!_config.OfflineQueueEnabled || !Directory.Exists(_queueDirectory))
        {
            return stats;
        }

        try
        {
            var files = Directory.GetFiles(_queueDirectory, "*.json")
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
                .ToList();
            stats.Depth = files.Count;
            if (files.Count > 0)
            {
                stats.OldestAt = File.GetCreationTimeUtc(files[0]);
            }
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info($"Offline queue stats failed: {exc.Message}");
        }

        return stats;
    }

    public async Task PushAsync(FrontEnvelope envelope, CancellationToken cancellationToken)
    {
        if (_config.OfflineQueueEnabled)
        {
            try
            {
                await FlushQueueAsync(cancellationToken);
            }
            catch (BackendPushException exc) when (exc.Retryable)
            {
                SaveToQueue(envelope);
                throw;
            }
        }

        var json = SerializeEnvelope(envelope);
        try
        {
            await SendJsonAsync(json, envelope.Events.Count, cancellationToken);
        }
        catch (BackendPushException exc) when (_config.OfflineQueueEnabled && exc.Retryable)
        {
            SaveToQueue(envelope);
            throw;
        }
    }

    private async Task FlushQueueAsync(CancellationToken cancellationToken)
    {
        if (!Directory.Exists(_queueDirectory))
        {
            return;
        }

        var files = Directory.GetFiles(_queueDirectory, "*.json")
            .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
            .ToList();
        foreach (var file in files)
        {
            string json;
            try
            {
                json = File.ReadAllText(file, Encoding.UTF8);
                if (string.IsNullOrWhiteSpace(json))
                {
                    File.Delete(file);
                    continue;
                }
            }
            catch (Exception exc)
            {
                PluginDiagnostics.Info($"Offline queue read failed, deleting file {Path.GetFileName(file)}: {exc.Message}");
                TryDelete(file);
                continue;
            }

            try
            {
                await SendJsonAsync(json, eventCount: 0, cancellationToken: cancellationToken);
            }
            catch (BackendPushException exc) when (!exc.Retryable)
            {
                PluginDiagnostics.Info(
                    $"Offline queue packet dropped after non-retryable backend error: {Path.GetFileName(file)}. {exc.Message}"
                );
                TryDelete(file);
                continue;
            }

            TryDelete(file);
            PluginDiagnostics.Info($"Offline queue packet sent: {Path.GetFileName(file)}");
        }
    }

    private async Task SendJsonAsync(string json, int eventCount, CancellationToken cancellationToken)
    {
        try
        {
            var byteCount = Encoding.UTF8.GetByteCount(json);
            using var content = new StringContent(json, Encoding.UTF8, "application/json");
            using var response = await _httpClient.PostAsync(_config.BackendUrl, content, cancellationToken);
            var responseBody = await response.Content.ReadAsStringAsync();
            PluginDiagnostics.Info(
                $"Backend push finished: status={(int)response.StatusCode}, events={eventCount}, bytes={byteCount}, body={responseBody}"
            );

            if (!response.IsSuccessStatusCode)
            {
                var retryable = IsRetryableStatusCode(response.StatusCode);
                RegisterPushError($"HTTP {(int)response.StatusCode}: {responseBody}", retryable);
                throw new BackendPushException(
                    $"Backend returned HTTP {(int)response.StatusCode}: {responseBody}",
                    retryable
                );
            }

            LastPushSuccessAt = DateTimeOffset.Now;
            LastPushError = string.Empty;
        }
        catch (BackendPushException)
        {
            throw;
        }
        catch (OperationCanceledException exc) when (!cancellationToken.IsCancellationRequested)
        {
            RegisterPushError(exc.Message, retryable: true);
            throw new BackendPushException(exc.Message, retryable: true, inner: exc);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exc)
        {
            RegisterPushError(exc.Message, retryable: true);
            throw new BackendPushException(exc.Message, retryable: true, inner: exc);
        }
    }

    private void SaveToQueue(FrontEnvelope envelope)
    {
        try
        {
            Directory.CreateDirectory(_queueDirectory);
            var existing = Directory.GetFiles(_queueDirectory, "*.json").OrderBy(f => f).ToArray();
            if (existing.Length >= MaxOfflineQueueDepth)
            {
                var trimCount = existing.Length - MaxOfflineQueueDepth + 1;
                foreach (var old in existing.Take(trimCount))
                {
                    try { File.Delete(old); } catch { }
                }
                PluginDiagnostics.Warning($"Offline queue trimmed {trimCount} oldest packet(s) (limit {MaxOfflineQueueDepth}).");
            }
            var fileName = DateTimeOffset.UtcNow.ToString("yyyyMMddHHmmssfff")
                           + "-"
                           + (string.IsNullOrWhiteSpace(envelope.BatchId) ? Guid.NewGuid().ToString("N") : envelope.BatchId)
                           + ".json";
            var targetPath = Path.Combine(_queueDirectory, fileName);
            var tempPath = targetPath + ".tmp";
            File.WriteAllText(tempPath, SerializeEnvelope(envelope), Encoding.UTF8);
            if (File.Exists(targetPath))
            {
                File.Delete(targetPath);
            }
            File.Move(tempPath, targetPath);
            PluginDiagnostics.Info($"Backend unavailable, queued packet locally: {fileName}, events={envelope.Events.Count}");
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Error("Failed to save offline queue packet.", exc);
        }
    }

    private string SerializeEnvelope(FrontEnvelope envelope)
    {
        return BridgeJson.SerializeCamelCase(envelope);
    }

    private void RegisterPushError(string message, bool retryable)
    {
        LastPushErrorAt = DateTimeOffset.Now;
        LastPushError = message ?? string.Empty;
        PluginDiagnostics.Info($"Backend push error: retryable={retryable}, error={LastPushError}");
    }

    private static bool IsRetryableStatusCode(HttpStatusCode statusCode)
    {
        var code = (int)statusCode;
        return code == 408 || code == 429 || code >= 500;
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch
        {
        }
    }
}
