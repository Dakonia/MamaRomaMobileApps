import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  Clock3,
  Edit3,
  Eye,
  EyeOff,
  MapPinned,
  Plus,
  Route,
  Search,
  Settings2,
  Store,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { toast } from "sonner";

import { api, ApiError, formatPrice, type AdminRestaurant, type City, type Zone } from "./api";
import { ConfirmDialog } from "./components/patterns/ConfirmDialog";
import { ZoneEditor } from "./ZoneEditor";
import { ZoneMap, type ZoneMapZone, zoneMapProviderName } from "./ZoneMap";
import { zoneColors } from "./theme";
import { Badge, Button, IconButton, Section, Select } from "./ui";

type StatusFilter = "all" | "active" | "inactive";

type ZoneDraft = {
  color: string;
  delivery_minutes: string;
  delivery_price_rub: string;
  free_delivery_from_rub: string;
  is_active: boolean;
  min_order_rub: string;
  min_order_weekend_rub: string;
  name: string;
  restaurant_id: string;
  sort_order: string;
};

const ZONE_COLORS = ["#1E3A8A", "#0F766E", "#B45309", "#7E22CE", "#B91C1C", "#3F6212", "#C2410C", "#0369A1"];

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function toRub(kopecks: number | null): string {
  return kopecks === null ? "" : String(Math.round(kopecks / 100));
}

function rubToKopecks(value: string): number | null {
  return value.trim() === "" ? null : Number(value.replace(/\D/g, "") || 0) * 100;
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function toDraft(zone: Zone): ZoneDraft {
  return {
    color: zone.color,
    delivery_minutes: zone.delivery_minutes === null ? "" : String(zone.delivery_minutes),
    delivery_price_rub: toRub(zone.delivery_price_kopecks),
    free_delivery_from_rub: toRub(zone.free_delivery_from_kopecks),
    is_active: zone.is_active,
    min_order_rub: toRub(zone.min_order_kopecks),
    min_order_weekend_rub: toRub(zone.min_order_weekend_kopecks),
    name: zone.name,
    restaurant_id: zone.restaurant_id,
    sort_order: String(zone.sort_order),
  };
}

function zonePatch(draft: ZoneDraft) {
  return {
    color: draft.color,
    delivery_minutes: draft.delivery_minutes.trim() === "" ? null : Number(onlyDigits(draft.delivery_minutes)),
    delivery_price_kopecks: rubToKopecks(draft.delivery_price_rub) ?? 0,
    free_delivery_from_kopecks: rubToKopecks(draft.free_delivery_from_rub),
    is_active: draft.is_active,
    min_order_kopecks: rubToKopecks(draft.min_order_rub) ?? 0,
    min_order_weekend_kopecks: rubToKopecks(draft.min_order_weekend_rub),
    name: draft.name.trim(),
    restaurant_id: draft.restaurant_id,
    sort_order: Number(onlyDigits(draft.sort_order) || 0),
  };
}

function zoneColorKey(color: string): string {
  const index = ZONE_COLORS.indexOf(color.toUpperCase());
  return index >= 0 ? String(index) : "custom";
}

function money(value: number | null): string {
  return value === null ? "не задано" : formatPrice(value);
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

function ZoneBadge({ zone }: { zone: Zone }) {
  return zone.is_active ? <Badge text="работает" tone="ok" /> : <Badge text="выключена" tone="muted" />;
}

function ZoneMetric({
  icon: Icon,
  label,
  tone,
  value,
}: {
  icon: typeof MapPinned;
  label: string;
  tone?: "ok" | "warn" | "bad" | "muted";
  value: string;
}) {
  return (
    <div className="zone-metric" data-tone={tone}>
      <Icon size={17} aria-hidden />
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </div>
  );
}

function ZoneListCard({
  onSelect,
  selected,
  zone,
}: {
  onSelect: () => void;
  selected: boolean;
  zone: Zone;
}) {
  const style = { "--zone-color": zone.color } as CSSProperties;

  return (
    <button className="zone-list-card" data-active={selected} data-state={zone.is_active ? "active" : "inactive"} style={style} type="button" onClick={onSelect}>
      <span className="zone-color-dot" data-color-index={zoneColorKey(zone.color)} />
      <span className="zone-list-copy">
        <strong>{zone.name}</strong>
        <small>{zone.restaurant_name}</small>
      </span>
      <span className="zone-list-side">
        <ZoneBadge zone={zone} />
        <small>{zone.outline.length} точек</small>
      </span>
      <span className="zone-list-terms">
        <span>{formatPrice(zone.min_order_kopecks)} минимум</span>
        <span>{formatPrice(zone.delivery_price_kopecks)} доставка</span>
        <span>{zone.delivery_minutes ? `${zone.delivery_minutes} мин` : "время не задано"}</span>
      </span>
    </button>
  );
}

function ZoneFact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function ZoneDetailPanel({
  onCreate,
  onDelete,
  onEditContour,
  onSubmit,
  pending,
  restaurants,
  zone,
}: {
  onCreate: () => void;
  onDelete: (zone: Zone) => void;
  onEditContour: (zone: Zone) => void;
  onSubmit: (draft: ZoneDraft) => void;
  pending: boolean;
  restaurants: AdminRestaurant[];
  zone: Zone | null;
}) {
  const [draft, setDraft] = useState<ZoneDraft | null>(() => (zone ? toDraft(zone) : null));

  useEffect(() => {
    setDraft(zone ? toDraft(zone) : null);
  }, [zone]);

  if (!zone || !draft) {
    return (
      <aside className="zone-detail-panel zone-detail-empty">
        <div className="zone-detail-empty-icon">
          <MapPinned size={22} aria-hidden />
        </div>
        <h3>Зона не выбрана</h3>
        <p>Выберите зону из списка или создайте новый контур на карте.</p>
        <Button onClick={onCreate}>
          <Plus size={15} aria-hidden />
          Нарисовать зону
        </Button>
      </aside>
    );
  }

  const restaurant = restaurants.find((item) => item.id === draft.restaurant_id) ?? null;
  const style = { "--zone-color": draft.color } as CSSProperties;
  const canSave = draft.name.trim().length >= 2 && Boolean(draft.restaurant_id);

  const set = <K extends keyof ZoneDraft>(key: K, value: ZoneDraft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  return (
    <aside className="zone-detail-panel" style={style}>
      <header className="zone-detail-head">
        <div className="zone-detail-title">
          <span className="zone-detail-mark">
            <Route size={18} aria-hidden />
          </span>
          <div className="min-w-0">
            <h3>{zone.name}</h3>
            <p>{zone.restaurant_name}</p>
          </div>
        </div>
        <ZoneBadge zone={zone} />
      </header>

      <div className="zone-detail-facts">
        <ZoneFact label="Минимум" value={formatPrice(zone.min_order_kopecks)} />
        <ZoneFact label="Доставка" value={formatPrice(zone.delivery_price_kopecks)} />
        <ZoneFact label="Бесплатно от" value={money(zone.free_delivery_from_kopecks)} />
        <ZoneFact label="Время" value={zone.delivery_minutes ? `${zone.delivery_minutes} мин` : "не задано"} />
        <ZoneFact label="Пт-вс" value={money(zone.min_order_weekend_kopecks)} />
        <ZoneFact label="Порядок" value={String(zone.sort_order)} />
      </div>

      <div className="zone-detail-actions">
        <Button variant="ghost" onClick={() => onEditContour(zone)}>
          <MapPinned size={15} aria-hidden />
          Редактировать контур
        </Button>
        <IconButton label="Удалить зону" variant="danger" onClick={() => onDelete(zone)}>
          <Trash2 size={15} aria-hidden />
        </IconButton>
      </div>

      <section className="zone-detail-section">
        <div className="zone-detail-section-head">
          <strong>Параметры</strong>
          <span>{zone.outline.length} точек</span>
        </div>
        <div className="zone-form-grid">
          <label className="field zone-field-wide">
            <span className="field-label">Название</span>
            <input className="input" value={draft.name} onChange={(event) => set("name", event.target.value)} />
          </label>
          <div className="field zone-field-wide">
            <span className="field-label">Ресторан</span>
            <Select
              value={draft.restaurant_id}
              options={restaurants.map((item) => ({
                label: item.name,
                value: item.id,
                description: item.address,
              }))}
              onChange={(value) => set("restaurant_id", value)}
            />
          </div>
          <label className="field">
            <span className="field-label">Порядок</span>
            <input
              className="input"
              inputMode="numeric"
              value={draft.sort_order}
              onChange={(event) => set("sort_order", onlyDigits(event.target.value))}
            />
          </label>
          <label className="zone-toggle-card" data-active={draft.is_active}>
            <input
              checked={draft.is_active}
              type="checkbox"
              onChange={(event) => set("is_active", event.target.checked)}
            />
            <span className="zone-toggle-icon">{draft.is_active ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}</span>
            <span>
              <strong>{draft.is_active ? "Работает" : "Выключена"}</strong>
              <small>{draft.is_active ? "в расчете" : "без расчета"}</small>
            </span>
          </label>
        </div>

        <div className="zone-swatch-grid">
          {zoneColors.map((option) => (
            <button
              key={option}
              aria-label={`Цвет ${option}`}
              className="zone-swatch"
              data-active={option === draft.color}
              data-color-index={zoneColorKey(option)}
              type="button"
              onClick={() => set("color", option)}
            />
          ))}
        </div>
      </section>

      <section className="zone-detail-section">
        <div className="zone-detail-section-head">
          <strong>Условия</strong>
        </div>
        <div className="zone-form-grid">
          <label className="field">
            <span className="field-label">Доставка, ₽</span>
            <input
              className="input"
              inputMode="numeric"
              value={draft.delivery_price_rub}
              onChange={(event) => set("delivery_price_rub", onlyDigits(event.target.value))}
            />
          </label>
          <label className="field">
            <span className="field-label">Минимум, ₽</span>
            <input
              className="input"
              inputMode="numeric"
              value={draft.min_order_rub}
              onChange={(event) => set("min_order_rub", onlyDigits(event.target.value))}
            />
          </label>
          <label className="field">
            <span className="field-label">Минимум пт-вс, ₽</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="как в будни"
              value={draft.min_order_weekend_rub}
              onChange={(event) => set("min_order_weekend_rub", onlyDigits(event.target.value))}
            />
          </label>
          <label className="field">
            <span className="field-label">Бесплатно от, ₽</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="не задано"
              value={draft.free_delivery_from_rub}
              onChange={(event) => set("free_delivery_from_rub", onlyDigits(event.target.value))}
            />
          </label>
          <label className="field">
            <span className="field-label">Минут в пути</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="не задано"
              value={draft.delivery_minutes}
              onChange={(event) => set("delivery_minutes", onlyDigits(event.target.value))}
            />
          </label>
        </div>
      </section>

      <div className="zone-detail-foot">
        <Button disabled={pending || !canSave} onClick={() => onSubmit(draft)}>
          {pending ? "Сохраняем..." : "Сохранить условия"}
        </Button>
      </div>
    </aside>
  );
}

export function ZonesTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [restaurantId, setRestaurantId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingContour, setEditingContour] = useState<Zone | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Zone | null>(null);

  const zones = useQuery({ queryKey: ["zones"], queryFn: api.zones });
  const restaurants = useQuery({ queryKey: ["admin-restaurants"], queryFn: api.adminRestaurants });
  const cities = useQuery({ queryKey: ["cities"], queryFn: api.cities });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["zones"] });
  const allZones = zones.data ?? [];
  const allRestaurants = restaurants.data ?? [];

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return [...allZones]
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ru-RU"))
      .filter((zone) => {
        const text = `${zone.name} ${zone.restaurant_name}`.toLocaleLowerCase("ru-RU");
        const matchesStatus =
          status === "all" ||
          (status === "active" && zone.is_active) ||
          (status === "inactive" && !zone.is_active);
        return text.includes(needle) && (!restaurantId || zone.restaurant_id === restaurantId) && matchesStatus;
      });
  }, [allZones, restaurantId, search, status]);

  useEffect(() => {
    if (rows.length === 0) {
      if (selectedId && !allZones.some((zone) => zone.id === selectedId)) setSelectedId(null);
      return;
    }

    if (!selectedId || !rows.some((zone) => zone.id === selectedId)) {
      setSelectedId(rows[0].id);
    }
  }, [allZones, rows, selectedId]);

  const selected = selectedId ? allZones.find((zone) => zone.id === selectedId) ?? null : null;
  const selectedRestaurant = selected
    ? allRestaurants.find((restaurant) => restaurant.id === selected.restaurant_id) ?? null
    : restaurantId
      ? allRestaurants.find((restaurant) => restaurant.id === restaurantId) ?? null
      : allRestaurants[0] ?? null;
  const active = allZones.filter((zone) => zone.is_active).length;
  const restaurantsWithZones = new Set(allZones.map((zone) => zone.restaurant_id)).size;
  const freeDelivery = allZones.filter((zone) => zone.free_delivery_from_kopecks !== null).length;
  const points = allZones.reduce((sum, zone) => sum + zone.outline.length, 0);
  const mapZones = rows.map(zoneMap);

  const save = useMutation({
    mutationFn: ({ draft, id }: { draft: ZoneDraft; id: string }) => api.updateZone(id, zonePatch(draft)),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (zone) => {
      setSelectedId(zone.id);
      refresh();
      toast.success("Зона сохранена");
    },
  });

  const remove = useMutation({
    mutationFn: api.deleteZone,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      setDeleteTarget(null);
      setSelectedId(rows.find((zone) => zone.id !== deleteTarget?.id)?.id ?? null);
      refresh();
      toast.success("Зона удалена");
    },
  });

  return (
    <Section
      className="zones-page"
      title="Зоны доставки"
      action={
        <Button disabled={allRestaurants.length === 0} onClick={() => setEditingContour("new")}>
          <Plus size={15} aria-hidden />
          Нарисовать зону
        </Button>
      }
      description="Контуры, ресторан-исполнитель, минимальная сумма, стоимость доставки и порядок применения."
    >
      <div className="zones-summary">
        <ZoneMetric icon={MapPinned} label="зон всего" value={zones.isPending ? "..." : String(allZones.length)} />
        <ZoneMetric icon={Route} label="активны" tone="ok" value={zones.isPending ? "..." : `${active}/${allZones.length}`} />
        <ZoneMetric icon={Store} label="ресторанов" value={zones.isPending ? "..." : String(restaurantsWithZones)} />
        <ZoneMetric icon={Banknote} label="бесплатный порог" value={zones.isPending ? "..." : String(freeDelivery)} />
      </div>

      <div className="zones-workbench">
        <aside className="zones-list-panel">
          <div className="zones-list-head">
            <div>
              <h3>Список зон</h3>
              <p>{rows.length} показано</p>
            </div>
            <IconButton label="Создать зону" size="sm" onClick={() => setEditingContour("new")}>
              <Plus size={15} aria-hidden />
            </IconButton>
          </div>

          <div className="zones-filters">
            <label className="field">
              <span className="field-label">Поиск</span>
              <span className="search-control">
                <Search className="search-icon" size={15} aria-hidden />
                <input
                  className="input"
                  placeholder="Зона или ресторан"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </span>
            </label>
            <div className="field">
              <span className="field-label">Ресторан</span>
              <Select
                value={restaurantId}
                options={[
                  { label: "Все рестораны", value: "" },
                  ...allRestaurants.map((restaurant) => ({
                    label: restaurant.name,
                    value: restaurant.id,
                    description: restaurant.address,
                  })),
                ]}
                onChange={setRestaurantId}
              />
            </div>
            <div className="filter-chips" aria-label="Статус зон">
              <button className="filter-chip" data-active={status === "all"} type="button" onClick={() => setStatus("all")}>
                Все
              </button>
              <button className="filter-chip" data-active={status === "active"} type="button" onClick={() => setStatus("active")}>
                Работают
              </button>
              <button className="filter-chip" data-active={status === "inactive"} type="button" onClick={() => setStatus("inactive")}>
                Выключены
              </button>
            </div>
          </div>

          <div className="zones-list">
            {rows.map((zone) => (
              <ZoneListCard
                key={zone.id}
                selected={zone.id === selectedId}
                zone={zone}
                onSelect={() => setSelectedId(zone.id)}
              />
            ))}
            {rows.length === 0 ? (
              <div className="zones-empty-list">
                <Settings2 size={18} aria-hidden />
                <strong>Ничего не найдено</strong>
                <span>Сбросьте фильтр или нарисуйте новую зону.</span>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="zones-map-panel">
          <header className="zones-map-head">
            <div>
              <h3>Карта покрытия</h3>
              <p>{points} точек в контурах</p>
            </div>
            <div className="zones-map-legend">
              <span>
                <MapPinned size={14} aria-hidden />
                {zoneMapProviderName}
              </span>
              <span>
                <Eye size={14} aria-hidden />
                {active} работают
              </span>
              <span>
                <Clock3 size={14} aria-hidden />
                порядок решает пересечения
              </span>
            </div>
          </header>

          <ZoneMap
            activeZoneId={selectedId}
            center={selectedRestaurant}
            color={selected?.color ?? ZONE_COLORS[0]}
            outline={selected?.outline ?? []}
            zones={mapZones}
            onZoneClick={setSelectedId}
          />
        </section>

        <ZoneDetailPanel
          pending={save.isPending}
          restaurants={allRestaurants}
          zone={selected}
          onCreate={() => setEditingContour("new")}
          onDelete={setDeleteTarget}
          onEditContour={setEditingContour}
          onSubmit={(draft) => {
            if (!selected) return;
            save.mutate({ draft, id: selected.id });
          }}
        />
      </div>

      {zones.error ? (
        <div className="error-state">
          <h2>Не удалось загрузить зоны</h2>
          <p>{errorMessage(zones.error)}</p>
        </div>
      ) : null}

      {editingContour ? (
        <ZoneEditor
          cities={cities.data ?? []}
          restaurants={allRestaurants}
          zone={editingContour === "new" ? null : editingContour}
          zones={allZones}
          onClose={() => setEditingContour(null)}
          onSaved={(zone) => {
            setEditingContour(null);
            setSelectedId(zone.id);
            refresh();
          }}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          busy={remove.isPending}
          message={`Удалить зону «${deleteTarget.name}»?`}
          title="Удалить зону"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => remove.mutate(deleteTarget.id)}
        />
      ) : null}
    </Section>
  );
}
