export type Point = { latitude: number; longitude: number };

const EARTH_KM = 6371;

/** Расстояние по прямой: для «какой ресторан ближе» этого достаточно. */
export function distanceKm(from: Point, to: Point): number {
  const rad = Math.PI / 180;
  const dLat = (to.latitude - from.latitude) * rad;
  const dLon = (to.longitude - from.longitude) * rad;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(from.latitude * rad) * Math.cos(to.latitude * rad) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Близкое считаем в метрах, дальнее — в километрах с одним знаком. */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} м`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} км`;
  return `${Math.round(km)} км`;
}
