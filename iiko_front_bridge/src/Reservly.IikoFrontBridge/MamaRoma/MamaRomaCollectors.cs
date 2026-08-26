using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Resto.Front.Api;
using Resto.Front.Api.Data.Assortment;
using Reservly.IikoFrontBridge.Collectors;

namespace Reservly.IikoFrontBridge.MamaRoma;

/// <summary>
/// Стоп-лист в терминах приложения: не сырые данные iiko, а готовое решение
/// «показывать блюдо гостю или нет».
/// </summary>
internal static class StopListMapper
{
    public static StopListSnapshot Collect(MamaRomaConfig config)
    {
        var snapshot = new StopListSnapshot
        {
            RestaurantId = config.RestaurantId,
            CapturedAt = DateTimeOffset.Now.ToString("O", CultureInfo.InvariantCulture),
            StopOnRemainingAmount = config.StopOnRemainingAmount,
            RemainingAmountThreshold = config.RemainingAmountThreshold,
        };

        var amounts = PluginContext.Operations.GetStopListProductsRemainingAmounts();
        foreach (var pair in amounts)
        {
            try
            {
                var product = pair.Key.Product;
                var size = pair.Key.ProductSize;
                if (product == null)
                {
                    continue;
                }

                var restricted = IsSellingRestricted(product, size);
                var remaining = pair.Value;

                // Два независимых основания скрыть блюдо.
                //
                // restricted — касса запрещает продажу, это формальный стоп-лист.
                // Единственный признак, которому можно верить безусловно.
                //
                // low_remaining — порций осталось мало. Продажу это не запрещает:
                // повар может выставить остаток и не ставить стоп, и тогда касса
                // спокойно пробьёт заказ. Для доставки это плохо: пока курьер едет,
                // последние порции разойдутся в зале. Поэтому прячем заранее —
                // но только если так настроено.
                var byRemaining = config.StopOnRemainingAmount
                                  && remaining <= config.RemainingAmountThreshold;

                var reason = restricted
                    ? "restricted"
                    : byRemaining ? "low_remaining" : string.Empty;

                snapshot.Items.Add(new StopListEntry
                {
                    ProductId = FrontOrderValueReader.ReadString(product, "Id"),
                    ProductName = FrontOrderValueReader.ReadString(product, "Name", "Title"),
                    SizeId = size == null ? string.Empty : FrontOrderValueReader.ReadString(size, "Id"),
                    RemainingAmount = remaining,
                    IsRestricted = restricted,
                    IsStopped = restricted || byRemaining,
                    Reason = reason,
                });
            }
            catch (Exception exc)
            {
                PluginDiagnostics.Info($"MamaRoma StopList: позиция пропущена: {exc.Message}");
            }
        }

        PluginDiagnostics.Info(
            $"MamaRoma StopList: {snapshot.Items.Count(item => item.IsStopped)} в стопе из {snapshot.Items.Count}."
        );
        return snapshot;
    }

    private static bool IsSellingRestricted(IProduct product, IProductSize size)
    {
        try
        {
            return PluginContext.Operations.IsStopListProductSellingRestricted(product, size);
        }
        catch
        {
            return false;
        }
    }
}

/// <summary>
/// Номенклатура точки. Нужна, чтобы связать блюда приложения с товарами iiko:
/// один раз при настройке, дальше — чтобы ловить переименования и новые позиции.
/// </summary>
internal static class MenuCollector
{
    public static MenuSnapshot Collect(MamaRomaConfig config)
    {
        var snapshot = new MenuSnapshot
        {
            RestaurantId = config.RestaurantId,
            CapturedAt = DateTimeOffset.Now.ToString("O", CultureInfo.InvariantCulture),
        };

        var products = LoadProducts(config.MenuIncludeInactive);
        foreach (var product in products)
        {
            try
            {
                var productId = FrontOrderValueReader.ReadString(product, "Id");
                var groupInfo = ProductGroupResolver.Resolve(
                    product,
                    productId,
                    (string.Empty, string.Empty, string.Empty, string.Empty, string.Empty, string.Empty)
                );

                snapshot.Products.Add(new MenuProduct
                {
                    ProductId = productId,
                    Name = FrontOrderValueReader.ReadString(product, "Name", "Title"),
                    Code = FrontOrderValueReader.ReadString(product, "FastCode", "Number", "Code"),
                    GroupName = groupInfo.name,
                    GroupPath = groupInfo.path,
                    Category = groupInfo.category,
                    MeasureUnit = product.MeasuringUnitName ?? string.Empty,
                    IsActive = product.IsActive,
                    HasSizes = HasSizes(product),
                });
            }
            catch (Exception exc)
            {
                PluginDiagnostics.Info($"MamaRoma Menu: товар пропущен: {exc.Message}");
            }
        }

        PluginDiagnostics.Info($"MamaRoma Menu: выгружено {snapshot.Products.Count} товаров.");
        return snapshot;
    }

    private static IEnumerable<IProduct> LoadProducts(bool includeInactive)
    {
        try
        {
            // Отдельного «только активные» в V8 нет — фильтруем сами
            var products = PluginContext.Operations.GetAllProducts();
            if (products == null)
            {
                return Enumerable.Empty<IProduct>();
            }

            return includeInactive ? products : products.Where(item => item.IsActive);
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Error("MamaRoma Menu: не удалось получить номенклатуру.", exc);
            return Enumerable.Empty<IProduct>();
        }
    }

    /// <summary>
    /// Есть ли у товара размеры. Если есть — в заказе нужно передавать ещё и код
    /// размера, иначе iiko не поймёт, что именно пробивать.
    /// </summary>
    private static bool HasSizes(IProduct product)
    {
        try
        {
            var scale = product.Scale;
            return scale?.Sizes != null && scale.Sizes.Count > 0;
        }
        catch
        {
            return false;
        }
    }
}

/// <summary>
/// Состояние заказов, заведённых через нас. Гостю показываем четыре этапа,
/// и на V8 они берутся из временных меток заказа, а не из статуса:
/// «готовим» — это момент, когда позиции ушли на кухню.
/// </summary>
internal static class DeliveryStatusCollector
{
    public static DeliveryStatusSnapshot Collect(MamaRomaConfig config)
    {
        var snapshot = new DeliveryStatusSnapshot
        {
            RestaurantId = config.RestaurantId,
            CapturedAt = DateTimeOffset.Now.ToString("O", CultureInfo.InvariantCulture),
        };

        var since = DateTime.Now.AddHours(-config.DeliveryStatusLookbackHours);

        foreach (var order in LoadDeliveryOrders())
        {
            try
            {
                // Наши заказы узнаём по внешнему номеру: его проставил DeliveryWriter.
                // Чужие — с сайта, из колл-центра — пропускаем молча
                var externalNumber = FrontOrderValueReader.ReadString(order, "ExternalNumber");
                if (string.IsNullOrWhiteSpace(externalNumber))
                {
                    continue;
                }

                var createTime = ReadDate(order, "CreateTime");
                if (createTime.HasValue && createTime.Value < since)
                {
                    continue;
                }

                snapshot.Orders.Add(new DeliveryStatusEntry
                {
                    OrderId = externalNumber,
                    IikoOrderId = FrontOrderValueReader.ReadString(order, "Id"),
                    IikoOrderNumber = FrontOrderValueReader.ReadString(order, "Number"),
                    Status = FrontOrderValueReader.ReadString(order, "DeliveryStatus"),

                    ConfirmedAt = ReadDateString(order, "ConfirmTime"),
                    PrintedAt = ReadDateString(order, "PrintTime"),
                    CookingFinishedAt = ReadDateString(order, "CookingFinishTime"),
                    SentAt = ReadDateString(order, "SendTime"),
                    DeliveredAt = ReadDateString(order, "ActualDeliverTime"),
                    CancelledAt = ReadDateString(order, "CancelTime"),
                    PredictedCookingCompleteAt = ReadDateString(order, "PredictedCookingCompleteTime"),

                    HasProblem = ReadBool(order, "HasProblem"),
                    ProblemComment = FrontOrderValueReader.ReadString(order, "ProblemComment"),
                    CancelCause = FrontOrderValueReader.ReadNestedName(order, "CancelCause"),
                    CourierName = FrontOrderValueReader.ReadNestedName(order, "Courier"),
                });
            }
            catch (Exception exc)
            {
                PluginDiagnostics.Info($"MamaRoma Status: заказ пропущен: {exc.Message}");
            }
        }

        return snapshot;
    }

    private static IEnumerable<object> LoadDeliveryOrders()
    {
        try
        {
            // false — без удалённых: их статусы гостю показывать нечего
            var orders = PluginContext.Operations.GetDeliveryOrders(false);
            return orders == null ? Enumerable.Empty<object>() : orders.Cast<object>();
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Error("MamaRoma Status: не удалось получить доставки.", exc);
            return Enumerable.Empty<object>();
        }
    }

    private static DateTime? ReadDate(object source, string property)
    {
        try
        {
            var value = FrontOrderValueReader.ReadProperty(source, property);
            if (value is DateTime dateTime) return dateTime;
            if (value is DateTimeOffset offset) return offset.LocalDateTime;
            return null;
        }
        catch
        {
            return null;
        }
    }

    private static string ReadDateString(object source, string property)
    {
        var value = ReadDate(source, property);
        return value.HasValue
            ? value.Value.ToString("O", CultureInfo.InvariantCulture)
            : string.Empty;
    }

    private static bool ReadBool(object source, string property)
    {
        try
        {
            var value = FrontOrderValueReader.ReadProperty(source, property);
            return value is bool flag && flag;
        }
        catch
        {
            return false;
        }
    }
}
