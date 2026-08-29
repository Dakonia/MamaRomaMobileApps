import { apiUrl, tenant } from '@/lib/tenant';

import type { components } from './schema';

export type City = components['schemas']['CityRead'];
export type Restaurant = components['schemas']['RestaurantRead'];
export type Menu = components['schemas']['MenuRead'];
export type MenuCategory = components['schemas']['MenuCategoryRead'];
export type Dish = components['schemas']['DishRead'];
export type DishExtra = components['schemas']['DishExtraRead'];
export type Session = components['schemas']['SessionRead'];
export type SignupRequired = components['schemas']['SignupRequired'];
export type SignupRequest = components['schemas']['SignupRequest'];
export type Profile = components['schemas']['ProfileRead'];
export type Guest = components['schemas']['GuestRead'];
export type Loyalty = components['schemas']['LoyaltyRead'];
export type CodeRequestResult = components['schemas']['CodeRequestResult'];
export type Order = components['schemas']['OrderRead'];
export type OrderCreate = components['schemas']['OrderCreate'];
export type CheckoutLimits = components['schemas']['CheckoutLimits'];
export type Reservation = components['schemas']['ReservationRead'];
export type ReservationCreate = components['schemas']['ReservationCreate'];
export type Slot = components['schemas']['SlotRead'];
export type Address = components['schemas']['AddressRead'];
export type CheckoutPreview = components['schemas']['CheckoutPreview'];
export type CheckoutPreviewRequest = components['schemas']['CheckoutPreviewRequest'];
export type AddressCreate = components['schemas']['AddressCreate'];
export type AddressUpdate = components['schemas']['AddressUpdate'];
export type GuestUpdate = components['schemas']['GuestUpdate'];
export type Promotion = components['schemas']['PromotionRead'];
export type DeliveryResolve = components['schemas']['DeliveryResolve'];
export type DeliveryZone = components['schemas']['DeliveryZoneRead'];
export type GuestSummary = components['schemas']['GuestSummary'];
export type Message = components['schemas']['MessageRead'];
export type FavouriteDish = components['schemas']['FavouriteDish'];

export type AddressSuggestion = components['schemas']['AddressSuggestion'];

let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

type TokenListener = (tokens: { access: string; refresh: string } | null) => void;
let onTokensChanged: TokenListener = () => {};

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function setTokens(access: string | null, refresh: string | null) {
  accessToken = access;
  refreshToken = refresh;
}

/** Хранилище подписывается сюда, чтобы класть обновлённую пару в secure-store. */
export function onTokens(listener: TokenListener) {
  onTokensChanged = listener;
}

/**
 * Доступ живёт полчаса, refresh — два месяца. Меняем пару молча, чтобы гость
 * не видел экран входа, пока не разлогинится сам. Параллельные запросы ждут
 * один и тот же обмен, иначе сервер отзовёт свежий токен как повторно использованный.
 */
async function refreshTokens(): Promise<boolean> {
  if (!refreshToken) return false;

  refreshing ??= (async () => {
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenant.id },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!response.ok) {
        setTokens(null, null);
        onTokensChanged(null);
        return false;
      }

      const session = (await response.json()) as Session;
      setTokens(session.access_token, session.refresh_token);
      onTokensChanged({ access: session.access_token, refresh: session.refresh_token });
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        // Тенант заголовком: сервер по нему решает, чьи данные отдавать
        'X-Tenant-Id': tenant.id,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет');
  }

  if (response.status === 401 && retry && refreshToken) {
    const renewed = await refreshTokens();
    if (renewed) {
      return request<T>(path, init, false);
    }
  }

  if (!response.ok) {
    let message = 'Что-то пошло не так. Попробуйте ещё раз';
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') {
        message = body.detail;
      } else if (Array.isArray(body.detail)) {
        // 422 от проверки схемы приходит списком — берём первую понятную строку,
        // иначе на экране оставался бы общий текст «что-то пошло не так»
        const first = body.detail.find(
          (row): row is { msg?: string; loc?: unknown[] } =>
            typeof row === 'object' && row !== null,
        );
        const where = Array.isArray(first?.loc) ? String(first.loc.at(-1) ?? '') : '';
        if (first?.msg) message = where ? `${first.msg} (${where})` : first.msg;
      }
    } catch {
      // тело не JSON — оставляем общий текст
    }
    throw new ApiError(response.status, message);
  }

  // 204 приходит без тела — например, при удалении адреса
  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function query(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return entries.length > 0 ? `?${new URLSearchParams(entries).toString()}` : '';
}

export const api = {
  cities: () => request<City[]>('/api/v1/cities'),

  restaurants: (cityId?: string) =>
    request<Restaurant[]>(`/api/v1/restaurants${query({ city_id: cityId })}`),

  menu: (restaurantId?: string) =>
    request<Menu>(`/api/v1/menu${query({ restaurant_id: restaurantId })}`),

  popular: (restaurantId?: string) =>
    request<Dish[]>(`/api/v1/menu/popular${query({ restaurant_id: restaurantId })}`),

  related: (dishId: string, restaurantId?: string) =>
    request<Dish[]>(
      `/api/v1/menu/related${query({ dish_id: dishId, restaurant_id: restaurantId })}`,
    ),

  requestCode: (phone: string) =>
    request<CodeRequestResult>('/api/v1/auth/request-code', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),

  // Знакомый номер даёт сессию, незнакомый — билет на регистрацию
  verifyCode: (phone: string, code: string) =>
    request<Session | SignupRequired>('/api/v1/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ phone, code }),
    }),

  signup: (payload: SignupRequest) =>
    request<Session>('/api/v1/auth/signup', { method: 'POST', body: JSON.stringify(payload) }),

  me: () => request<Profile>('/api/v1/auth/me'),

  checkoutLimits: (subtotalKopecks: number) =>
    request<CheckoutLimits>(
      `/api/v1/orders/limits${query({ subtotal_kopecks: String(subtotalKopecks) })}`,
    ),

  createOrder: (payload: OrderCreate) =>
    request<Order>('/api/v1/orders', { method: 'POST', body: JSON.stringify(payload) }),

  orders: () => request<Order[]>('/api/v1/orders'),

  order: (id: string) => request<Order>(`/api/v1/orders/${id}`),

  slots: (restaurantId: string, date: string) =>
    request<Slot[]>(`/api/v1/reservations/slots${query({ restaurant_id: restaurantId, date })}`),

  createReservation: (payload: ReservationCreate) =>
    request<Reservation>('/api/v1/reservations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  reservations: () => request<Reservation[]>('/api/v1/reservations'),

  cancelReservation: (id: string) =>
    request<Reservation>(`/api/v1/reservations/${id}/cancel`, { method: 'POST' }),

  updateMe: (payload: GuestUpdate) =>
    request<Guest>('/api/v1/me', { method: 'PATCH', body: JSON.stringify(payload) }),

  summary: () => request<GuestSummary>('/api/v1/me/summary'),

  addresses: () => request<Address[]>('/api/v1/addresses'),

  // Счёт по корзине считает сервер: цены, зона, минимум и баллы — одни правила
  // и для этого экрана, и для самого заказа
  checkoutPreview: (payload: CheckoutPreviewRequest) =>
    request<CheckoutPreview>('/api/v1/orders/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  suggestAddresses: (text: string, cityId?: string) =>
    request<AddressSuggestion[]>(
      `/api/v1/addresses/suggest${query({ query: text, city_id: cityId })}`,
    ),

  // Кто везёт на эти координаты и на каких условиях
  resolveDelivery: (latitude: number, longitude: number, cityId?: string) =>
    request<DeliveryResolve>(
      `/api/v1/delivery/resolve${query({
        latitude: String(latitude),
        longitude: String(longitude),
        city_id: cityId,
      })}`,
    ),

  // Контуры зон для карты: гость видит, куда мы возим, ещё до выбора адреса
  deliveryZones: (cityId?: string) =>
    request<DeliveryZone[]>(`/api/v1/delivery/zones${query({ city_id: cityId })}`),

  locateAddress: (latitude: number, longitude: number) =>
    request<AddressSuggestion | null>(
      `/api/v1/addresses/locate${query({
        latitude: String(latitude),
        longitude: String(longitude),
      })}`,
    ),

  addAddress: (payload: AddressCreate) =>
    request<Address>('/api/v1/addresses', { method: 'POST', body: JSON.stringify(payload) }),

  // inMenu=true — карусель меню, там только акции доставки
  promotions: (restaurantId?: string, inMenu?: boolean) =>
    request<Promotion[]>(
      `/api/v1/promotions${query({
        restaurant_id: restaurantId,
        in_menu: inMenu === undefined ? undefined : String(inMenu),
      })}`,
    ),

  updateAddress: (id: string, payload: AddressUpdate) =>
    request<Address>(`/api/v1/addresses/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  deleteAddress: async (id: string) => {
    await request<unknown>(`/api/v1/addresses/${id}`, { method: 'DELETE' });
  },

  /** Оценка доставленного заказа: ставится один раз, видит её только сеть. */
  rateOrder: (orderId: string, payload: { rating: number; tags: string[]; comment: string | null }) =>
    request<unknown>(`/api/v1/orders/${orderId}/feedback`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Лента сообщений: те же рассылки, но внутри приложения. */
  messages: () => request<Message[]>('/api/v1/messages'),

  readMessage: async (id: string) => {
    await request<unknown>(`/api/v1/messages/${id}/read`, { method: 'POST' });
  },

  /**
   * След корзины на сервере: нужен, чтобы напомнить о ней, если гость ушёл.
   * Состав не передаём — только сколько блюд и на какую сумму.
   */
  rememberCart: async (positions: number, totalKopecks: number) => {
    await request<unknown>('/api/v1/cart', {
      method: 'PUT',
      body: JSON.stringify({ positions, total_kopecks: totalKopecks }),
    });
  },

  /** Устройство для пушей: токен обновляется при каждом запуске. */
  registerDevice: async (payload: {
    push_token: string;
    platform: 'ios' | 'android';
    app_version: string | null;
  }) => {
    await request<unknown>('/api/v1/devices', { method: 'PUT', body: JSON.stringify(payload) });
  },

  forgetDevice: async (token: string) => {
    await request<unknown>(`/api/v1/devices/${encodeURIComponent(token)}`, { method: 'DELETE' });
  },

  /** Удаление аккаунта: личные данные стираются, войти под ним больше нельзя. */
  deleteAccount: async () => {
    await request<unknown>('/api/v1/me', { method: 'DELETE' });
  },
};

/** В базе ссылки на фото относительные — дописываем адрес сервера. */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith('http') ? path : `${apiUrl}${path}`;
}
