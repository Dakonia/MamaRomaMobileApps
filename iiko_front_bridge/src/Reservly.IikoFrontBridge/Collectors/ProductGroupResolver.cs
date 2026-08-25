using System;
using System.Collections.Generic;
using Resto.Front.Api;
using Resto.Front.Api.Data.Assortment;

namespace Reservly.IikoFrontBridge.Collectors;

internal static class ProductGroupResolver
{
    private static readonly object CacheLock = new object();
    private static readonly Dictionary<string, (string name, string path, string level1, string level2, string level3, string category)> Cache =
        new Dictionary<string, (string name, string path, string level1, string level2, string level3, string category)>(StringComparer.OrdinalIgnoreCase);

    public static (string name, string path, string level1, string level2, string level3, string category) Resolve(
        object product,
        string productId,
        (string name, string path, string level1, string level2, string level3, string category) directInfo)
    {
        if (!string.IsNullOrWhiteSpace(directInfo.path) && !string.IsNullOrWhiteSpace(directInfo.name))
        {
            return directInfo;
        }

        var key = FirstNonEmpty(productId, FrontOrderValueReader.ReadString(product, "Id", "ProductId", "ExternalId"));
        if (string.IsNullOrWhiteSpace(key))
        {
            return directInfo;
        }

        lock (CacheLock)
        {
            if (Cache.TryGetValue(key, out var cached))
            {
                return Merge(directInfo, cached);
            }
        }

        var resolved = ResolveFromIiko(product, key);
        lock (CacheLock)
        {
            Cache[key] = resolved;
        }

        return Merge(directInfo, resolved);
    }

    private static (string name, string path, string level1, string level2, string level3, string category) ResolveFromIiko(object product, string productId)
    {
        try
        {
            var iikoProduct = ResolveProduct(product, productId);
            if (iikoProduct == null)
            {
                return Empty();
            }

            var category = ReadProductCategory(iikoProduct);
            var group = PluginContext.Operations.TryGetParentByProduct(iikoProduct);
            var parts = ResolveGroupChain(group);
            var path = string.Join("/", parts);
            return (
                parts.Count > 0 ? parts[parts.Count - 1] : string.Empty,
                path,
                parts.Count > 0 ? parts[0] : string.Empty,
                parts.Count > 1 ? parts[1] : string.Empty,
                parts.Count > 2 ? parts[2] : string.Empty,
                category
            );
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info($"ProductGroupResolver: product {productId} group resolve failed: {exc.Message}");
            return Empty();
        }
    }

    private static IProduct ResolveProduct(object product, string productId)
    {
        if (product is IProduct iikoProduct)
        {
            return iikoProduct;
        }

        if (!Guid.TryParse(productId, out var id))
        {
            return null;
        }

        try
        {
            return PluginContext.Operations.TryGetProductById(id);
        }
        catch
        {
            return null;
        }
    }

    private static List<string> ResolveGroupChain(IProductGroup group)
    {
        var parts = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var current = group;

        while (current != null && seen.Add(current.Id.ToString()) && parts.Count < 8)
        {
            if (!string.IsNullOrWhiteSpace(current.Name))
            {
                parts.Insert(0, current.Name.Trim());
            }

            try
            {
                current = PluginContext.Operations.TryGetParentByProductGroup(current);
            }
            catch
            {
                current = null;
            }
        }

        return parts;
    }

    private static string ReadProductCategory(IProduct product)
    {
        try
        {
            return product.ItemCategory == null
                ? string.Empty
                : FrontOrderValueReader.ReadString(product.ItemCategory, "Name", "Code", "Title");
        }
        catch
        {
            return string.Empty;
        }
    }

    private static (string name, string path, string level1, string level2, string level3, string category) Merge(
        (string name, string path, string level1, string level2, string level3, string category) primary,
        (string name, string path, string level1, string level2, string level3, string category) fallback)
    {
        return (
            FirstNonEmpty(primary.name, fallback.name),
            FirstNonEmpty(primary.path, fallback.path),
            FirstNonEmpty(primary.level1, fallback.level1),
            FirstNonEmpty(primary.level2, fallback.level2),
            FirstNonEmpty(primary.level3, fallback.level3),
            FirstNonEmpty(primary.category, fallback.category)
        );
    }

    private static (string name, string path, string level1, string level2, string level3, string category) Empty()
    {
        return (string.Empty, string.Empty, string.Empty, string.Empty, string.Empty, string.Empty);
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
}
