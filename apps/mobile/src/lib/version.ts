import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { tenant } from '@/lib/tenant';

/** Версия установленного приложения: «1.2.3». */
export const appVersion: string = Constants.expoConfig?.version ?? '0.0.0';

/** Сравнение версий по частям: «1.10.0» новее «1.9.9», хотя строкой — нет. */
export function isOlder(version: string, than: string): boolean {
  const left = version.split('.').map(Number);
  const right = than.split('.').map(Number);

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a < b;
  }

  return false;
}

/** Приложение слишком старое: с таким API уже не работает. */
export function needsUpdate(): boolean {
  const minimum = tenant.stores.minSupportedVersion;
  return Boolean(minimum) && isOlder(appVersion, minimum ?? '0.0.0');
}

/** Куда отправлять за обновлением: у Android магазинов может быть два. */
export function storeUrl(): string | null {
  const { appStoreUrl, googlePlayUrl, ruStoreUrl } = tenant.stores;

  if (Platform.OS === 'ios') return appStoreUrl || null;
  return googlePlayUrl || ruStoreUrl || null;
}
