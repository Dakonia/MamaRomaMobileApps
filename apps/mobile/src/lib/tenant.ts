import type { TenantConfig } from '@mr/tenants';
import Constants from 'expo-constants';

type AppExtra = {
  tenantId?: string;
  tenant?: TenantConfig;
  apiUrl?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as AppExtra;

if (!extra.tenant) {
  throw new Error(
    'Конфиг тенанта не попал в сборку. Проверьте extra.tenant в apps/mobile/app.config.ts',
  );
}

export const tenant: TenantConfig = extra.tenant;

function resolveApiUrl(configured: string): string {
  const isLocal = configured.includes('localhost') || configured.includes('127.0.0.1');
  if (!isLocal) {
    return configured;
  }

  const port = configured.split(':').pop() ?? '8000';

  // В браузере берём адрес, по которому открыта страница: на телефоне это IP Mac
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const browserHost = window.location.hostname;
    if (browserHost !== 'localhost' && browserHost !== '127.0.0.1') {
      return `http://${browserHost}:${port}`;
    }
    return configured;
  }

  // На телефоне localhost — это сам телефон. В режиме разработки берём адрес
  // машины, на которой крутится Metro, и подставляем порт API.
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (!host || host === 'localhost' || host === '127.0.0.1') {
    return configured;
  }

  return `http://${host}:${port}`;
}

export const apiUrl: string = resolveApiUrl(extra.apiUrl ?? 'http://localhost:8000');
