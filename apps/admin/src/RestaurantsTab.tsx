import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock3,
  ImageUp,
  MapPin,
  PauseCircle,
  Pencil,
  Phone,
  PlayCircle,
  Plus,
  Search,
  Trash2,
  Truck,
  Utensils,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  formatPrice,
  mediaUrl,
  type AdminRestaurant,
  type City,
  type RestaurantDraft,
} from "./api";
import { RestaurantMenu } from "./RestaurantMenu";
import { ConfirmDialog } from "./components/patterns/ConfirmDialog";
import { Badge, Button, IconButton, Section, Select } from "./ui";

type StatusFilter = "all" | "taking" | "paused" | "disabled";

const emptyDraft = (cityId: string): RestaurantDraft => ({
  city_id: cityId,
  name: "",
  address: "",
  metro: null,
  phone: null,
  latitude: 59.9386,
  longitude: 30.3141,
  opens_at: "11:00",
  closes_at: "23:00",
  delivery_opens_at: "11:00",
  delivery_closes_at: "22:30",
  has_delivery: true,
  has_pickup: true,
  has_dine_in: true,
  delivery_price_kopecks: 0,
  delivery_min_order_kopecks: 0,
  free_delivery_from_kopecks: null,
  description: null,
  image_url: null,
  is_active: true,
  is_paused: false,
  pause_reason: null,
  preorder_enabled: false,
});

function toDraft(restaurant: AdminRestaurant): RestaurantDraft {
  const { id: _id, ...rest } = restaurant;
  return {
    ...rest,
    closes_at: rest.closes_at.slice(0, 5),
    delivery_closes_at: rest.delivery_closes_at?.slice(0, 5) ?? null,
    delivery_opens_at: rest.delivery_opens_at?.slice(0, 5) ?? null,
    opens_at: rest.opens_at.slice(0, 5),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function rubToKopecks(value: string): number {
  return Number(value.replace(/\D/g, "") || 0) * 100;
}

function statusBadge(restaurant: AdminRestaurant | RestaurantDraft) {
  if (!restaurant.is_active) return <Badge text="отключён" tone="muted" />;
  if (restaurant.is_paused) return <Badge text="на паузе" tone="warn" />;
  return <Badge text="принимает заказы" tone="ok" />;
}

function cityName(cityById: Map<string, string>, cityId: string): string {
  return cityById.get(cityId) ?? "Город не выбран";
}

function timeRange(from: string | null, to: string | null): string {
  if (!from || !to) return "не задано";
  return `${from.slice(0, 5)}-${to.slice(0, 5)}`;
}

function Metric({ label, note, value }: { label: string; note: string; value: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-note">{note}</div>
    </div>
  );
}

function ServiceTile({
  active,
  icon,
  label,
  value,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="service-tile" data-active={active}>
      <div className="service-icon">{icon}</div>
      <div>
        <div className="row-main">{label}</div>
        <div className="row-sub">{value}</div>
      </div>
    </div>
  );
}

function PauseDialog({
  busy,
  onCancel,
  onConfirm,
  restaurant,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  restaurant: AdminRestaurant;
}) {
  const [reason, setReason] = useState(restaurant.pause_reason ?? "Технические работы");

  return (
    <>
      <div className="command-overlay" onClick={onCancel} />
      <section aria-modal="true" className="confirm-dialog" role="dialog">
        <div className="confirm-body">
          <PauseCircle color="var(--warn)" size={22} aria-hidden />
          <h2 className="confirm-title">Поставить на паузу</h2>
          <p className="confirm-copy">
            {restaurant.name} перестанет принимать заказы. Причина будет видна гостю в приложении.
          </p>
          <label className="field">
            <span className="field-label">Причина</span>
            <textarea
              className="textarea"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </div>
        <div className="drawer-foot">
          <Button disabled={busy} variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
          <Button disabled={busy || reason.trim().length < 2} onClick={() => onConfirm(reason.trim())}>
            {busy ? "Ставим..." : "Поставить на паузу"}
          </Button>
        </div>
      </section>
    </>
  );
}

function RestaurantEditor({
  cities,
  initial,
  mode,
  onCancel,
  onSubmit,
  pending,
}: {
  cities: City[];
  initial: RestaurantDraft;
  mode: "create" | "edit";
  onCancel: () => void;
  onSubmit: (draft: RestaurantDraft) => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const set = <K extends keyof RestaurantDraft>(key: K, value: RestaurantDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const url = await api.uploadImage(file, "restaurants");
      set("image_url", url);
      toast.success("Фото загружено");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const canSave = draft.name.trim().length >= 2 && draft.address.trim().length >= 4 && draft.city_id.length > 0;

  return (
    <article className="split-detail">
      <div className="section-head">
        <div>
          <h2 className="section-title">{mode === "create" ? "Новый ресторан" : draft.name}</h2>
          <p className="section-copy">
            Карточка точки, режимы работы, доставка и видимость для гостей.
          </p>
        </div>
        {statusBadge(draft)}
      </div>

      <div className="restaurant-hero">
        <div className="restaurant-photo">
          {draft.image_url ? (
            <img src={mediaUrl(draft.image_url) ?? ""} alt="" />
          ) : (
            <div className="restaurant-photo-placeholder">
              <Utensils size={24} aria-hidden />
            </div>
          )}
        </div>
        <div className="drawer-section">
          <h3 className="drawer-section-title">Фотография</h3>
          <p className="section-copy">
            Изображение точки используется в клиентском приложении и должно быстро объяснять место.
          </p>
          <label className="upload-button">
            <ImageUp size={15} aria-hidden />
            {uploading ? "Загружаем..." : "Загрузить фото"}
            <input
              accept="image/*"
              disabled={uploading}
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
        </div>
      </div>

      <section className="drawer-section">
        <h3 className="drawer-section-title">Основное</h3>
        <div className="drawer-form-grid">
          <label className="field">
            <span className="field-label">Название</span>
            <input
              className="input"
              value={draft.name}
              onChange={(event) => set("name", event.target.value)}
            />
          </label>

          <div className="field">
            <span className="field-label">Город</span>
            <Select
              value={draft.city_id}
              options={cities.map((city) => ({ label: city.name, value: city.id }))}
              onChange={(value) => set("city_id", value)}
            />
          </div>

          <label className="field" data-wide="true">
            <span className="field-label">Адрес</span>
            <input
              className="input"
              value={draft.address}
              onChange={(event) => set("address", event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">Метро</span>
            <input
              className="input"
              placeholder="без метро"
              value={draft.metro ?? ""}
              onChange={(event) => set("metro", event.target.value || null)}
            />
          </label>

          <label className="field">
            <span className="field-label">Телефон</span>
            <input
              className="input"
              placeholder="+7..."
              value={draft.phone ?? ""}
              onChange={(event) => set("phone", event.target.value || null)}
            />
          </label>

          <label className="field">
            <span className="field-label">Широта</span>
            <input
              className="input"
              inputMode="decimal"
              value={draft.latitude}
              onChange={(event) => set("latitude", Number(event.target.value.replace(",", ".")) || 0)}
            />
          </label>

          <label className="field">
            <span className="field-label">Долгота</span>
            <input
              className="input"
              inputMode="decimal"
              value={draft.longitude}
              onChange={(event) => set("longitude", Number(event.target.value.replace(",", ".")) || 0)}
            />
          </label>

          <label className="field" data-wide="true">
            <span className="field-label">Описание</span>
            <textarea
              className="textarea"
              value={draft.description ?? ""}
              onChange={(event) => set("description", event.target.value || null)}
            />
          </label>
        </div>
      </section>

      <section className="drawer-section">
        <h3 className="drawer-section-title">Время</h3>
        <div className="drawer-form-grid">
          <label className="field">
            <span className="field-label">Открытие</span>
            <input
              className="input"
              type="time"
              value={draft.opens_at}
              onChange={(event) => set("opens_at", event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Закрытие</span>
            <input
              className="input"
              type="time"
              value={draft.closes_at}
              onChange={(event) => set("closes_at", event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Доставка с</span>
            <input
              className="input"
              type="time"
              value={draft.delivery_opens_at ?? ""}
              onChange={(event) => set("delivery_opens_at", event.target.value || null)}
            />
          </label>
          <label className="field">
            <span className="field-label">Доставка до</span>
            <input
              className="input"
              type="time"
              value={draft.delivery_closes_at ?? ""}
              onChange={(event) => set("delivery_closes_at", event.target.value || null)}
            />
          </label>
        </div>
      </section>

      <section className="drawer-section">
        <h3 className="drawer-section-title">Доставка</h3>
        <div className="drawer-form-grid">
          <label className="field">
            <span className="field-label">Стоимость, ₽</span>
            <input
              className="input"
              inputMode="numeric"
              value={Math.round(draft.delivery_price_kopecks / 100)}
              onChange={(event) => set("delivery_price_kopecks", rubToKopecks(event.target.value))}
            />
          </label>
          <label className="field">
            <span className="field-label">Минимальный заказ, ₽</span>
            <input
              className="input"
              inputMode="numeric"
              value={Math.round(draft.delivery_min_order_kopecks / 100)}
              onChange={(event) => set("delivery_min_order_kopecks", rubToKopecks(event.target.value))}
            />
          </label>
          <label className="field">
            <span className="field-label">Бесплатно от, ₽</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="не задано"
              value={
                draft.free_delivery_from_kopecks === null
                  ? ""
                  : Math.round(draft.free_delivery_from_kopecks / 100)
              }
              onChange={(event) =>
                set(
                  "free_delivery_from_kopecks",
                  event.target.value.trim() === "" ? null : rubToKopecks(event.target.value),
                )
              }
            />
          </label>
        </div>
      </section>

      <section className="drawer-section">
        <h3 className="drawer-section-title">Режимы</h3>
        <div className="checkbox-grid">
          <label className="inline-check">
            <input
              checked={draft.has_delivery}
              type="checkbox"
              onChange={(event) => set("has_delivery", event.target.checked)}
            />
            Доставка
          </label>
          <label className="inline-check">
            <input
              checked={draft.has_pickup}
              type="checkbox"
              onChange={(event) => set("has_pickup", event.target.checked)}
            />
            Самовывоз
          </label>
          <label className="inline-check">
            <input
              checked={draft.has_dine_in}
              type="checkbox"
              onChange={(event) => set("has_dine_in", event.target.checked)}
            />
            Зал
          </label>
          <label className="inline-check">
            <input
              checked={draft.is_active}
              type="checkbox"
              onChange={(event) => set("is_active", event.target.checked)}
            />
            Показывать гостям
          </label>
          <label className="inline-check">
            <input
              checked={draft.is_paused}
              type="checkbox"
              onChange={(event) => set("is_paused", event.target.checked)}
            />
            На паузе
          </label>
          <label className="inline-check">
            <input
              checked={draft.preorder_enabled}
              type="checkbox"
              onChange={(event) => set("preorder_enabled", event.target.checked)}
            />
            Предзаказ вне часов
          </label>
        </div>
        {draft.is_paused ? (
          <label className="field">
            <span className="field-label">Причина паузы</span>
            <input
              className="input"
              value={draft.pause_reason ?? ""}
              onChange={(event) => set("pause_reason", event.target.value || null)}
            />
          </label>
        ) : null}
        <p className="section-copy">
          {draft.preorder_enabled
            ? "В нерабочие часы гость сможет оформить заказ на ближайшее доступное время."
            : "В нерабочие часы оформление заказа будет закрыто полностью."}
        </p>
      </section>

      <div className="drawer-foot static-foot">
        <Button disabled={pending || uploading} variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
        <Button disabled={pending || uploading || !canSave} onClick={() => onSubmit(draft)}>
          {pending ? "Сохраняем..." : mode === "create" ? "Создать" : "Сохранить"}
        </Button>
      </div>
    </article>
  );
}

function RestaurantProfile({
  city,
  onDelete,
  onEdit,
  onMenu,
  onPause,
  onUnpause,
  pending,
  restaurant,
}: {
  city: string;
  onDelete: () => void;
  onEdit: () => void;
  onMenu: () => void;
  onPause: () => void;
  onUnpause: () => void;
  pending: boolean;
  restaurant: AdminRestaurant;
}) {
  return (
    <article className="split-detail">
      <div className="section-head">
        <div>
          <h2 className="section-title">{restaurant.name}</h2>
          <p className="section-copy">
            {city} · {restaurant.address}
            {restaurant.metro ? ` · м. ${restaurant.metro}` : ""}
          </p>
        </div>
        {statusBadge(restaurant)}
      </div>

      <div className="restaurant-hero">
        <div className="restaurant-photo">
          {restaurant.image_url ? (
            <img src={mediaUrl(restaurant.image_url) ?? ""} alt="" />
          ) : (
            <div className="restaurant-photo-placeholder">
              <Utensils size={24} aria-hidden />
            </div>
          )}
        </div>

        <div className="drawer-metrics">
          <div className="drawer-metric">
            <div className="metric-label">Зал</div>
            <div className="drawer-metric-value">{timeRange(restaurant.opens_at, restaurant.closes_at)}</div>
          </div>
          <div className="drawer-metric">
            <div className="metric-label">Доставка</div>
            <div className="drawer-metric-value">
              {restaurant.has_delivery
                ? timeRange(restaurant.delivery_opens_at, restaurant.delivery_closes_at)
                : "нет"}
            </div>
          </div>
          <div className="drawer-metric">
            <div className="metric-label">Стоимость</div>
            <div className="drawer-metric-value">
              {restaurant.has_delivery ? formatPrice(restaurant.delivery_price_kopecks) : "—"}
            </div>
          </div>
          <div className="drawer-metric">
            <div className="metric-label">Минимум</div>
            <div className="drawer-metric-value">
              {restaurant.delivery_min_order_kopecks > 0
                ? formatPrice(restaurant.delivery_min_order_kopecks)
                : "нет"}
            </div>
          </div>
        </div>
      </div>

      <div className="restaurant-service-grid">
        <ServiceTile
          active={restaurant.has_delivery}
          icon={<Truck size={17} aria-hidden />}
          label="Доставка"
          value={restaurant.has_delivery ? "доступна" : "выключена"}
        />
        <ServiceTile
          active={restaurant.has_pickup}
          icon={<Utensils size={17} aria-hidden />}
          label="Самовывоз"
          value={restaurant.has_pickup ? "доступен" : "выключен"}
        />
        <ServiceTile
          active={restaurant.has_dine_in}
          icon={<MapPin size={17} aria-hidden />}
          label="Зал"
          value={restaurant.has_dine_in ? "принимает гостей" : "скрыт"}
        />
      </div>

      {restaurant.is_paused ? (
        <div className="alert-band">
          <PauseCircle size={16} aria-hidden />
          {restaurant.pause_reason || "Ресторан временно не принимает заказы"}
        </div>
      ) : null}

      <section className="drawer-section">
        <h3 className="drawer-section-title">Контакты и координаты</h3>
        <div className="detail-list">
          <div className="detail-row">
            <span className="detail-label">Телефон</span>
            <span>{restaurant.phone || "не указан"}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Координаты</span>
            <span className="mono">
              {restaurant.latitude}, {restaurant.longitude}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Бесплатно от</span>
            <span>
              {restaurant.free_delivery_from_kopecks
                ? formatPrice(restaurant.free_delivery_from_kopecks)
                : "не задано"}
            </span>
          </div>
        </div>
      </section>

      <section className="drawer-section">
        <h3 className="drawer-section-title">Описание</h3>
        <div className="split-list-card">
          <p className="section-copy">{restaurant.description || "Описание пока не заполнено."}</p>
        </div>
      </section>

      <div className="drawer-actions">
        <Button onClick={onMenu}>
          <Utensils size={15} aria-hidden />
          Меню точки
        </Button>
        <Button variant="ghost" onClick={onEdit}>
          <Pencil size={15} aria-hidden />
          Изменить
        </Button>
        {restaurant.is_paused ? (
          <Button disabled={pending} variant="ghost" onClick={onUnpause}>
            <PlayCircle size={15} aria-hidden />
            Снять паузу
          </Button>
        ) : (
          <Button disabled={pending} variant="ghost" onClick={onPause}>
            <PauseCircle size={15} aria-hidden />
            Пауза
          </Button>
        )}
        <Button disabled={pending} variant="danger" onClick={onDelete}>
          <Trash2 size={15} aria-hidden />
          Удалить
        </Button>
      </div>
    </article>
  );
}

export function RestaurantsTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [cityId, setCityId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminRestaurant | null>(null);
  const [pauseTarget, setPauseTarget] = useState<AdminRestaurant | null>(null);

  const restaurants = useQuery({ queryKey: ["admin-restaurants"], queryFn: api.adminRestaurants });
  const cities = useQuery({ queryKey: ["cities"], queryFn: api.cities });

  const rows = restaurants.data ?? [];
  const cityRows = cities.data ?? [];
  const cityById = useMemo(() => new Map(cityRows.map((city) => [city.id, city.name])), [cityRows]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin-restaurants"] });

  const save = useMutation({
    mutationFn: ({ draft, id }: { draft: RestaurantDraft; id: string | null }) =>
      id ? api.updateRestaurant(id, draft) : api.createRestaurant(draft),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (restaurant) => {
      setCreating(false);
      setEditingId(null);
      setMenuId(null);
      setSelectedId(restaurant.id);
      refresh();
      toast.success("Ресторан сохранён");
    },
  });

  const pause = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.updateRestaurant(id, { is_paused: true, pause_reason: reason }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (restaurant) => {
      setPauseTarget(null);
      setSelectedId(restaurant.id);
      refresh();
      toast.success("Ресторан поставлен на паузу");
    },
  });

  const unpause = useMutation({
    mutationFn: (id: string) => api.updateRestaurant(id, { is_paused: false, pause_reason: null }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (restaurant) => {
      setSelectedId(restaurant.id);
      refresh();
      toast.success("Пауза снята");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteRestaurant(id),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      setDeleteTarget(null);
      setMenuId(null);
      setEditingId(null);
      setSelectedId(null);
      refresh();
      toast.success("Ресторан удалён");
    },
  });

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return rows.filter((restaurant) => {
      const haystack = `${restaurant.name} ${restaurant.address} ${restaurant.metro ?? ""} ${cityName(
        cityById,
        restaurant.city_id,
      )}`.toLocaleLowerCase("ru-RU");
      const matchesSearch = haystack.includes(needle);
      const matchesCity = !cityId || restaurant.city_id === cityId;
      const matchesStatus =
        status === "all" ||
        (status === "taking" && restaurant.is_active && !restaurant.is_paused) ||
        (status === "paused" && restaurant.is_paused) ||
        (status === "disabled" && !restaurant.is_active);
      return matchesSearch && matchesCity && matchesStatus;
    });
  }, [cityById, cityId, rows, search, status]);

  useEffect(() => {
    if (creating) return;
    if (selectedId && visible.some((restaurant) => restaurant.id === selectedId)) return;
    setSelectedId(visible[0]?.id ?? null);
  }, [creating, selectedId, visible]);

  const selected = selectedId ? rows.find((restaurant) => restaurant.id === selectedId) ?? null : null;
  const editing = editingId ? rows.find((restaurant) => restaurant.id === editingId) ?? null : null;
  const menuRestaurant = menuId ? rows.find((restaurant) => restaurant.id === menuId) ?? null : null;

  const takingOrders = rows.filter((restaurant) => restaurant.is_active && !restaurant.is_paused).length;
  const paused = rows.filter((restaurant) => restaurant.is_paused).length;
  const delivery = rows.filter((restaurant) => restaurant.has_delivery).length;

  const beginCreate = () => {
    setCreating(true);
    setEditingId(null);
    setMenuId(null);
    setSelectedId(null);
  };

  const beginEdit = (restaurant: AdminRestaurant) => {
    setCreating(false);
    setEditingId(restaurant.id);
    setMenuId(null);
    setSelectedId(restaurant.id);
  };

  return (
    <div className="page-stack">
      <Section
        title="Рестораны"
        action={
          <Button disabled={cityRows.length === 0} onClick={beginCreate}>
            <Plus size={15} aria-hidden />
            Добавить ресторан
          </Button>
        }
        description="Операционная карточка каждой точки: режим, доставка, фото, координаты и меню."
      >
        <div className="metric-strip">
          <Metric label="Всего" note="точек в сети" value={String(rows.length)} />
          <Metric label="Принимают" note="заказы сейчас" value={String(takingOrders)} />
          <Metric label="Пауза" note="временно закрыты" value={String(paused)} />
          <Metric label="Доставка" note="подключена" value={String(delivery)} />
        </div>
      </Section>

      <Section title="Управление сетью">
        <div className="surface-toolbar">
          <label className="field">
            <span className="field-label">Поиск</span>
            <span className="search-control">
              <Search className="search-icon" size={15} aria-hidden />
              <input
                className="input"
                placeholder="Поиск точки"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </span>
          </label>

          <div className="field toolbar-field">
            <span className="field-label">Город</span>
            <Select
              value={cityId}
              options={[
                { label: "Все города", value: "" },
                ...cityRows.map((city) => ({ label: city.name, value: city.id })),
              ]}
              onChange={setCityId}
            />
          </div>

          <div className="filter-chips" aria-label="Статус ресторанов">
            <button className="filter-chip" data-active={status === "all"} type="button" onClick={() => setStatus("all")}>
              Все
            </button>
            <button className="filter-chip" data-active={status === "taking"} type="button" onClick={() => setStatus("taking")}>
              Принимают
            </button>
            <button className="filter-chip" data-active={status === "paused"} type="button" onClick={() => setStatus("paused")}>
              Пауза
            </button>
            <button className="filter-chip" data-active={status === "disabled"} type="button" onClick={() => setStatus("disabled")}>
              Отключены
            </button>
          </div>
        </div>

        {restaurants.error ? (
          <div className="error-state">
            <h2>Не удалось загрузить рестораны</h2>
            <p>{errorMessage(restaurants.error)}</p>
          </div>
        ) : restaurants.isPending ? (
          <div className="table-shell" data-loading="true">
            <div className="page-stack">
              <div className="skeleton skeleton-row" />
              <div className="skeleton skeleton-card" />
              <div className="skeleton skeleton-card" />
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <h2>Ресторанов пока нет</h2>
            <p>Создайте первую точку, чтобы подключить меню, зоны доставки и интеграции.</p>
          </div>
        ) : (
          <div className="split-view">
            <aside className="split-sidebar">
              <div className="split-list-card">
                <div className="row-main">Точки</div>
                <div className="row-sub">{visible.length} в текущем фильтре</div>
              </div>
              <div className="split-list">
                {visible.map((restaurant) => (
                  <button
                    key={restaurant.id}
                    className="split-list-item"
                    data-active={restaurant.id === selectedId}
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setEditingId(null);
                      setMenuId(null);
                      setSelectedId(restaurant.id);
                    }}
                  >
                    <span className="row-main">{restaurant.name}</span>
                    <span className="row-sub">
                      {cityName(cityById, restaurant.city_id)} · {restaurant.address}
                    </span>
                    <span className="chips-line">
                      {statusBadge(restaurant)}
                      {restaurant.preorder_enabled ? <Badge text="предзаказ" tone="accent" /> : null}
                    </span>
                  </button>
                ))}
              </div>
            </aside>

            {creating ? (
              <RestaurantEditor
                cities={cityRows}
                initial={emptyDraft(cityRows[0]?.id ?? "")}
                mode="create"
                pending={save.isPending}
                onCancel={() => {
                  setCreating(false);
                  setSelectedId(visible[0]?.id ?? null);
                }}
                onSubmit={(draft) => save.mutate({ draft, id: null })}
              />
            ) : editing ? (
              <RestaurantEditor
                cities={cityRows}
                initial={toDraft(editing)}
                mode="edit"
                pending={save.isPending}
                onCancel={() => setEditingId(null)}
                onSubmit={(draft) => save.mutate({ draft, id: editing.id })}
              />
            ) : menuRestaurant ? (
              <RestaurantMenu
                restaurantId={menuRestaurant.id}
                restaurantName={menuRestaurant.name}
                onClose={() => setMenuId(null)}
              />
            ) : selected ? (
              <RestaurantProfile
                city={cityName(cityById, selected.city_id)}
                pending={pause.isPending || unpause.isPending || remove.isPending}
                restaurant={selected}
                onDelete={() => setDeleteTarget(selected)}
                onEdit={() => beginEdit(selected)}
                onMenu={() => setMenuId(selected.id)}
                onPause={() => setPauseTarget(selected)}
                onUnpause={() => unpause.mutate(selected.id)}
              />
            ) : (
              <article className="split-detail">
                <div className="empty-state">
                  <h2>Нет ресторанов в фильтре</h2>
                  <p>Измените поиск, город или статус, чтобы снова увидеть точки сети.</p>
                </div>
              </article>
            )}
          </div>
        )}
      </Section>

      {deleteTarget ? (
        <ConfirmDialog
          busy={remove.isPending}
          message={`Удалить «${deleteTarget.name}»? Это действие нельзя отменить.`}
          title="Удалить ресторан"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => remove.mutate(deleteTarget.id)}
        />
      ) : null}

      {pauseTarget ? (
        <PauseDialog
          busy={pause.isPending}
          restaurant={pauseTarget}
          onCancel={() => setPauseTarget(null)}
          onConfirm={(reason) => pause.mutate({ id: pauseTarget.id, reason })}
        />
      ) : null}
    </div>
  );
}
