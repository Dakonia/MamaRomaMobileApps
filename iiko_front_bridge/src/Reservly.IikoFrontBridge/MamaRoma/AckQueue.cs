using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace Reservly.IikoFrontBridge.MamaRoma;

/// <summary>
/// Отчёты о заведённых заказах, которые не удалось отправить.
///
/// Заказ уже в iiko, а сервер об этом не знает — и через три минуты отдаст его
/// снова. Поэтому неотправленный отчёт кладём на диск рядом с плагином и
/// повторяем на следующем круге. Связь в ресторане пропадает регулярно, и
/// терять из-за этого отчёты нельзя.
/// </summary>
internal sealed class AckQueue
{
    private const int MaxFiles = 200;

    private readonly string _folder;

    public AckQueue(string baseDirectory)
    {
        _folder = Path.Combine(baseDirectory ?? AppDomain.CurrentDomain.BaseDirectory, "mamaroma-ack-queue");
    }

    public int Depth
    {
        get
        {
            try
            {
                return Directory.Exists(_folder) ? Directory.GetFiles(_folder, "*.json").Length : 0;
            }
            catch
            {
                return 0;
            }
        }
    }

    /// <summary>Откладывает отчёт до лучшей связи.</summary>
    public void Keep(OrderAcceptBatch batch)
    {
        if (batch == null || batch.Results.Count == 0)
        {
            return;
        }

        try
        {
            Directory.CreateDirectory(_folder);

            // Очередь не должна расти бесконечно: если связи нет неделю,
            // самые старые отчёты уже никому не нужны
            var files = Directory.GetFiles(_folder, "*.json").OrderBy(File.GetCreationTimeUtc).ToList();
            while (files.Count >= MaxFiles)
            {
                TryDelete(files[0]);
                files.RemoveAt(0);
            }

            var name = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff", CultureInfo.InvariantCulture)
                       + "-" + Guid.NewGuid().ToString("N").Substring(0, 6) + ".json";

            File.WriteAllText(Path.Combine(_folder, name), BridgeJson.SerializeCamelCase(batch));
            PluginDiagnostics.Info($"MamaRoma: отчёт отложен до связи, в очереди {Depth}.");
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Error("MamaRoma: не удалось отложить отчёт.", exc);
        }
    }

    /// <summary>Отложенные отчёты вместе с путями: удаляем только доставленные.</summary>
    public IEnumerable<KeyValuePair<string, OrderAcceptBatch>> Pending()
    {
        string[] files;
        try
        {
            if (!Directory.Exists(_folder))
            {
                yield break;
            }
            files = Directory.GetFiles(_folder, "*.json").OrderBy(File.GetCreationTimeUtc).ToArray();
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info($"MamaRoma: очередь отчётов недоступна: {exc.Message}");
            yield break;
        }

        foreach (var file in files)
        {
            OrderAcceptBatch batch = null;
            try
            {
                batch = BridgeJson.DeserializeCaseInsensitive<OrderAcceptBatch>(File.ReadAllText(file));
            }
            catch (Exception exc)
            {
                // Битый файл повторять бессмысленно — убираем, чтобы не мешал
                PluginDiagnostics.Info($"MamaRoma: отложенный отчёт испорчен, удалён: {exc.Message}");
                TryDelete(file);
            }

            if (batch != null && batch.Results.Count > 0)
            {
                yield return new KeyValuePair<string, OrderAcceptBatch>(file, batch);
            }
        }
    }

    public void Done(string file)
    {
        TryDelete(file);
    }

    private static void TryDelete(string file)
    {
        try
        {
            File.Delete(file);
        }
        catch
        {
            // Файл держит антивирус или он уже удалён — на следующем круге разберёмся
        }
    }
}
