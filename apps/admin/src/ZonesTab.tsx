import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, Eye, EyeOff, Map, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  formatPrice,
  type AdminRestaurant,
  type City,
  type Zone,
} from "./api";
import { ConfirmDialog } from "./components/patterns/ConfirmDialog";
import { DataTable, DensityToggle, createAdminColumnHelper, useTableDensity } from "./components/patterns/DataTable";
import { DetailDrawer } from "./components/patterns/DetailDrawer";
import { ZoneEditor } from "./ZoneEditor";
import { Badge, Button, IconButton, Section, Select } from "./ui";

type StatusFilter = "all" | "active" | "inactive";

type ZoneDraft = {
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

const column = createAdminColumnHelper<Zone>();
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

function toDraft(zone: Zone): ZoneDraft {
  return {
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
    delivery_minutes: draft.delivery_minutes.trim() === "" ? null : Number(draft.delivery_minutes.replace(/\D/g, "")),
    delivery_price_kopecks: rubToKopecks(draft.delivery_price_rub) ?? 0,
    free_delivery_from_kopecks: rubToKopecks(draft.free_delivery_from_rub),
    is_active: draft.is_active,
    min_order_kopecks: rubToKopecks(draft.min_order_rub) ?? 0,
    min_order_weekend_kopecks: rubToKopecks(draft.min_order_weekend_rub),
    name: draft.name.trim(),
    restaurant_id: draft.restaurant_id,
    sort_order: Number(draft.sort_order.replace(/\D/g, "") || 0),
  };
}

function zoneColorKey(color: string): string {
  const index = ZONE_COLORS.indexOf(color.toUpperCase());
  return index >= 0 ? String(index) : "custom";
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

function ZoneBadge({ zone }: { zone: Zone }) {
  return zone.is_active ? <Badge text="работает" tone="ok" /> : <Badge text="выключена" tone="muted" />;
}

function ZoneSettingsDrawer({
  onClose,
  onSubmit,
  pending,
  restaurants,
  zone,
}: {
  onClose: () => void;
  onSubmit: (draft: ZoneDraft) => void;
  pending: boolean;
  restaurants: AdminRestaurant[];
  zone: Zone;
}) {
  const [draft, setDraft] = useState<ZoneDraft>(() => toDraft(zone));

  useEffect(() => {
    setDraft(toDraft(zone));
  }, [zone]);

  const set = <K extends keyof ZoneDraft>(key: K, value: ZoneDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <DetailDrawer
      badge={<ZoneBadge zone={zone} />}
      footer={
        <>
          <Button disabled={pending} variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={pending || draft.name.trim().length < 2} onClick={() => onSubmit(draft)}>
            {pending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </>
      }
      subtitle={`${zone.outline.length} точек контура · ${zone.restaurant_name}`}
      title={zone.name}
      onClose={onClose}
    >
      <div className="drawer-form">
        <section className="drawer-section">
          <h3 className="drawer-section-title">Основное</h3>
          <div className="drawer-form-grid">
            <label className="field" data-wide="true">
              <span className="field-label">Название</span>
              <input className="input" value={draft.name} onChange={(event) => set("name", event.target.value)} />
            </label>
            <div className="field">
              <span className="field-label">Ресторан</span>
              <Select
                value={draft.restaurant_id}
                options={restaurants.map((restaurant) => ({ label: restaurant.name, value: restaurant.id }))}
                onChange={(value) => set("restaurant_id", value)}
              />
            </div>
            <label className="field">
              <span className="field-label">Порядок</span>
              <input
                className="input"
                inputMode="numeric"
                value={draft.sort_order}
                onChange={(event) => set("sort_order", event.target.value.replace(/\D/g, ""))}
              />
            </label>
            <label className="inline-check">
              <input
                checked={draft.is_active}
                type="checkbox"
                onChange={(event) => set("is_active", event.target.checked)}
              />
              Зона работает
            </label>
          </div>
        </section>

        <section className="drawer-section">
          <h3 className="drawer-section-title">Условия доставки</h3>
          <div className="drawer-form-grid">
            <label className="field">
              <span className="field-label">Доставка, ₽</span>
              <input
                className="input"
                inputMode="numeric"
                value={draft.delivery_price_rub}
                onChange={(event) => set("delivery_price_rub", event.target.value.replace(/\D/g, ""))}
              />
            </label>
            <label className="field">
              <span className="field-label">Минимум, ₽</span>
              <input
                className="input"
                inputMode="numeric"
                value={draft.min_order_rub}
                onChange={(event) => set("min_order_rub", event.target.value.replace(/\D/g, ""))}
              />
            </label>
            <label className="field">
              <span className="field-label">Минимум пт-вс, ₽</span>
              <input
                className="input"
                inputMode="numeric"
                placeholder="как в будни"
                value={draft.min_order_weekend_rub}
                onChange={(event) => set("min_order_weekend_rub", event.target.value.replace(/\D/g, ""))}
              />
            </label>
            <label className="field">
              <span className="field-label">Бесплатно от, ₽</span>
              <input
                className="input"
                inputMode="numeric"
                placeholder="не задано"
                value={draft.free_delivery_from_rub}
                onChange={(event) => set("free_delivery_from_rub", event.target.value.replace(/\D/g, ""))}
              />
            </label>
            <label className="field">
              <span className="field-label">Минут в пути</span>
              <input
                className="input"
                inputMode="numeric"
                placeholder="не задано"
                value={draft.delivery_minutes}
                onChange={(event) => set("delivery_minutes", event.target.value.replace(/\D/g, ""))}
              />
            </label>
          </div>
        </section>

        <div className="info-band">
          Если зоны накладываются, порядок в списке решает, какая зона сработает для адреса гостя.
        </div>
      </div>
    </DetailDrawer>
  );
}

export function ZonesTab() {
  const queryClient = useQueryClient();
  const [density, setDensity] = useTableDensity();
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

  const save = useMutation({
    mutationFn: ({ draft, id }: { draft: ZoneDraft; id: string }) => api.updateZone(id, zonePatch(draft)),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (zone) => {
      setSelectedId(zone.id);
      refresh();
      toast.success("Зона сохранена");
    },
  });

  const toggle = useMutation({
    mutationFn: (zone: Zone) => api.updateZone(zone.id, { is_active: !zone.is_active }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: api.deleteZone,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      setDeleteTarget(null);
      setSelectedId(null);
      refresh();
      toast.success("Зона удалена");
    },
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return [...(zones.data ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ru-RU"))
      .filter((zone) => {
        const text = `${zone.name} ${zone.restaurant_name}`.toLocaleLowerCase("ru-RU");
        const matchesStatus =
          status === "all" ||
          (status === "active" && zone.is_active) ||
          (status === "inactive" && !zone.is_active);
        return text.includes(needle) && (!restaurantId || zone.restaurant_id === restaurantId) && matchesStatus;
      });
  }, [restaurantId, search, status, zones.data]);

  const allZones = zones.data ?? [];
  const isLoadingZones = zones.isPending;
  const selected = selectedId ? allZones.find((zone) => zone.id === selectedId) ?? null : null;
  const active = allZones.filter((zone) => zone.is_active).length;
  const avgMin =
    allZones.length > 0
      ? Math.round(allZones.reduce((sum, zone) => sum + zone.min_order_kopecks, 0) / allZones.length)
      : 0;
  const freeDelivery = allZones.filter((zone) => zone.free_delivery_from_kopecks !== null).length;

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("name", {
          header: "Зона",
          cell: (info) => {
            const zone = info.row.original;
            return (
              <div className="zone-name-cell">
                <span className="zone-color-dot" data-color-index={zoneColorKey(zone.color)} title={zone.color} />
                <div className="min-w-0">
                  <div className="row-main">{info.getValue()}</div>
                  <div className="row-sub">{zone.outline.length} точек контура</div>
                </div>
              </div>
            );
          },
        }),
        column.accessor("restaurant_name", {
          header: "Ресторан",
          cell: (info) => info.getValue(),
        }),
        column.display({
          id: "terms",
          header: "Условия",
          cell: (info) => {
            const zone = info.row.original;
            return (
              <div>
                <div className="row-main">
                  доставка {formatPrice(zone.delivery_price_kopecks)} · минимум {formatPrice(zone.min_order_kopecks)}
                </div>
                <div className="row-sub">
                  {zone.min_order_weekend_kopecks ? `пт-вс ${formatPrice(zone.min_order_weekend_kopecks)} · ` : ""}
                  {zone.free_delivery_from_kopecks
                    ? `бесплатно от ${formatPrice(zone.free_delivery_from_kopecks)}`
                    : "бесплатный порог не задан"}
                </div>
              </div>
            );
          },
        }),
        column.accessor("delivery_minutes", {
          header: "Время",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => (info.getValue() ? <span className="mono">{info.getValue()} мин</span> : <span className="row-muted">—</span>),
        }),
        column.accessor("is_active", {
          header: "Статус",
          cell: (info) => <ZoneBadge zone={info.row.original} />,
        }),
        column.display({
          id: "actions",
          header: "",
          meta: { align: "right" },
          cell: (info) => {
            const zone = info.row.original;
            return (
              <div className="cell-actions">
                <IconButton
                  label="Править условия"
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedId(zone.id);
                  }}
                >
                  <Edit3 size={14} aria-hidden />
                </IconButton>
                <IconButton
                  label="Контур"
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingContour(zone);
                  }}
                >
                  <Map size={14} aria-hidden />
                </IconButton>
                <IconButton
                  label={zone.is_active ? "Выключить" : "Включить"}
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle.mutate(zone);
                  }}
                >
                  {zone.is_active ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                </IconButton>
                <IconButton
                  label="Удалить"
                  size="xs"
                  variant="danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDeleteTarget(zone);
                  }}
                >
                  <Trash2 size={14} aria-hidden />
                </IconButton>
              </div>
            );
          },
        }),
      ]),
    [toggle],
  );

  return (
    <Section
      title="Зоны доставки"
      action={
        <Button
          disabled={(restaurants.data ?? []).length === 0}
          onClick={() => setEditingContour("new")}
        >
          <Plus size={15} aria-hidden />
          Нарисовать зону
        </Button>
      }
      description="Контуры доставки, ресторан-исполнитель, минимумы, стоимость и порядок выбора зоны."
    >
      <div className="metric-strip">
        <Metric label="Зон" note="контуров доставки" value={isLoadingZones ? "..." : String(allZones.length)} />
        <Metric label="Работают" note="участвуют в расчёте" value={isLoadingZones ? "..." : String(active)} />
        <Metric label="Средний минимум" note="по всем зонам" value={isLoadingZones ? "..." : allZones.length ? formatPrice(avgMin) : "—"} />
        <Metric label="Бесплатный порог" note="настроен" value={isLoadingZones ? "..." : String(freeDelivery)} />
      </div>

      <div className="info-band">
        Адрес гостя проверяется по контуру зоны. Условия доставки берутся отсюда, а не из карточки ресторана.
      </div>

      <div className="surface-toolbar">
        <label className="field toolbar-field">
          <span className="field-label">Поиск</span>
          <span className="search-control">
            <Search className="search-icon" size={15} aria-hidden />
            <input
              className="input"
              placeholder="Поиск зоны"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </span>
        </label>
        <div className="field toolbar-field">
          <span className="field-label">Ресторан</span>
          <Select
            value={restaurantId}
            options={[
              { label: "Все рестораны", value: "" },
              ...(restaurants.data ?? []).map((restaurant) => ({ label: restaurant.name, value: restaurant.id })),
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
        <span className="toolbar-spacer" />
        <DensityToggle density={density} onChange={setDensity} />
      </div>

      {zones.error ? (
        <div className="error-state">
          <h2>Не удалось загрузить зоны</h2>
          <p>{errorMessage(zones.error)}</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          density={density}
          getRowId={(row) => row.id}
          isLoading={zones.isPending}
          onRowClick={(zone) => setSelectedId(zone.id)}
          pageSize={20}
          selectedId={selectedId}
          empty={
            <div className="empty-state">
              <h2>Зон пока нет</h2>
              <p>Нарисуйте первую зону на карте или импортируйте существующие контуры.</p>
            </div>
          }
        />
      )}

      {selected ? (
        <ZoneSettingsDrawer
          pending={save.isPending}
          restaurants={restaurants.data ?? []}
          zone={selected}
          onClose={() => setSelectedId(null)}
          onSubmit={(draft) => save.mutate({ draft, id: selected.id })}
        />
      ) : null}

      {editingContour ? (
        <ZoneEditor
          cities={cities.data ?? []}
          restaurants={restaurants.data ?? []}
          zone={editingContour === "new" ? null : editingContour}
          onClose={() => setEditingContour(null)}
          onSaved={() => {
            setEditingContour(null);
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
