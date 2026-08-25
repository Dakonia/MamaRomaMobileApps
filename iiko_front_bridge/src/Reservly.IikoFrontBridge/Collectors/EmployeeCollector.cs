using System.Linq;
using Resto.Front.Api;

namespace Reservly.IikoFrontBridge.Collectors;

internal static class EmployeeCollector
{
    public static FrontEmployeePayload Collect()
    {
        var payload = new FrontEmployeePayload();
        var users = PluginContext.Operations.GetUsers(fromAllDepartments: true);
        foreach (var user in users)
        {
            var roles = PluginContext.Operations
                .GetUserRoles(user)
                .Select(role => role.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct()
                .ToList();

            payload.Employees.Add(new FrontEmployeeRecord
            {
                FrontUserId = user.Id.ToString(),
                Name = user.Name ?? string.Empty,
                Phone = user.CellPhone ?? string.Empty,
                Code = user.Code ?? string.Empty,
                Roles = roles,
            });
        }
        return payload;
    }
}
