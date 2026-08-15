import { apiUrl, tenant } from '@/lib/tenant';

import type { components } from './schema';

export type City = components['schemas']['CityRead'];
export type Restaurant = components['schemas']['RestaurantRead'];
export type Menu = components['schemas']['MenuRead'];
export type MenuCategory = components['schemas']['MenuCategoryRead'];
export type Dish = components['schemas']['DishRead'];
export type Session = components['schemas']['SessionRead'];
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
export type AddressCreate = components['schemas']['AddressCreate'];
export type GuestUpdate = components['schemas']['GuestUpdate'];

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

  if (!response.ok) {
    let message = 'Что-то пошло не так. Попробуйте ещё раз';
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') {
        message = body.detail;
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

  requestCode: (phone: string) =>
    request<CodeRequestResult>('/api/v1/auth/request-code', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),

  verifyCode: (phone: string, code: string) =>
    request<Session>('/api/v1/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ phone, code }),
    }),

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

  addresses: () => request<Address[]>('/api/v1/addresses'),

  addAddress: (payload: AddressCreate) =>
    request<Address>('/api/v1/addresses', { method: 'POST', body: JSON.stringify(payload) }),

  deleteAddress: async (id: string) => {
    await request<unknown>(`/api/v1/addresses/${id}`, { method: 'DELETE' });
  },
};
