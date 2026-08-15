import { getTenant } from "@mr/tenants";

const TOKEN_KEY = "mr.admin.token";
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export const tenant = getTenant();

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token === null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-Id": tenant.id,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 401) {
    setToken(null);
  }

  if (!response.ok) {
    let message = "Что-то пошло не так";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // тело не JSON
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export type Staff = { id: string; email: string; name: string; role: string };
export type Category = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
  dishes_count: number;
};
export type Dish = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  composition: string | null;
  image_url: string | null;
  price_kopecks: number;
  weight_grams: number | null;
  volume_ml: number | null;
  calories: number | null;
  is_active: boolean;
  sort_order: number;
};

export type DishDraft = {
  category_id: string;
  name: string;
  price_kopecks: number;
  description: string | null;
  composition: string | null;
  weight_grams: number | null;
  calories: number | null;
  sort_order: number;
  is_active: boolean;
};
export type StopEntry = {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  dish_id: string;
  dish_name: string;
  comment: string | null;
};
export type OrderItem = { id: string; name: string; quantity: number; total_kopecks: number };
export type Order = {
  id: string;
  number: string;
  status: string;
  type: string;
  restaurant_name: string;
  address_text: string | null;
  total_kopecks: number;
  created_at: string;
  items: OrderItem[];
};
export type Reservation = {
  id: string;
  status: string;
  restaurant_name: string;
  reserved_at: string;
  guests_count: number;
  contact_name: string | null;
  contact_phone: string;
  comment: string | null;
};

export const api = {
  login: (email: string, password: string) =>
    request<{ access_token: string; staff: Staff }>("/admin/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<Staff>("/admin/me"),

  categories: () => request<Category[]>("/admin/categories"),
  createCategory: (payload: { name: string; slug: string; sort_order: number }) =>
    request<Category>("/admin/categories", { method: "POST", body: JSON.stringify(payload) }),
  updateCategory: (id: string, patch: Partial<Category>) =>
    request<Category>(`/admin/categories/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteCategory: (id: string) =>
    request<void>(`/admin/categories/${id}`, { method: "DELETE" }),
  dishes: () => request<Dish[]>("/admin/dishes"),
  updateDish: (id: string, patch: Partial<Dish>) =>
    request<Dish>(`/admin/dishes/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  createDish: (payload: DishDraft) =>
    request<Dish>("/admin/dishes", { method: "POST", body: JSON.stringify(payload) }),
  deleteDish: (id: string) => request<void>(`/admin/dishes/${id}`, { method: "DELETE" }),

  stopList: () => request<StopEntry[]>("/admin/stop-list"),
  removeStop: (id: string) =>
    request<void>(`/admin/stop-list/${id}`, { method: "DELETE" }),

  orders: () => request<Order[]>("/admin/orders"),
  setOrderStatus: (id: string, status: string) =>
    request<Order>(`/admin/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),

  reservations: () => request<Reservation[]>("/admin/reservations"),
  setReservationStatus: (id: string, status: string) =>
    request<Reservation>(`/admin/reservations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
};

export function formatPrice(kopecks: number): string {
  return `${String(Math.round(kopecks / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
