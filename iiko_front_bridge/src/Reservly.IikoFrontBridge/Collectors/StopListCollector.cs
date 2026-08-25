using System;
using System.Globalization;
using Resto.Front.Api;

namespace Reservly.IikoFrontBridge.Collectors;

internal static class StopListCollector
{
    public static FrontStopListPayload Collect()
    {
        var payload = new FrontStopListPayload
        {
            CapturedAt = DateTimeOffset.Now.ToString("O", CultureInfo.InvariantCulture),
        };

        var amounts = PluginContext.Operations.GetStopListProductsRemainingAmounts();
        foreach (var pair in amounts)
        {
            try
            {
                var productAndSize = pair.Key;
                var product = productAndSize.Product;
                var size = productAndSize.ProductSize;
                if (product == null)
                {
                    continue;
                }

                var productId = FrontOrderValueReader.ReadString(product, "Id");
                var groupInfo = ProductGroupResolver.Resolve(
                    product,
                    productId,
                    (string.Empty, string.Empty, string.Empty, string.Empty, string.Empty, string.Empty)
                );

                var isRestricted = false;
                try
                {
                    isRestricted = PluginContext.Operations.IsStopListProductSellingRestricted(product, size);
                }
                catch { }

                payload.Items.Add(new FrontStopListItemRecord
                {
                    ProductId = productId,
                    ProductName = FrontOrderValueReader.ReadString(product, "Name", "Title"),
                    SizeId = size == null ? string.Empty : FrontOrderValueReader.ReadString(size, "Id"),
                    SizeName = size == null ? string.Empty : FrontOrderValueReader.ReadString(size, "Name", "Title"),
                    RemainingAmount = pair.Value,
                    IsRestricted = isRestricted,
                    GroupName = groupInfo.name,
                    GroupPath = groupInfo.path,
                    GroupLevel1 = groupInfo.level1,
                    GroupLevel2 = groupInfo.level2,
                    GroupLevel3 = groupInfo.level3,
                    ProductCategory = groupInfo.category,
                });
            }
            catch (Exception exc)
            {
                PluginDiagnostics.Info($"StopListCollector: item skipped: {exc.Message}");
            }
        }

        PluginDiagnostics.Info($"StopListCollector: built {payload.Items.Count} stop-list records.");
        return payload;
    }
}
