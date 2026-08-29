import { getTenant } from "@mr/tenants";

const tenant = getTenant();

export function formatPrice(kopecks: number): string {
  return new Intl.NumberFormat(tenant.locale, {
    currency: tenant.currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    style: "currency",
  }).format(Math.round(kopecks / 100));
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";

  return new Intl.DateTimeFormat(tenant.locale, {
    day: "2-digit",
    month: "2-digit",
    timeZone: tenant.timezone,
    year: "numeric",
  }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(tenant.locale, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: tenant.timezone,
  }).format(new Date(iso));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(tenant.locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tenant.timezone,
  }).format(new Date(iso));
}
