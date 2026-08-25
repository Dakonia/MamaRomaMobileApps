using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Reservly.IikoFrontBridge.MamaRoma;

/// <summary>
/// Связь с сервером мобильного приложения. Отдельный клиент со своим адресом
/// и секретом — очередь Reservly и эта не пересекаются ни в памяти, ни на диске.
///
/// Направление связи только одно: плагин сам ходит наружу. Ресторану не нужны
/// ни белый адрес, ни проброс портов, а при обрыве связи заказ подождёт
/// на сервере, а не потеряется.
/// </summary>
internal sealed class MamaRomaClient : IDisposable
{
    private readonly HttpClient _httpClient;
    private readonly MamaRomaConfig _config;

    public MamaRomaClient(MamaRomaConfig config)
    {
        _config = config;
        _httpClient = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(25),
        };
        _httpClient.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/json")
        );
        _httpClient.DefaultRequestHeaders.Add("X-Iiko-Bridge-Secret", config.Secret);
        _httpClient.DefaultRequestHeaders.Add("X-Iiko-Restaurant-Id", config.RestaurantId);
        _httpClient.DefaultRequestHeaders.Add("X-Iiko-Plugin-Version", PluginBuild.Version);

        // Имя терминала видно в админке: по нему понятно, какая машина на связи
        try
        {
            _httpClient.DefaultRequestHeaders.Add("X-Iiko-Terminal", Environment.MachineName);
        }
        catch
        {
            // Имя машины недоступно — не повод отказываться от работы
        }
    }

    public DateTimeOffset? LastSuccessAt { get; private set; }
    public DateTimeOffset? LastErrorAt { get; private set; }
    public string LastError { get; private set; } = string.Empty;

    /// <summary>Забрать заказы, которые ждут отправки в iiko.</summary>
    public async Task<PendingOrdersResponse> FetchPendingOrdersAsync(CancellationToken cancellationToken)
    {
        var url = $"{_config.BackendUrl}/orders/pending?restaurant_id={Uri.EscapeDataString(_config.RestaurantId)}"
                  + $"&limit={_config.DeliveryBatchSize}";
        var json = await GetAsync(url, cancellationToken);
        if (string.IsNullOrWhiteSpace(json))
        {
            return new PendingOrdersResponse();
        }

        var parsed = BridgeJson.DeserializeCaseInsensitive<PendingOrdersResponse>(json);
        return parsed ?? new PendingOrdersResponse();
    }

    /// <summary>Отчитаться, что получилось с каждым заказом.</summary>
    public Task ReportOrderResultsAsync(OrderAcceptBatch batch, CancellationToken cancellationToken)
    {
        return PostAsync($"{_config.BackendUrl}/orders/ack", batch, cancellationToken);
    }

    public Task PushStopListAsync(StopListSnapshot snapshot, CancellationToken cancellationToken)
    {
        return PostAsync($"{_config.BackendUrl}/stop-list", snapshot, cancellationToken);
    }

    public Task PushMenuAsync(MenuSnapshot snapshot, CancellationToken cancellationToken)
    {
        return PostAsync($"{_config.BackendUrl}/menu", snapshot, cancellationToken);
    }

    public Task PushDeliveryStatusAsync(DeliveryStatusSnapshot snapshot, CancellationToken cancellationToken)
    {
        return PostAsync($"{_config.BackendUrl}/delivery-status", snapshot, cancellationToken);
    }

    // ─────────────────────── транспорт ───────────────────────

    private async Task<string> GetAsync(string url, CancellationToken cancellationToken)
    {
        try
        {
            using (var response = await _httpClient.GetAsync(url, cancellationToken))
            {
                var body = await ReadBodyAsync(response);
                EnsureAccepted(response, body);
                MarkSuccess();
                return body;
            }
        }
        catch (Exception exc)
        {
            MarkError(exc);
            throw;
        }
    }

    private async Task PostAsync(string url, object payload, CancellationToken cancellationToken)
    {
        var json = BridgeJson.SerializeCamelCase(payload);
        try
        {
            using (var content = new StringContent(json, Encoding.UTF8, "application/json"))
            using (var response = await _httpClient.PostAsync(url, content, cancellationToken))
            {
                var body = await ReadBodyAsync(response);
                EnsureAccepted(response, body);
                MarkSuccess();
            }
        }
        catch (Exception exc)
        {
            MarkError(exc);
            throw;
        }
    }

    private static async Task<string> ReadBodyAsync(HttpResponseMessage response)
    {
        try
        {
            return await response.Content.ReadAsStringAsync();
        }
        catch
        {
            return string.Empty;
        }
    }

    private static void EnsureAccepted(HttpResponseMessage response, string body)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        // Тело ответа обрезаем: в лог диагностики не должна уезжать простыня HTML,
        // если вместо API ответил прокси или страница ошибки
        var snippet = (body ?? string.Empty).Trim();
        if (snippet.Length > 300)
        {
            snippet = snippet.Substring(0, 300) + "…";
        }

        throw new MamaRomaPushException(
            $"HTTP {(int)response.StatusCode} {response.ReasonPhrase}. {snippet}",
            IsRetryable(response.StatusCode)
        );
    }

    /// <summary>
    /// Что имеет смысл повторить. Ошибки настройки — 401, 403, 404 — повторять
    /// бессмысленно: пока человек не поправит конфиг, ответ не изменится.
    /// </summary>
    private static bool IsRetryable(HttpStatusCode status)
    {
        var code = (int)status;
        if (code >= 500) return true;
        return status == HttpStatusCode.RequestTimeout
               || code == 429;
    }

    private void MarkSuccess()
    {
        LastSuccessAt = DateTimeOffset.Now;
        LastError = string.Empty;
    }

    private void MarkError(Exception exc)
    {
        LastErrorAt = DateTimeOffset.Now;
        LastError = exc.Message;
    }

    public void Dispose()
    {
        _httpClient?.Dispose();
    }
}

internal sealed class MamaRomaPushException : Exception
{
    public MamaRomaPushException(string message, bool retryable, Exception inner = null)
        : base(message, inner)
    {
        Retryable = retryable;
    }

    public bool Retryable { get; }
}
