import Constants from 'expo-constants';

import type {
  ECommerceCartItem,
  ECommerceEvent,
  Revenue,
} from '@appmetrica/react-native-analytics';

type Params = Record<string, string | number | boolean | null | undefined>;

type Module = typeof import('@appmetrica/react-native-analytics');
type Metrica = Module['default'];
type ECommerceApi = Module['ECommerce'];
type ProfileApi = Module['Attributes'];
type ProfileClass = Module['UserProfile'];

/** Позиция заказа в виде, который понимает электронная коммерция AppMetrica. */
export type SoldItem = {
  sku: string;
  name: string;
  priceKopecks: number;
  quantity: number;
};

const key = (Constants.expoConfig?.extra as { appMetricaKey?: string } | undefined)?.appMetricaKey;

const CURRENCY = 'RUB';

/**
 * Сегменты пути, за которыми идёт идентификатор. Без подмены каждый заказ и
 * каждое блюдо становятся отдельной строкой отчёта, и по экранам уже не
 * построить ни воронку, ни рейтинг.
 */
const DYNAMIC = new Set(['dish', 'order', 'promo', 'reservation']);

/**
 * Нативного модуля нет в Expo Go — там аналитика молча выключается, чтобы
 * разработка не падала. В собранном приложении он есть всегда.
 */
function load(): Module | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@appmetrica/react-native-analytics') as Module;
  } catch {
    return null;
  }
}

let metrica: Metrica | null = null;
let ecommerce: ECommerceApi | null = null;
let attributes: ProfileApi | null = null;
let Profile: ProfileClass | null = null;
let ready = false;

/** Включаем сбор при запуске: без ключа и вне сборки просто ничего не делаем. */
export function startAnalytics(): void {
  if (ready || !key) return;

  const module = load();
  if (!module) return;

  metrica = module.default;
  ecommerce = module.ECommerce;
  attributes = module.Attributes;
  Profile = module.UserProfile;

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
export function trackScreen(path: string): void {
  track('screen', { name: screenName(path) });
}

/**
 * Ошибка, которую поймали сами: попадёт в тот же кабинет, что и падения.
 * Первым аргументом идёт группа — по ней ошибки собираются в один список,
 * а не рассыпаются на сотню одиночных записей.
 */
export function trackError(group: string, error?: unknown): void {
  if (__DEV__) console.warn('[ошибка]', group, error);
  if (!ready || !metrica) return;

  try {
    if (error instanceof Error) {
      metrica.reportError(group, error.message, error);
      return;
    }

    metrica.reportError(group, error === undefined ? undefined : String(error));
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

/**
 * Свойства гостя для сегментов: по ним в кабинете фильтруются любые отчёты —
 * например воронка заказа отдельно для уровня Maestro.
 */
export function describe(profile: { tier?: string | null; pushEnabled?: boolean }): void {
  if (!ready || !metrica || !attributes || !Profile) return;

  try {
    const update = new Profile();

    if (profile.tier) update.apply(attributes.customString('tier').withValue(profile.tier));

    if (profile.pushEnabled !== undefined) {
      update.apply(attributes.notificationsEnabled().withValue(profile.pushEnabled));
    }

    metrica.reportUserProfile(update);
  } catch {
    // см. выше
  }
}

/**
 * Деньги заказа. Отдельный вызов, а не параметр события: только так сумма
 * попадает в отчёт «Доход» — со средним чеком, выручкой по дням и LTV гостя.
 */
export function trackRevenue(orderId: string, totalKopecks: number, payload?: Params): void {
  if (__DEV__ && !ready) {
    console.log('[выручка]', totalKopecks / 100, payload ?? '');
    return;
  }

  if (!ready || !metrica) return;

  const revenue: Revenue = {
    price: totalKopecks / 100,
    currency: CURRENCY,
    quantity: 1,
    productID: orderId,
    payload: payload ? JSON.stringify(clean(payload)) : undefined,
  };

  try {
    metrica.reportRevenue(revenue);
  } catch {
    // см. выше
  }
}

/** Гость открыл карточку блюда — первый шаг товарной воронки. */
export function trackProductView(item: SoldItem, category?: string | null): void {
  send((api) => api.showProductDetailsEvent(product(item, category)));
}

/** Блюдо положили в корзину. */
export function trackCartAdd(item: SoldItem, category?: string | null): void {
  send((api) => api.addCartItemEvent(line(item, category)));
}

/** Блюдо убрали из корзины: разница с добавлениями показывает сомнения гостя. */
export function trackCartRemove(item: SoldItem, category?: string | null): void {
  send((api) => api.removeCartItemEvent(line(item, category)));
}

/** Гость нажал «Оформить»: корзина уходит в кассу. */
export function trackCheckout(orderId: string, items: SoldItem[]): void {
  send((api) => api.beginCheckoutEvent({ orderId, products: items.map((item) => line(item)) }));
}

/** Заказ принят: закрывает товарную воронку и наполняет рейтинг блюд. */
export function trackPurchase(orderId: string, items: SoldItem[], payload?: Params): void {
  send((api) =>
    api.purchaseEvent({
      orderId,
      products: items.map((item) => line(item)),
      payload: payload ? asStrings(payload) : undefined,
    }),
  );
}

function send(build: (api: ECommerceApi) => ECommerceEvent): void {
  if (!ready || !metrica || !ecommerce) return;

  try {
    metrica.reportECommerce(build(ecommerce));
  } catch {
    // см. выше
  }
}

function product(item: SoldItem, category?: string | null) {
  return {
    sku: item.sku,
    name: item.name,
    actualPrice: { amount: { amount: rubles(item.priceKopecks), unit: CURRENCY } },
    categoriesPath: category ? [category] : undefined,
  };
}

function line(item: SoldItem, category?: string | null): ECommerceCartItem {
  return {
    product: product(item, category),
    price: { amount: { amount: rubles(item.priceKopecks), unit: CURRENCY } },
    quantity: item.quantity,
  };
}

/** Копейки в строку с двумя знаками: дробные суммы не теряются на округлении. */
function rubles(kopecks: number): string {
  return (kopecks / 100).toFixed(2);
}

/** Путь экрана без идентификаторов: /dish/8f3c… превращается в /dish/:id. */
function screenName(path: string): string {
  const parts = path.split('/');

  return (
    parts
      .map((part, at) => (at > 0 && DYNAMIC.has(parts[at - 1]) ? ':id' : part))
      .join('/') || '/'
  );
}

function clean(params: Params): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};

  for (const [name, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) result[name] = value;
  }

  return result;
}

function asStrings(params: Params): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [name, value] of Object.entries(clean(params))) {
    result[name] = String(value);
  }

  return result;
}
