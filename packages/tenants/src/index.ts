import mamaromaData from "../data/mamaroma.json";
import type { TenantConfig, TenantId } from "./types";

export * from "./types";

export const tenants: Record<TenantId, TenantConfig> = {
  mamaroma: mamaromaData as TenantConfig,
};

export const DEFAULT_TENANT_ID: TenantId = "mamaroma";

export function getTenant(id: TenantId = DEFAULT_TENANT_ID): TenantConfig {
  const tenant = tenants[id];
  if (!tenant) {
    throw new Error(
      `Неизвестный тенант «${id}». Доступные: ${Object.keys(tenants).join(", ")}`,
    );
  }
  return tenant;
}
