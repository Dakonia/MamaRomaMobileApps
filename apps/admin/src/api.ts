import { getTenant } from "@mr/tenants";

const TOKEN_KEY = "mr.admin.token";
/**
 * Адрес API. На сервере админка лежит в папке рядом с самим API
 * (/mamaroma/admin/ и /mamaroma/api/), поэтому считаем его от собственного
 * адреса страницы: сборка не знает, в какую папку её положат, и знать не должна.
 * В разработке ходим на локальный бэкенд.
 */
const API_URL =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV
    ? "http://localhost:8000"
    : new URL("..", window.location.href).href.replace(/\/$/, ""));

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
  show_in_popular: boolean;
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
  proteins_g: number | null;
  fats_g: number | null;
  carbs_g: number | null;
  is_spicy: boolean;
  is_vegetarian: boolean;
  is_new: boolean;
  is_active: boolean;
  sort_order: number;
};

export type DishDraft = {
  category_id: string;
  name: string;
  image_url: string | null;
  price_kopecks: number;
  description: string | null;
  composition: string | null;
  weight_grams: number | null;
  volume_ml: number | null;
  calories: number | null;
  proteins_g: number | null;
  fats_g: number | null;
  carbs_g: number | null;
  is_spicy: boolean;
  is_vegetarian: boolean;
  is_new: boolean;
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
export type Promotion = {
  id: string;
  title: string;
  description: string | null;
  label: string | null;
  image_url: string | null;
  restaurant_ids: string[];
  restaurant_names: string[];
  source_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  is_active: boolean;
  show_in_menu: boolean;
};

export type PromotionDraft = {
  title: string;
  description: string | null;
  label: string | null;
  image_url: string | null;
  restaurant_ids: string[];
  ends_at: string | null;
  sort_order: number;
  is_active: boolean;
  show_in_menu: boolean;
};

export type Restaurant = { id: string; name: string };

export type Bridge = {
  restaurant_id: string;
  restaurant_name: string;
  is_registered: boolean;
  is_active: boolean;
  last_seen_at: string | null;
  plugin_version: string | null;
  terminal_name: string | null;
  linked_dishes: number;
  linked_extras: number;
  products: number;
  pending_orders: number;
  failed_orders: number;
};

export type IikoProduct = {
  product_id: string;
  name: string;
  code: string | null;
  group_name: string | null;
  /** Dish — блюдо, Goods — товар, Modifier — добавка. */
  product_type: string | null;
  is_active: boolean;
  has_sizes: boolean;
};

export type IikoLink = {
  kind: "dish" | "extra";
  id: string;
  name: string;
  group: string | null;
  product_id: string | null;
  product_name: string | null;
  size_id: string | null;
  modifier_group_id: string | null;
  suggestions: IikoProduct[];
};

export type Handoff = {
  order_id: string;
  order_number: string;
  restaurant_name: string;
  status: string;
  attempts: number;
  error: string | null;
  missing_products: string[];
  iiko_order_number: string | null;
  created_at: string;
  total_kopecks: number;
};

export type Feedback = {
  id: string;
  order_id: string;
  order_number: string;
  restaurant_name: string;
  guest_name: string | null;
  guest_phone: string;
  rating: number;
  tags: string[];
  comment: string | null;
  created_at: string;
};

export type FeedbackSummary = {
  average: number;
  total: number;
  by_rating: Record<string, number>;
};

export type DishExtra = {
  id: string;
  name: string;
  price_kopecks: number;
  is_active: boolean;
  dishes_count: number;
  category_ids: string[];
};

export type PromoCode = {
  id: string;
  code: string;
  title: string;
  kind: "percent" | "fixed" | "free_delivery";
  value: number;
  max_discount_kopecks: number | null;
  min_order_kopecks: number;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
  per_guest_limit: number;
  used_count: number;
  is_active: boolean;
};

export type PromoCodeDraft = Omit<PromoCode, "id" | "used_count">;

export type SyncChange = {
  id: string;
  action: "create" | "update" | "delete";
  title: string;
  summary: string;
  group: string | null;
  applied: boolean;
};

export type SyncRun = {
  id: string;
  kind: "menu" | "restaurants" | "promos";
  title: string;
  status: "checking" | "ready" | "applying" | "done" | "failed";
  started_at: string;
  finished_at: string | null;
  applied_at: string | null;
  unchanged: number;
  created: number;
  updated: number;
  removed: number;
  message: string | null;
  changes: SyncChange[];
};

export type City = { id: string; name: string };

export type AdminRestaurant = {
  id: string;
  city_id: string;
  name: string;
  address: string;
  metro: string | null;
  phone: string | null;
  latitude: number;
  longitude: number;
  opens_at: string;
  closes_at: string;
  delivery_opens_at: string | null;
  delivery_closes_at: string | null;
  has_delivery: boolean;
  has_pickup: boolean;
  has_dine_in: boolean;
  delivery_price_kopecks: number;
  delivery_min_order_kopecks: number;
  free_delivery_from_kopecks: number | null;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
  is_paused: boolean;
  pause_reason: string | null;
  /** Принимать заказы, пока ресторан закрыт: гость выберет время на потом. */
  preorder_enabled: boolean;
};

export type RestaurantDraft = Omit<AdminRestaurant, "id">;

export type NotificationRule = {
  id?: string | null;
  restaurant_id?: string | null;
  event: string;
  is_enabled: boolean;
  title: string;
  body: string;
};

export type QuietHours = {
  quiet_from: string;
  quiet_to: string;
  weekly_limit: number;
};

/** Кому уходит рассылка: пустые поля означают «всем подряд». */
export type Audience = {
  cities?: string[];
  restaurants?: string[];
  ordered_within_days?: number;
  min_orders?: number;
  booked?: boolean;
  tiers?: string[];
};

export type CampaignTarget = { screen?: string; id?: string };

/** Разбор охвата: сколько получат и почему остальные — нет. */
export type Reach = {
  count: number;
  guests: number;
  with_push: number;
  agreed: number;
};

export type Campaign = {
  id: string;
  name: string;
  title: string;
  body: string;
  image_url: string | null;
  kind: string;
  status: string;
  target: CampaignTarget;
  audience: Audience;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  planned_count: number;
  sent_count: number;
  opened_count: number;
  error: string | null;
};

export type CampaignWrite = {
  name: string;
  title: string;
  body: string;
  image_url: string | null;
  target: CampaignTarget;
  audience: Audience;
  scheduled_at: string | null;
};

export type Automation = {
  id?: string;
  trigger: string;
  is_enabled: boolean;
  title: string;
  body: string;
  target: CampaignTarget;
  params: Record<string, number>;
  last_run_at?: string | null;
  sent_count?: number;
};

export type Zone = {
  id: string;
  city_id: string;
  restaurant_id: string;
  restaurant_name: string;
  name: string;
  color: string;
  outline: [number, number][];
  delivery_price_kopecks: number;
  min_order_kopecks: number;
  min_order_weekend_kopecks: number | null;
  free_delivery_from_kopecks: number | null;
  delivery_minutes: number | null;
  sort_order: number;
  is_active: boolean;
};

export type RestaurantDish = {
  dish_id: string;
  name: string;
  category_name: string;
  base_price_kopecks: number;
  price_kopecks: number;
  is_available: boolean;
  in_stop_list: boolean;
};

export type Guest = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  birthday: string | null;
  gender: "male" | "female" | null;
  is_blocked: boolean;
  created_at: string;
  last_seen_at: string | null;
  orders_count: number;
  spent_kopecks: number;
  tier_title: string;
  points_balance: number;
};

export type GuestAddress = {
  id: string;
  title: string | null;
  full_text: string;
  locality: string | null;
  metro: string | null;
  comment: string | null;
  is_default: boolean;
};

export type GuestOrder = {
  id: string;
  number: string;
  created_at: string;
  type: string;
  status: string;
  restaurant_name: string;
  address_text: string | null;
  total_kopecks: number;
  items: string[];
};

export type GuestReservation = {
  id: string;
  reserved_at: string;
  guests_count: number;
  status: string;
  restaurant_name: string;
};

export type GuestPoints = {
  created_at: string;
  operation: string;
  points: number;
  comment: string | null;
};

export type GuestCard = {
  guest: Guest;
  addresses: GuestAddress[];
  orders: GuestOrder[];
  reservations: GuestReservation[];
  points: GuestPoints[];
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

  uploadImage: async (file: File, folder = "dishes"): Promise<string> => {
    const body = new FormData();
    body.append("file", file);

    // Content-Type тут не ставим: браузер сам добавит границу multipart
    const response = await fetch(`${API_URL}/api/v1/admin/uploads?folder=${folder}`, {
      method: "POST",
      headers: {
        "X-Tenant-Id": tenant.id,
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body,
    });

    const payload = (await response.json()) as { url?: string; detail?: string };
    if (!response.ok) {
      throw new ApiError(response.status, payload.detail ?? "Не удалось загрузить файл");
    }
    return payload.url ?? "";
  },

  stopList: () => request<StopEntry[]>("/admin/stop-list"),
  addStop: (restaurantId: string, dishId: string) =>
    request<{ id: string }>("/admin/stop-list", {
      method: "POST",
      body: JSON.stringify({ restaurant_id: restaurantId, dish_id: dishId, until: null }),
    }),
  removeStop: (id: string) =>
    request<void>(`/admin/stop-list/${id}`, { method: "DELETE" }),

  orders: () => request<Order[]>("/admin/orders"),
  setOrderStatus: (id: string, status: string) =>
    request<Order>(`/admin/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),

  restaurants: () => request<Restaurant[]>("/restaurants"),
  cities: () => request<City[]>("/cities"),

  adminRestaurants: () => request<AdminRestaurant[]>("/admin/restaurants"),
  createRestaurant: (payload: RestaurantDraft) =>
    request<AdminRestaurant>("/admin/restaurants", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateRestaurant: (id: string, patch: Partial<RestaurantDraft>) =>
    request<AdminRestaurant>(`/admin/restaurants/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteRestaurant: (id: string) =>
    request<void>(`/admin/restaurants/${id}`, { method: "DELETE" }),

  zones: () => request<Zone[]>("/admin/zones"),
  updateZone: (
    id: string,
    patch: Partial<{
      restaurant_id: string;
      name: string;
      color: string;
      outline: [number, number][];
      delivery_price_kopecks: number;
      min_order_kopecks: number;
      min_order_weekend_kopecks: number | null;
      free_delivery_from_kopecks: number | null;
      delivery_minutes: number | null;
      sort_order: number;
      is_active: boolean;
    }>,
  ) => request<Zone>(`/admin/zones/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteZone: (id: string) => request<void>(`/admin/zones/${id}`, { method: "DELETE" }),

  // --- Уведомления ---

  notificationRules: () => request<NotificationRule[]>("/admin/notifications/rules"),

  saveNotificationRule: (payload: NotificationRule) =>
    request<NotificationRule>("/admin/notifications/rules", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  notificationHours: () => request<QuietHours>("/admin/notifications/hours"),

  saveNotificationHours: (payload: QuietHours) =>
    request<QuietHours>("/admin/notifications/hours", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  campaigns: () => request<Campaign[]>("/admin/campaigns"),

  createCampaign: (payload: CampaignWrite) =>
    request<Campaign>("/admin/campaigns", { method: "POST", body: JSON.stringify(payload) }),

  updateCampaign: (id: string, payload: CampaignWrite) =>
    request<Campaign>(`/admin/campaigns/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  campaignAudience: (audience: Audience) =>
    request<Reach>("/admin/campaigns/audience", {
      method: "POST",
      body: JSON.stringify({ audience }),
    }),

  deleteCampaign: (id: string) =>
    request<void>(`/admin/campaigns/${id}`, { method: "DELETE" }),

  copyCampaign: (id: string) =>
    request<Campaign>(`/admin/campaigns/${id}/copy`, { method: "POST" }),

  sendCampaign: (id: string, force = false) =>
    request<Campaign>(`/admin/campaigns/${id}/send?force=${force}`, { method: "POST" }),

  // --- Касса iiko ---

  bridges: () => request<Bridge[]>("/admin/iiko/bridges"),

  bridgeSecret: (restaurantId: string) =>
    request<{ restaurant_id: string; secret: string }>(
      `/admin/iiko/bridges/${restaurantId}/secret`,
      { method: "POST" },
    ),

  toggleBridge: (restaurantId: string, isActive: boolean) =>
    request<{ is_active: boolean }>(`/admin/iiko/bridges/${restaurantId}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: isActive }),
    }),

  iikoGroups: (restaurantId: string) =>
    request<{ name: string; products: number }[]>(
      `/admin/iiko/groups?restaurant_id=${restaurantId}`,
    ),

  iikoProducts: (restaurantId: string, group?: string) =>
    request<IikoProduct[]>(
      `/admin/iiko/products?restaurant_id=${restaurantId}` +
        (group ? `&group=${encodeURIComponent(group)}` : ""),
    ),

  iikoLinks: (restaurantId: string, groups: string[]) =>
    request<IikoLink[]>(
      `/admin/iiko/links?restaurant_id=${restaurantId}` +
        groups.map((name) => `&groups=${encodeURIComponent(name)}`).join(""),
    ),

  searchIikoProducts: (restaurantId: string, query: string, groups: string[]) =>
    request<IikoProduct[]>(
      `/admin/iiko/search?restaurant_id=${restaurantId}&q=${encodeURIComponent(query)}` +
        groups.map((name) => `&groups=${encodeURIComponent(name)}`).join(""),
    ),

  saveIikoLinks: (
    restaurantId: string,
    links: { kind: string; id: string; product_id: string; size_id?: string; modifier_group_id?: string }[],
  ) =>
    request<{ applied: number }>("/admin/iiko/links", {
      method: "PUT",
      body: JSON.stringify({ restaurant_id: restaurantId, links }),
    }),

  autoMatchIiko: (restaurantId: string, groups: string[]) =>
    request<{ matched: number; skipped: number }>(
      `/admin/iiko/links/auto?restaurant_id=${restaurantId}` +
        groups.map((name) => `&groups=${encodeURIComponent(name)}`).join(""),
      { method: "POST" },
    ),

  iikoQueue: (onlyProblems: boolean) =>
    request<Handoff[]>(`/admin/iiko/queue?only_problems=${onlyProblems}`),

  retryHandoff: (orderId: string) =>
    request<{ applied: number }>(`/admin/iiko/queue/${orderId}/retry`, { method: "POST" }),

  feedback: (params: { restaurant_id?: string; max_rating?: number }) => {
    const query = new URLSearchParams();
    if (params.restaurant_id) query.set("restaurant_id", params.restaurant_id);
    if (params.max_rating) query.set("max_rating", String(params.max_rating));

    return request<Feedback[]>(`/admin/feedback?${query.toString()}`);
  },

  feedbackSummary: (restaurantId?: string) =>
    request<FeedbackSummary>(
      restaurantId ? `/admin/feedback/summary?restaurant_id=${restaurantId}` : "/admin/feedback/summary",
    ),

  automations: () => request<Automation[]>("/admin/automations"),

  saveAutomation: (payload: Automation) =>
    request<Automation>("/admin/automations", { method: "PUT", body: JSON.stringify(payload) }),

  createZone: (payload: {
    city_id: string;
    restaurant_id: string;
    name: string;
    color: string;
    outline: [number, number][];
    delivery_price_kopecks: number;
    min_order_kopecks: number;
    delivery_minutes: number | null;
  }) => request<Zone>("/admin/zones", { method: "POST", body: JSON.stringify(payload) }),

  restaurantMenu: (restaurantId: string) =>
    request<RestaurantDish[]>(`/admin/restaurants/${restaurantId}/menu`),
  setRestaurantDish: (
    restaurantId: string,
    payload: { dish_id: string; price_kopecks: number | null; is_available: boolean },
  ) =>
    request<RestaurantDish>(`/admin/restaurants/${restaurantId}/menu`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  guests: (search: string) =>
    request<Guest[]>(`/admin/guests${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`),
  guestCard: (id: string) => request<GuestCard>(`/admin/guests/${id}`),
  createGuest: (payload: {
    phone: string;
    name: string | null;
    email: string | null;
    birthday: string | null;
    gender: "male" | "female" | null;
  }) => request<Guest>("/admin/guests", { method: "POST", body: JSON.stringify(payload) }),
  updateGuest: (
    id: string,
    patch: Partial<{
      name: string | null;
      email: string | null;
      birthday: string | null;
      gender: "male" | "female" | null;
      is_blocked: boolean;
    }>,
  ) => request<Guest>(`/admin/guests/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteGuest: (id: string) => request<void>(`/admin/guests/${id}`, { method: "DELETE" }),

  promotions: () => request<Promotion[]>("/admin/promotions"),
  createPromotion: (payload: PromotionDraft) =>
    request<Promotion>("/admin/promotions", { method: "POST", body: JSON.stringify(payload) }),
  updatePromotion: (id: string, patch: Partial<PromotionDraft>) =>
    request<Promotion>(`/admin/promotions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deletePromotion: (id: string) =>
    request<void>(`/admin/promotions/${id}`, { method: "DELETE" }),

  extras: () => request<DishExtra[]>("/admin/extras"),
  createExtra: (payload: { name: string; price_kopecks: number; is_active: boolean }) =>
    request<DishExtra>("/admin/extras", { method: "POST", body: JSON.stringify(payload) }),
  updateExtra: (
    id: string,
    patch: Partial<{ name: string; price_kopecks: number; is_active: boolean }>,
  ) => request<DishExtra>(`/admin/extras/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  setExtraCategories: (id: string, categoryIds: string[]) =>
    request<DishExtra>(`/admin/extras/${id}/categories`, {
      method: "PUT",
      body: JSON.stringify({ category_ids: categoryIds }),
    }),
  deleteExtra: (id: string) => request<void>(`/admin/extras/${id}`, { method: "DELETE" }),

  promoCodes: () => request<PromoCode[]>("/admin/promo-codes"),
  createPromoCode: (payload: PromoCodeDraft) =>
    request<PromoCode>("/admin/promo-codes", { method: "POST", body: JSON.stringify(payload) }),
  updatePromoCode: (id: string, patch: Partial<PromoCodeDraft>) =>
    request<PromoCode>(`/admin/promo-codes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deletePromoCode: (id: string) =>
    request<void>(`/admin/promo-codes/${id}`, { method: "DELETE" }),

  syncRuns: () => request<SyncRun[]>("/admin/sync"),
  startSync: (kind: SyncRun["kind"]) =>
    request<SyncRun>(`/admin/sync/${kind}`, { method: "POST" }),
  applySync: (runId: string, changeIds: string[]) =>
    request<SyncRun>(`/admin/sync/${runId}/apply`, {
      method: "POST",
      body: JSON.stringify({ change_ids: changeIds }),
    }),
  dropSyncChange: (runId: string, changeId: string) =>
    request<void>(`/admin/sync/${runId}/changes/${changeId}`, { method: "DELETE" }),

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

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Ссылки на фото хранятся относительными — дописываем адрес сервера. */
export function mediaUrl(path: string | null): string | null {
  if (!path) return null;
  return path.startsWith("http") ? path : `${API_URL}${path}`;
}
