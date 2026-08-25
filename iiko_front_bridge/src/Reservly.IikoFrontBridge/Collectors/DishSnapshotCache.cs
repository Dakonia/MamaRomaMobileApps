using System.Collections.Generic;
using System.Linq;

namespace Reservly.IikoFrontBridge.Collectors;

// LiveRevenueCollector пересчитывает блюда сегодняшнего бизнес-дня с нуля из GetPastOrders()
// на каждом опросе. Если один опрос не увидел часть уже закрытых заказов (задержка внутри
// iikoFront API, гонка при full-scan), его меньшие числа не должны откатывать уже отправленные
// раньше большие — иначе итог за день молча уменьшается и сам не восстанавливается.
// Кэш держит максимум по каждому блюду за текущий бизнес-день и сбрасывается при смене дня.
internal sealed class DishSnapshotCache
{
    private readonly Dictionary<(string, string, string, string, string), FrontDishRecord> _best =
        new Dictionary<(string, string, string, string, string), FrontDishRecord>();
    private readonly object _lock = new object();
    private string _cachedDay = string.Empty;

    private static (string, string, string, string, string) BuildKey(FrontDishRecord rec) =>
        (rec.DishName, rec.GroupPath, rec.Source, rec.WaiterFrontUserId, rec.WaiterName);

    public List<FrontDishRecord> MergeAndUpdate(List<FrontDishRecord> freshDishes, string today)
    {
        lock (_lock)
        {
            if (_cachedDay != today)
            {
                _best.Clear();
                _cachedDay = today;
            }

            foreach (var rec in freshDishes)
            {
                var key = BuildKey(rec);
                if (_best.TryGetValue(key, out var existing) && existing.Count >= rec.Count)
                {
                    continue;
                }
                _best[key] = rec;
            }

            return _best.Values.ToList();
        }
    }
}
