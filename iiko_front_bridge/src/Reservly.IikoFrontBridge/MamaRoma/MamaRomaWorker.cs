using System;
using System.Threading;
using System.Threading.Tasks;

namespace Reservly.IikoFrontBridge.MamaRoma;

/// <summary>
/// Всё, что относится к мобильному приложению сети, живёт здесь и только здесь.
///
/// Отдельный таймер, отдельный клиент, отдельный секрет. Работа с Reservly
/// идёт своим циклом и об этом классе ничего не знает. Любое исключение
/// гасится внутри: сломаться должна интеграция приложения, а не сбор данных,
/// который уже работает на 34 точках.
/// </summary>
internal sealed class MamaRomaWorker : IDisposable
{
    private readonly MamaRomaConfig _config;
    private readonly MamaRomaClient _client;
    private readonly DeliveryWriter _deliveryWriter;
    private readonly AckQueue _ackQueue;
    private readonly Timer _timer;
    private readonly SemaphoreSlim _lock = new SemaphoreSlim(1, 1);

    private DateTimeOffset _lastOrdersPollAt = DateTimeOffset.MinValue;
    private DateTimeOffset _lastStopListAt = DateTimeOffset.MinValue;
    private DateTimeOffset _lastMenuAt = DateTimeOffset.MinValue;
    private DateTimeOffset _lastStatusAt = DateTimeOffset.MinValue;

    private string _lastStopListHash = string.Empty;
    private string _lastMenuHash = string.Empty;
    private string _lastStatusHash = string.Empty;

    private bool _disposed;

    /// <summary>
    /// Создаёт работника, если секция настроена. Иначе возвращает null —
    /// плагин продолжит работать без интеграции приложения.
    /// </summary>
    public static MamaRomaWorker TryCreate(MamaRomaConfig config, string baseDirectory)
    {
        if (config == null)
        {
            return null;
        }

        config.Normalize();
        if (!config.IsUsable(out var reason))
        {
            PluginDiagnostics.Info($"MamaRoma: интеграция не запущена — {reason}.");
            return null;
        }

        try
        {
            return new MamaRomaWorker(config, baseDirectory);
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Error("MamaRoma: не удалось запустить интеграцию.", exc);
            return null;
        }
    }

    private MamaRomaWorker(MamaRomaConfig config, string baseDirectory)
    {
        _config = config;
        _client = new MamaRomaClient(config);
        _deliveryWriter = new DeliveryWriter(config);
        _ackQueue = new AckQueue(baseDirectory);

        // Собственный таймер: цикл Reservly не должен ждать наших запросов,
        // а наши задержки не должны сдвигать его расписание
        _timer = new Timer(OnTimer, null, TimeSpan.FromSeconds(15), TimeSpan.FromSeconds(10));

        PluginDiagnostics.Info(
            $"MamaRoma: интеграция запущена. Ресторан={config.RestaurantId}, " +
            $"заказы={config.AcceptDeliveries}, стоп-лист={config.SyncStopList}, " +
            $"меню={config.SyncMenu}, статусы={config.SyncDeliveryStatus}, " +
            $"порогОстатка={config.RemainingAmountThreshold} (по остатку={config.StopOnRemainingAmount})."
        );
    }

    private async void OnTimer(object _)
    {
        if (_disposed || !await _lock.WaitAsync(0))
        {
            return;
        }

        try
        {
            var now = DateTimeOffset.Now;

            // Каждый шаг сам по себе: упавший стоп-лист не мешает забрать заказы
            await RunStepAsync("заказы", ShouldRun(_lastOrdersPollAt, now, TimeSpan.FromSeconds(_config.DeliveryPollIntervalSeconds)) && _config.AcceptDeliveries,
                () => { _lastOrdersPollAt = now; return PullAndWriteOrdersAsync(); });

            await RunStepAsync("стоп-лист", ShouldRun(_lastStopListAt, now, TimeSpan.FromMinutes(_config.StopListIntervalMinutes)) && _config.SyncStopList,
                () => { _lastStopListAt = now; return PushStopListAsync(); });

            await RunStepAsync("статусы", ShouldRun(_lastStatusAt, now, TimeSpan.FromSeconds(_config.DeliveryStatusIntervalSeconds)) && _config.SyncDeliveryStatus,
                () => { _lastStatusAt = now; return PushDeliveryStatusAsync(); });

            await RunStepAsync("меню", ShouldRun(_lastMenuAt, now, TimeSpan.FromMinutes(_config.MenuIntervalMinutes)) && _config.SyncMenu,
                () => { _lastMenuAt = now; return PushMenuAsync(); });
        }
        catch (Exception exc)
        {
            // Досюда дойти не должно, но пусть будет: необработанное исключение
            // в async void обрушит процесс плагина целиком
            PluginDiagnostics.Error("MamaRoma: цикл упал.", exc);
        }
        finally
        {
            _lock.Release();
        }
    }

    private static bool ShouldRun(DateTimeOffset last, DateTimeOffset now, TimeSpan interval)
    {
        return now - last >= interval;
    }

    private static async Task RunStepAsync(string what, bool shouldRun, Func<Task> step)
    {
        if (!shouldRun)
        {
            return;
        }

        try
        {
            await step();
        }
        catch (MamaRomaPushException exc)
        {
            // Ошибка настройки повторяться будет одинаково — пишем спокойно,
            // без стека, чтобы не забивать лог одним и тем же
            if (exc.Retryable)
            {
                PluginDiagnostics.Info($"MamaRoma [{what}]: временная ошибка, повторим. {exc.Message}");
            }
            else
            {
                PluginDiagnostics.Error($"MamaRoma [{what}]: сервер отказал.", exc);
            }
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Error($"MamaRoma [{what}]: шаг не выполнен.", exc);
        }
    }

    // ─────────────────────── заказы ───────────────────────

    private async Task PullAndWriteOrdersAsync()
    {
        // Сначала доносим то, что не дошло раньше: пока сервер не знает об
        // успехе, он считает заказ незаведённым и отдаст его снова
        await FlushAckQueueAsync();

        var pending = await _client.FetchPendingOrdersAsync(CancellationToken.None);
        if (pending.Orders.Count == 0)
        {
            return;
        }

        PluginDiagnostics.Info($"MamaRoma: получено заказов к заведению: {pending.Orders.Count}.");

        var batch = new OrderAcceptBatch { RestaurantId = _config.RestaurantId };
        foreach (var order in pending.Orders)
        {
            // Заводим по одному: неудача с одним заказом не должна утянуть остальные
            batch.Results.Add(_deliveryWriter.Write(order));
        }

        // Отчитываемся всегда, даже если всё упало: сервер должен знать,
        // что заказ не принят, и показать это менеджеру
        try
        {
            await _client.ReportOrderResultsAsync(batch, CancellationToken.None);
        }
        catch (Exception exc)
        {
            // Связь пропала уже после заведения заказа — откладываем отчёт.
            // Повторно заказ в кассу не уйдёт: DeliveryWriter узнает его
            // по внешнему номеру и вернёт прежний результат
            PluginDiagnostics.Info($"MamaRoma: отчёт не ушёл, откладываем. {exc.Message}");
            _ackQueue.Keep(batch);
        }
    }

    /// <summary>Досылает отчёты, накопившиеся, пока не было связи.</summary>
    private async Task FlushAckQueueAsync()
    {
        foreach (var pair in _ackQueue.Pending())
        {
            try
            {
                await _client.ReportOrderResultsAsync(pair.Value, CancellationToken.None);
                _ackQueue.Done(pair.Key);
                PluginDiagnostics.Info("MamaRoma: отложенный отчёт доставлен.");
            }
            catch (Exception exc)
            {
                // Связи всё ещё нет — оставляем в очереди и уходим до следующего круга
                PluginDiagnostics.Info($"MamaRoma: отложенный отчёт подождёт. {exc.Message}");
                return;
            }
        }
    }

    // ─────────────────────── выгрузки ───────────────────────

    private async Task PushStopListAsync()
    {
        var snapshot = StopListMapper.Collect(_config);

        // Стоп-лист меняется редко, а опрашиваем часто. Не гоняем одно и то же
        var hash = BridgeJson.SerializeCamelCase(snapshot.Items);
        if (hash == _lastStopListHash)
        {
            return;
        }

        await _client.PushStopListAsync(snapshot, CancellationToken.None);
        _lastStopListHash = hash;
    }

    private async Task PushMenuAsync()
    {
        var snapshot = MenuCollector.Collect(_config);
        if (snapshot.Products.Count == 0)
        {
            return;
        }

        var hash = BridgeJson.SerializeCamelCase(snapshot.Products);
        if (hash == _lastMenuHash)
        {
            return;
        }

        await _client.PushMenuAsync(snapshot, CancellationToken.None);
        _lastMenuHash = hash;
    }

    private async Task PushDeliveryStatusAsync()
    {
        var snapshot = DeliveryStatusCollector.Collect(_config);
        if (snapshot.Orders.Count == 0)
        {
            return;
        }

        var hash = BridgeJson.SerializeCamelCase(snapshot.Orders);
        if (hash == _lastStatusHash)
        {
            return;
        }

        await _client.PushDeliveryStatusAsync(snapshot, CancellationToken.None);
        _lastStatusHash = hash;
    }

    public void Dispose()
    {
        _disposed = true;
        try { _timer?.Dispose(); } catch { }
        try { _client?.Dispose(); } catch { }
        try { _lock?.Dispose(); } catch { }
        PluginDiagnostics.Info("MamaRoma: интеграция остановлена.");
    }
}
