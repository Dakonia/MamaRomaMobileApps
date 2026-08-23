import Constants from 'expo-constants';

type Params = Record<string, string | number | boolean | null | undefined>;

type Metrica = {
  activate: (config: Record<string, unknown>) => void;
  reportEvent: (name: string, params?: Record<string, unknown>) => void;
  reportError: (message: string, error?: unknown) => void;
  setUserProfileID: (id: string) => void;
  reportRevenue?: (revenue: Record<string, unknown>) => void;
};

const key = (Constants.expoConfig?.extra as { appMetricaKey?: string } | undefined)?.appMetricaKey;

/**
 * Нативного модуля нет в Expo Go — там аналитика молча выключается, чтобы
 * разработка не падала. В собранном приложении он есть всегда.
 */
function load(): Metrica | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('@appmetrica/react-native-analytics') as {
      default?: Metrica;
    } & Metrica;

    return module.default ?? module;
  } catch {
    return null;
  }
}

let metrica: Metrica | null = null;
let ready = false;

/** Включаем сбор при запуске: без ключа и вне сборки просто ничего не делаем. */
export function startAnalytics(): void {
  if (ready || !key) return;

  metrica = load();
  if (!metrica) return;

  try {
    metrica.activate({
      apiKey: key,
      sessionTimeout: 120,
      // Падения и зависания собираются сами, отдельного инструмента не нужно
      crashReporting: true,
      appOpenTrackingEnabled: true,
      // Точное местоположение аналитике незачем: город виден и без него
      locationTracking: false,
    });
    ready = true;
  } catch {
    metrica = null;
  }
}

/** Событие гостя: имя на латинице, значения — короткие и без личных данных. */
export function track(event: string, params?: Params): void {
  if (__DEV__ && !ready) {
    console.log('[аналитика]', event, params ?? '');
    return;
  }

  if (!ready || !metrica) return;

  try {
    metrica.reportEvent(event, params ? clean(params) : undefined);
  } catch {
    // Аналитика никогда не должна ломать сценарий гостя
  }
}

/** Экран, на который зашёл гость: из этого собирается воронка. */
export function trackScreen(name: string): void {
  track('screen', { name });
}

/** Ошибка, которую поймали сами: попадёт в тот же кабинет, что и падения. */
export function trackError(message: string, error?: unknown): void {
  if (__DEV__) console.warn('[ошибка]', message, error);
  if (!ready || !metrica) return;

  try {
    metrica.reportError(message, error);
  } catch {
    // см. выше
  }
}

/**
 * Кто это. Отправляем идентификатор гостя, а не телефон: по нему видно
 * повторные заказы, но персональных данных в аналитике не появляется.
 */
export function identify(guestId: string | null): void {
  if (!ready || !metrica || !guestId) return;

  try {
    metrica.setUserProfileID(guestId);
  } catch {
    // см. выше
  }
}

function clean(params: Params): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};

  for (const [name, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) result[name] = value;
  }

  return result;
}
