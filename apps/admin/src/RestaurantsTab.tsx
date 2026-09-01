import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  Building2,
  Clock3,
  Eye,
  EyeOff,
  ImageUp,
  MapPin,
  MapPinned,
  PauseCircle,
  Pencil,
  Phone,
  PlayCircle,
  Plus,
  Route,
  Search,
  Settings2,
  Store,
  Trash2,
  Truck,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  formatPrice,
  mediaUrl,
  type AdminRestaurant,
  type City,
  type RestaurantDraft,
  type Zone,
} from "./api";
import { RestaurantMenu } from "./RestaurantMenu";
import { ZoneEditor } from "./ZoneEditor";
import { ZoneMap, type ZoneMapZone, zoneMapProviderName } from "./ZoneMap";
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
  return <Badge text="принимает" tone="ok" />;
}

function cityName(cityById: Map<string, string>, cityId: string): string {
  return cityById.get(cityId) ?? "Город не выбран";
}

function timeRange(from: string | null, to: string | null): string {
  if (!from || !to) return "не задано";
  return `${from.slice(0, 5)}-${to.slice(0, 5)}`;
}

function money(value: number | null): string {
  return value === null ? "не задано" : formatPrice(value);
}

function restaurantState(restaurant: AdminRestaurant): StatusFilter {
  if (!restaurant.is_active) return "disabled";
  if (restaurant.is_paused) return "paused";
  return "taking";
}

function zoneMap(zone: Zone): ZoneMapZone {
  return {
    color: zone.color,
    id: zone.id,
    is_active: zone.is_active,
    name: zone.name,
    outline: zone.outline,
    restaurant_name: zone.restaurant_name,
  };
}

function NetworkMetric({
  icon: Icon,
  label,
  note,
  tone,
  value,
}: {
  icon: LucideIcon;
  label: string;
  note: string;
  tone?: "ok" | "warn" | "bad" | "muted";
  value: string;
}) {
  return (
    <div className="restaurant-metric" data-tone={tone}>
      <Icon size={17} aria-hidden />
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
        <em>{note}</em>
      </span>
    </div>
  );
}

function FactCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
}) {
  return (
    <span className="restaurant-fact-card">
      <Icon size={16} aria-hidden />
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </span>
  );
}

function ServiceTile({
  active,
  icon,
  label,
  value,
}: {
  active: boolean;
  icon: ReactNode;
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

function RestaurantPhoto({
  imageUrl,
  name,
}: {
  imageUrl: string | null;
  name: string;
}) {
  return (
    <div className="restaurant-photo">
      {imageUrl ? (
        <img src={mediaUrl(imageUrl) ?? ""} alt={name} />
      ) : (
        <div className="restaurant-photo-placeholder">
          <Utensils size={24} aria-hidden />
        </div>
      )}
    </div>
  );
}

function RestaurantListItem({
  city,
  restaurant,
  selected,
  zonesCount,
  onSelect,
}: {
  city: string;
  restaurant: AdminRestaurant;
  selected: boolean;
  zonesCount: number;
  onSelect: () => void;
}) {
  return (
    <button
      className="restaurant-list-item"
      data-active={selected}
      data-restaurant-id={restaurant.id}
      data-state={restaurantState(restaurant)}
      type="button"
      onClick={onSelect}
    >
      <span className="restaurant-list-photo">
        {restaurant.image_url ? <img src={mediaUrl(restaurant.image_url) ?? ""} alt="" /> : <Store size={16} aria-hidden />}
      </span>
      <span className="restaurant-list-copy">
        <strong>{restaurant.name}</strong>
        <small>
          {city} · {restaurant.address}
        </small>
      </span>
      <span className="restaurant-list-meta">
        {statusBadge(restaurant)}
        <span>{zonesCount} зон</span>
      </span>
    </button>
  );
}

function RestaurantToggle({
  checked,
  icon,
  label,
  note,
  onChange,
}: {
  checked: boolean;
  icon: ReactNode;
  label: string;
  note: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="restaurant-toggle-card" data-active={checked}>
      <input checked={checked} type="checkbox" onChange={(event) => onChange(event.target.checked)} />
      <span className="restaurant-toggle-icon">{icon}</span>
      <span>
        <strong>{label}</strong>
        <small>{note}</small>
      </span>
    </label>
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
            <textarea className="textarea" value={reason} onChange={(event) => setReason(event.target.value)} />
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
    <article className="restaurant-panel restaurant-editor-panel">
      <header className="restaurant-panel-head">
        <div className="restaurant-panel-title">
          <span className="restaurant-panel-mark">
            <Pencil size={18} aria-hidden />
          </span>
          <div>
            <h2>{mode === "create" ? "Новый ресторан" : draft.name}</h2>
            <p>{draft.address || "Адрес еще не заполнен"}</p>
          </div>
        </div>
        {statusBadge(draft)}
      </header>

      <div className="restaurant-editor-layout">
        <aside className="restaurant-editor-media">
          <RestaurantPhoto imageUrl={draft.image_url} name={draft.name || "Ресторан"} />
          <label className="upload-button">
            <ImageUp size={15} aria-hidden />
            {uploading ? "Загружаем..." : draft.image_url ? "Заменить фото" : "Добавить фото"}
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
          <div className="restaurant-editor-preview">
            <span>
              <small>Зал</small>
              <strong>{timeRange(draft.opens_at, draft.closes_at)}</strong>
            </span>
            <span>
              <small>Доставка</small>
              <strong>{draft.has_delivery ? timeRange(draft.delivery_opens_at, draft.delivery_closes_at) : "выключена"}</strong>
            </span>
          </div>
        </aside>

        <div className="restaurant-editor-form">
          <section className="restaurant-form-section">
            <div className="restaurant-form-head">
              <strong>Паспорт</strong>
              <MapPin size={16} aria-hidden />
            </div>
            <div className="drawer-form-grid">
              <label className="field">
                <span className="field-label">Название</span>
                <input className="input" value={draft.name} onChange={(event) => set("name", event.target.value)} />
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
                <input className="input" value={draft.address} onChange={(event) => set("address", event.target.value)} />
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

          <section className="restaurant-form-section">
            <div className="restaurant-form-head">
              <strong>Время и доставка</strong>
              <Clock3 size={16} aria-hidden />
            </div>
            <div className="drawer-form-grid">
              <label className="field">
                <span className="field-label">Открытие</span>
                <input className="input" type="time" value={draft.opens_at} onChange={(event) => set("opens_at", event.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Закрытие</span>
                <input className="input" type="time" value={draft.closes_at} onChange={(event) => set("closes_at", event.target.value)} />
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
                <span className="field-label">Минимум, ₽</span>
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
                  value={draft.free_delivery_from_kopecks === null ? "" : Math.round(draft.free_delivery_from_kopecks / 100)}
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

          <section className="restaurant-form-section">
            <div className="restaurant-form-head">
              <strong>Режимы</strong>
              <Settings2 size={16} aria-hidden />
            </div>
            <div className="restaurant-toggle-grid">
              <RestaurantToggle
                checked={draft.has_delivery}
                icon={<Truck size={16} aria-hidden />}
                label="Доставка"
                note={draft.has_delivery ? "доступна" : "выключена"}
                onChange={(value) => set("has_delivery", value)}
              />
              <RestaurantToggle
                checked={draft.has_pickup}
                icon={<Utensils size={16} aria-hidden />}
                label="Самовывоз"
                note={draft.has_pickup ? "доступен" : "выключен"}
                onChange={(value) => set("has_pickup", value)}
              />
              <RestaurantToggle
                checked={draft.has_dine_in}
                icon={<MapPin size={16} aria-hidden />}
                label="Зал"
                note={draft.has_dine_in ? "работает" : "скрыт"}
                onChange={(value) => set("has_dine_in", value)}
              />
              <RestaurantToggle
                checked={draft.is_active}
                icon={draft.is_active ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
                label="Показывать"
                note={draft.is_active ? "виден гостям" : "скрыт"}
                onChange={(value) => set("is_active", value)}
              />
              <RestaurantToggle
                checked={draft.is_paused}
                icon={<PauseCircle size={16} aria-hidden />}
                label="Пауза"
                note={draft.is_paused ? "заказы закрыты" : "принимает заказы"}
                onChange={(value) => set("is_paused", value)}
              />
              <RestaurantToggle
                checked={draft.preorder_enabled}
                icon={<Clock3 size={16} aria-hidden />}
                label="Предзаказ"
                note={draft.preorder_enabled ? "после закрытия" : "выключен"}
                onChange={(value) => set("preorder_enabled", value)}
              />
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
          </section>
        </div>
      </div>

      <footer className="restaurant-panel-foot">
        <Button disabled={pending || uploading} variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
        <Button disabled={pending || uploading || !canSave} onClick={() => onSubmit(draft)}>
          {pending ? "Сохраняем..." : mode === "create" ? "Создать ресторан" : "Сохранить"}
        </Button>
      </footer>
    </article>
  );
}

function RestaurantProfile({
  city,
  onCreateZone,
  onDelete,
  onEdit,
  onMenu,
  onPause,
  onUnpause,
  pending,
  restaurant,
  zonesCount,
}: {
  city: string;
  onCreateZone: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onMenu: () => void;
  onPause: () => void;
  onUnpause: () => void;
  pending: boolean;
  restaurant: AdminRestaurant;
  zonesCount: number;
}) {
  return (
    <article className="restaurant-panel restaurant-profile-panel">
      <header className="restaurant-panel-head">
        <div className="restaurant-panel-title">
          <span className="restaurant-panel-mark">
            <Building2 size={18} aria-hidden />
          </span>
          <div>
            <h2>{restaurant.name}</h2>
            <p>
              {city} · {restaurant.address}
              {restaurant.metro ? ` · м. ${restaurant.metro}` : ""}
            </p>
          </div>
        </div>
        {statusBadge(restaurant)}
      </header>

      <div className="restaurant-profile-hero">
        <RestaurantPhoto imageUrl={restaurant.image_url} name={restaurant.name} />
        <div className="restaurant-profile-summary">
          <div className="restaurant-fact-grid">
            <FactCard icon={Clock3} label="Зал" value={timeRange(restaurant.opens_at, restaurant.closes_at)} />
            <FactCard
              icon={Truck}
              label="Доставка"
              value={restaurant.has_delivery ? timeRange(restaurant.delivery_opens_at, restaurant.delivery_closes_at) : "выключена"}
            />
            <FactCard icon={Banknote} label="Стоимость" value={restaurant.has_delivery ? formatPrice(restaurant.delivery_price_kopecks) : "нет"} />
            <FactCard icon={Phone} label="Телефон" value={restaurant.phone || "не указан"} />
            <FactCard
              icon={MapPinned}
              label="Зоны"
              value={zonesCount > 0 ? `${zonesCount} подключено` : "не заданы"}
            />
          </div>

          {restaurant.is_paused ? (
            <div className="alert-band">
              <PauseCircle size={16} aria-hidden />
              {restaurant.pause_reason || "Ресторан временно не принимает заказы"}
            </div>
          ) : null}
        </div>
      </div>

      <section className="restaurant-block">
        <div className="restaurant-block-head">
          <strong>Режимы точки</strong>
          {restaurant.preorder_enabled ? <Badge text="предзаказ" tone="accent" /> : null}
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
      </section>

      <section className="restaurant-block">
        <div className="restaurant-block-head">
          <strong>Контакты и доставка</strong>
        </div>
        <div className="restaurant-detail-grid">
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
            <span className="detail-label">Минимум</span>
            <span>{restaurant.delivery_min_order_kopecks > 0 ? formatPrice(restaurant.delivery_min_order_kopecks) : "нет"}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Бесплатно от</span>
            <span>{money(restaurant.free_delivery_from_kopecks)}</span>
          </div>
        </div>
      </section>

      <section className="restaurant-block">
        <div className="restaurant-block-head">
          <strong>Описание</strong>
        </div>
        <p className="restaurant-description">{restaurant.description || "Описание пока не заполнено."}</p>
      </section>

      <footer className="restaurant-panel-foot">
        <Button onClick={onMenu}>
          <Utensils size={15} aria-hidden />
          Меню точки
        </Button>
        <Button variant="ghost" onClick={onCreateZone}>
          <MapPinned size={15} aria-hidden />
          Добавить зону
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
        <IconButton disabled={pending} label="Удалить ресторан" variant="danger" onClick={onDelete}>
          <Trash2 size={15} aria-hidden />
        </IconButton>
      </footer>
    </article>
  );
}

function RestaurantZonesPanel({
  busyZoneId,
  onCreate,
  onEdit,
  onToggle,
  restaurant,
  zones,
  zonesError,
  zonesPending,
}: {
  busyZoneId: string | null;
  onCreate: () => void;
  onEdit: (zone: Zone) => void;
  onToggle: (zone: Zone) => void;
  restaurant: AdminRestaurant | null;
  zones: Zone[];
  zonesError: unknown;
  zonesPending: boolean;
}) {
  const zoneIds = zones.map((zone) => zone.id).join("|");
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);

  useEffect(() => {
    setActiveZoneId((current) => (current && zones.some((zone) => zone.id === current) ? current : zones[0]?.id ?? null));
  }, [restaurant?.id, zoneIds, zones]);

  const activeZone = activeZoneId ? zones.find((zone) => zone.id === activeZoneId) ?? null : zones[0] ?? null;
  const activeZones = zones.filter((zone) => zone.is_active).length;
  const mapZones = zones.map(zoneMap);

  return (
    <aside className="restaurant-zones-panel">
      <header className="restaurant-zones-head">
        <div>
          <h3>Зоны доставки</h3>
          <p>{restaurant ? `${zones.length} зон · ${activeZones} работают` : "Выберите ресторан"}</p>
        </div>
        <IconButton disabled={!restaurant} label="Создать зону" size="sm" onClick={onCreate}>
          <Plus size={15} aria-hidden />
        </IconButton>
      </header>

      {restaurant ? (
        <div className="restaurant-zone-map">
          <ZoneMap
            activeZoneId={activeZone?.id ?? null}
            center={restaurant}
            color={activeZone?.color ?? "#1E3A8A"}
            outline={activeZone?.outline ?? []}
            zones={mapZones}
            onZoneClick={setActiveZoneId}
          />
        </div>
      ) : (
        <div className="restaurant-zones-empty">
          <MapPinned size={20} aria-hidden />
          <strong>Ресторан не выбран</strong>
          <span>После выбора точки здесь появятся ее зоны.</span>
        </div>
      )}

      <div className="restaurant-zones-toolbar">
        <span>
          <MapPinned size={14} aria-hidden />
          {zoneMapProviderName}
        </span>
        <span>
          <Route size={14} aria-hidden />
          {zones.reduce((sum, zone) => sum + zone.outline.length, 0)} точек
        </span>
      </div>

      {zonesError ? (
        <div className="restaurant-zones-empty">
          <strong>Зоны не загрузились</strong>
          <span>{errorMessage(zonesError)}</span>
        </div>
      ) : zonesPending ? (
        <div className="restaurant-zone-list">
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-card" />
        </div>
      ) : zones.length > 0 ? (
        <div className="restaurant-zone-list">
          {zones.map((zone) => (
            <div
              key={zone.id}
              className="restaurant-zone-card"
              data-active={zone.id === activeZone?.id}
              data-state={zone.is_active ? "active" : "inactive"}
              style={{ "--zone-color": zone.color } as CSSProperties}
            >
              <button className="restaurant-zone-card-main" type="button" onClick={() => setActiveZoneId(zone.id)}>
                <span className="restaurant-zone-swatch" />
                <span className="restaurant-zone-copy">
                  <strong>{zone.name}</strong>
                  <small>{zone.outline.length} точек · порядок {zone.sort_order}</small>
                </span>
                {zone.is_active ? <Badge text="работает" tone="ok" /> : <Badge text="выключена" tone="muted" />}
              </button>
              <div className="restaurant-zone-terms">
                <span>
                  <small>Минимум</small>
                  <strong>{formatPrice(zone.min_order_kopecks)}</strong>
                </span>
                <span>
                  <small>Доставка</small>
                  <strong>{formatPrice(zone.delivery_price_kopecks)}</strong>
                </span>
                <span>
                  <small>Время</small>
                  <strong>{zone.delivery_minutes ? `${zone.delivery_minutes} мин` : "не задано"}</strong>
                </span>
              </div>
              <div className="restaurant-zone-actions">
                <Button size="sm" variant="ghost" onClick={() => onEdit(zone)}>
                  <Pencil size={14} aria-hidden />
                  Контур
                </Button>
                <Button disabled={busyZoneId === zone.id} size="sm" variant="ghost" onClick={() => onToggle(zone)}>
                  {zone.is_active ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                  {zone.is_active ? "Выключить" : "Включить"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : restaurant ? (
        <div className="restaurant-zones-empty">
          <MapPinned size={20} aria-hidden />
          <strong>Зон пока нет</strong>
          <span>Создайте контур для этой точки.</span>
          <Button onClick={onCreate}>
            <Plus size={15} aria-hidden />
            Нарисовать зону
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

export function RestaurantsTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [cityId, setCityId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminRestaurant | null>(null);
  const [pauseTarget, setPauseTarget] = useState<AdminRestaurant | null>(null);
  const [zoneEditorTarget, setZoneEditorTarget] = useState<Zone | "new" | null>(null);
  const [zoneEditorRestaurantId, setZoneEditorRestaurantId] = useState<string | null>(null);
  const [busyZoneId, setBusyZoneId] = useState<string | null>(null);

  const restaurants = useQuery({ queryKey: ["admin-restaurants"], queryFn: api.adminRestaurants });
  const cities = useQuery({ queryKey: ["cities"], queryFn: api.cities });
  const zones = useQuery({ queryKey: ["zones"], queryFn: api.zones });

  const rows = restaurants.data ?? [];
  const cityRows = cities.data ?? [];
  const zoneRows = zones.data ?? [];
  const cityById = useMemo(() => new Map(cityRows.map((city) => [city.id, city.name])), [cityRows]);

  const zonesByRestaurant = useMemo(() => {
    const map = new Map<string, Zone[]>();
    zoneRows.forEach((zone) => {
      const current = map.get(zone.restaurant_id) ?? [];
      current.push(zone);
      map.set(zone.restaurant_id, current);
    });
    map.forEach((items) => items.sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name, "ru-RU")));
    return map;
  }, [zoneRows]);

  const refreshRestaurants = () => void queryClient.invalidateQueries({ queryKey: ["admin-restaurants"] });
  const refreshZones = () => void queryClient.invalidateQueries({ queryKey: ["zones"] });

  const save = useMutation({
    mutationFn: ({ draft, id }: { draft: RestaurantDraft; id: string | null }) =>
      id ? api.updateRestaurant(id, draft) : api.createRestaurant(draft),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (restaurant) => {
      setCreating(false);
      setEditingId(null);
      setMenuId(null);
      setSelectedId(restaurant.id);
      setSelectionTouched(true);
      refreshRestaurants();
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
      refreshRestaurants();
      toast.success("Ресторан поставлен на паузу");
    },
  });

  const unpause = useMutation({
    mutationFn: (id: string) => api.updateRestaurant(id, { is_paused: false, pause_reason: null }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (restaurant) => {
      setSelectedId(restaurant.id);
      refreshRestaurants();
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
      refreshRestaurants();
      refreshZones();
      toast.success("Ресторан удалён");
    },
  });

  const toggleZone = useMutation({
    mutationFn: (zone: Zone) => api.updateZone(zone.id, { is_active: !zone.is_active }),
    onMutate: (zone) => setBusyZoneId(zone.id),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => setBusyZoneId(null),
    onSuccess: (zone) => {
      refreshZones();
      toast.success(zone.is_active ? "Зона включена" : "Зона выключена");
    },
  });

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return [...rows]
      .sort((left, right) => {
        const cityOrder = cityName(cityById, left.city_id).localeCompare(cityName(cityById, right.city_id), "ru-RU");
        return cityOrder || left.name.localeCompare(right.name, "ru-RU");
      })
      .filter((restaurant) => {
        const haystack = `${restaurant.name} ${restaurant.address} ${restaurant.metro ?? ""} ${cityName(
          cityById,
          restaurant.city_id,
        )}`.toLocaleLowerCase("ru-RU");
        const matchesSearch = haystack.includes(needle);
        const matchesCity = !cityId || restaurant.city_id === cityId;
        const state = restaurantState(restaurant);
        const matchesStatus = status === "all" || status === state;
        return matchesSearch && matchesCity && matchesStatus;
      });
  }, [cityById, cityId, rows, search, status]);

  const defaultVisibleId = useMemo(
    () => visible.find((restaurant) => (zonesByRestaurant.get(restaurant.id)?.length ?? 0) > 0)?.id ?? visible[0]?.id ?? null,
    [visible, zonesByRestaurant],
  );

  useEffect(() => {
    if (creating) return;
    const selectedIsVisible = Boolean(selectedId && visible.some((restaurant) => restaurant.id === selectedId));
    if (selectedIsVisible && (selectionTouched || selectedId === defaultVisibleId || zones.isPending)) return;

    setSelectedId(defaultVisibleId);
    setSelectionTouched(false);
  }, [creating, defaultVisibleId, selectedId, selectionTouched, visible, zones.isPending]);

  useEffect(() => {
    if (!selectedId) return;

    window.setTimeout(() => {
      document
        .querySelector(`[data-restaurant-id="${CSS.escape(selectedId)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }, 0);
  }, [selectedId, visible.length]);

  const selected = selectedId ? rows.find((restaurant) => restaurant.id === selectedId) ?? null : null;
  const editing = editingId ? rows.find((restaurant) => restaurant.id === editingId) ?? null : null;
  const menuRestaurant = menuId ? rows.find((restaurant) => restaurant.id === menuId) ?? null : null;
  const contextRestaurant = creating ? null : editing ?? menuRestaurant ?? selected;
  const contextZones = contextRestaurant ? zonesByRestaurant.get(contextRestaurant.id) ?? [] : [];

  const takingOrders = rows.filter((restaurant) => restaurant.is_active && !restaurant.is_paused).length;
  const paused = rows.filter((restaurant) => restaurant.is_paused).length;
  const delivery = rows.filter((restaurant) => restaurant.has_delivery).length;
  const restaurantsWithZones = new Set(zoneRows.map((zone) => zone.restaurant_id)).size;

  const beginCreate = () => {
    setCreating(true);
    setSelectionTouched(false);
    setEditingId(null);
    setMenuId(null);
    setSelectedId(null);
  };

  const beginEdit = (restaurant: AdminRestaurant) => {
    setCreating(false);
    setSelectionTouched(true);
    setEditingId(restaurant.id);
    setMenuId(null);
    setSelectedId(restaurant.id);
  };

  const openCreateZone = (restaurant: AdminRestaurant | null) => {
    if (!restaurant) return;
    setZoneEditorRestaurantId(restaurant.id);
    setZoneEditorTarget("new");
  };

  const openEditZone = (zone: Zone) => {
    setZoneEditorRestaurantId(zone.restaurant_id);
    setZoneEditorTarget(zone);
  };

  return (
    <Section
      className="restaurants-page"
      title="Рестораны"
      action={
        <Button disabled={cityRows.length === 0} onClick={beginCreate}>
          <Plus size={15} aria-hidden />
          Добавить ресторан
        </Button>
      }
      description="Точки сети, фото, режимы, доставка, меню и зоны в одном рабочем экране."
    >
      <div className="restaurants-summary">
        <NetworkMetric icon={Store} label="точек всего" note="в сети" value={String(rows.length)} />
        <NetworkMetric icon={PlayCircle} label="принимают" note="заказы сейчас" tone="ok" value={String(takingOrders)} />
        <NetworkMetric icon={PauseCircle} label="на паузе" note="временно закрыты" tone="warn" value={String(paused)} />
        <NetworkMetric icon={MapPinned} label="с зонами" note={`${zoneRows.length} контуров`} value={`${restaurantsWithZones}/${rows.length}`} />
        <NetworkMetric icon={Truck} label="доставка" note="подключена" value={`${delivery}/${rows.length}`} />
      </div>

      <div className="restaurants-workbench">
        <aside className="restaurants-list-panel">
          <header className="restaurants-list-head">
            <div>
              <h3>Точки</h3>
              <p>{visible.length} показано</p>
            </div>
            <IconButton disabled={cityRows.length === 0} label="Добавить ресторан" size="sm" onClick={beginCreate}>
              <Plus size={15} aria-hidden />
            </IconButton>
          </header>

          <div className="restaurants-list-filters">
            <label className="field">
              <span className="field-label">Поиск</span>
              <span className="search-control">
                <Search className="search-icon" size={15} aria-hidden />
                <input
                  className="input"
                  placeholder="Название, адрес, метро"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </span>
            </label>
            <div className="field">
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
                Скрыты
              </button>
            </div>
          </div>

          <div className="restaurants-list">
            {visible.map((restaurant) => (
              <RestaurantListItem
                key={restaurant.id}
                city={cityName(cityById, restaurant.city_id)}
                restaurant={restaurant}
                selected={restaurant.id === selectedId}
                zonesCount={zonesByRestaurant.get(restaurant.id)?.length ?? 0}
                onSelect={() => {
                  setCreating(false);
                  setSelectionTouched(true);
                  setEditingId(null);
                  setMenuId(null);
                  setSelectedId(restaurant.id);
                }}
              />
            ))}
            {visible.length === 0 && !restaurants.isPending ? (
              <div className="restaurants-empty-list">
                <Store size={18} aria-hidden />
                <strong>Ничего не найдено</strong>
                <span>Измените поиск, город или статус.</span>
              </div>
            ) : null}
          </div>
        </aside>

        {restaurants.error ? (
          <article className="restaurant-panel">
            <div className="error-state">
              <h2>Не удалось загрузить рестораны</h2>
              <p>{errorMessage(restaurants.error)}</p>
            </div>
          </article>
        ) : restaurants.isPending ? (
          <article className="restaurant-panel">
            <div className="restaurant-loading-state">
              <div className="skeleton skeleton-row" />
              <div className="skeleton skeleton-card" />
              <div className="skeleton skeleton-card" />
            </div>
          </article>
        ) : rows.length === 0 ? (
          <article className="restaurant-panel">
            <div className="empty-state">
              <h2>Ресторанов пока нет</h2>
              <p>Создайте первую точку, чтобы подключить меню, зоны доставки и интеграции.</p>
            </div>
          </article>
        ) : creating ? (
          <RestaurantEditor
            cities={cityRows}
            initial={emptyDraft(cityRows[0]?.id ?? "")}
            mode="create"
            pending={save.isPending}
            onCancel={() => {
              setCreating(false);
              setSelectedId(defaultVisibleId ?? rows[0]?.id ?? null);
              setSelectionTouched(false);
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
          <RestaurantMenu restaurantId={menuRestaurant.id} restaurantName={menuRestaurant.name} onClose={() => setMenuId(null)} />
        ) : selected ? (
          <RestaurantProfile
            city={cityName(cityById, selected.city_id)}
            pending={pause.isPending || unpause.isPending || remove.isPending}
            restaurant={selected}
            zonesCount={zonesByRestaurant.get(selected.id)?.length ?? 0}
            onCreateZone={() => openCreateZone(selected)}
            onDelete={() => setDeleteTarget(selected)}
            onEdit={() => beginEdit(selected)}
            onMenu={() => setMenuId(selected.id)}
            onPause={() => setPauseTarget(selected)}
            onUnpause={() => unpause.mutate(selected.id)}
          />
        ) : (
          <article className="restaurant-panel">
            <div className="empty-state">
              <h2>Нет ресторанов в фильтре</h2>
              <p>Измените поиск, город или статус, чтобы снова увидеть точки сети.</p>
            </div>
          </article>
        )}

        <RestaurantZonesPanel
          busyZoneId={busyZoneId}
          restaurant={contextRestaurant}
          zones={contextZones}
          zonesError={zones.error}
          zonesPending={zones.isPending}
          onCreate={() => openCreateZone(contextRestaurant)}
          onEdit={openEditZone}
          onToggle={(zone) => toggleZone.mutate(zone)}
        />
      </div>

      {zoneEditorTarget ? (
        <ZoneEditor
          cities={cityRows}
          initialRestaurantId={zoneEditorRestaurantId ?? undefined}
          restaurants={rows}
          zone={zoneEditorTarget === "new" ? null : zoneEditorTarget}
          zones={zoneRows}
          onClose={() => setZoneEditorTarget(null)}
          onSaved={(zone) => {
            setZoneEditorTarget(null);
            setZoneEditorRestaurantId(null);
            setSelectedId(zone.restaurant_id);
            refreshZones();
          }}
        />
      ) : null}

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
    </Section>
  );
}
