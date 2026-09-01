import {
  CheckCircle2,
  Eye,
  EyeOff,
  LocateFixed,
  MapPinned,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";

import { api, ApiError, type AdminRestaurant, type City, type Zone } from "./api";
import { ZoneMap, type ZoneMapHandle, type ZoneMapZone } from "./ZoneMap";
import { zoneColors } from "./theme";
import { Badge, Button, IconButton, Select } from "./ui";

type Point = [number, number];

type ZoneEditorDraft = {
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

type Props = {
  cities: City[];
  initialRestaurantId?: string;
  onClose: () => void;
  onSaved: (zone: Zone) => void;
  restaurants: AdminRestaurant[];
  zone: Zone | null;
  zones?: Zone[];
};

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Не удалось сохранить зону";
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

function colorIndex(color: string): number {
  return Math.max(zoneColors.findIndex((option) => option.toUpperCase() === color.toUpperCase()), 0);
}

function nextSortOrder(zones: Zone[]): number {
  return zones.length === 0 ? 0 : Math.max(...zones.map((item) => item.sort_order)) + 10;
}

function toDraft(
  zone: Zone | null,
  restaurants: AdminRestaurant[],
  zones: Zone[],
  initialRestaurantId?: string,
): ZoneEditorDraft {
  return {
    color: zone?.color ?? zoneColors[zones.length % zoneColors.length] ?? zoneColors[0],
    delivery_minutes: zone?.delivery_minutes === null || zone?.delivery_minutes === undefined ? "" : String(zone.delivery_minutes),
    delivery_price_rub: toRub(zone?.delivery_price_kopecks ?? 0),
    free_delivery_from_rub: toRub(zone?.free_delivery_from_kopecks ?? null),
    is_active: zone?.is_active ?? true,
    min_order_rub: toRub(zone?.min_order_kopecks ?? 0),
    min_order_weekend_rub: toRub(zone?.min_order_weekend_kopecks ?? null),
    name: zone?.name ?? "",
    restaurant_id: zone?.restaurant_id ?? initialRestaurantId ?? restaurants[0]?.id ?? "",
    sort_order: String(zone?.sort_order ?? nextSortOrder(zones)),
  };
}

function starterContour(center: { latitude: number; longitude: number } | null): Point[] {
  const latitude = center?.latitude ?? 59.94;
  const longitude = center?.longitude ?? 30.31;
  const lat = 0.018;
  const lng = 0.03;

  return [
    [longitude - lng, latitude - lat * 0.65],
    [longitude - lng * 0.35, latitude - lat],
    [longitude + lng * 0.35, latitude - lat],
    [longitude + lng, latitude - lat * 0.65],
    [longitude + lng * 1.1, latitude],
    [longitude + lng, latitude + lat * 0.65],
    [longitude + lng * 0.35, latitude + lat],
    [longitude - lng * 0.35, latitude + lat],
    [longitude - lng, latitude + lat * 0.65],
    [longitude - lng * 1.1, latitude],
  ].map((point) => [Number(point[0].toFixed(6)), Number(point[1].toFixed(6))] as Point);
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

function sameOutline(left: Point[], right: Point[]): boolean {
  return (
    left.length === right.length &&
    left.every((point, index) => point[0] === right[index]?.[0] && point[1] === right[index]?.[1])
  );
}

export function ZoneEditor({ zone, restaurants, cities, initialRestaurantId, zones = [], onClose, onSaved }: Props) {
  const mapRef = useRef<ZoneMapHandle>(null);
  const [draft, setDraft] = useState<ZoneEditorDraft>(() => toDraft(zone, restaurants, zones, initialRestaurantId));
  const [outline, setOutline] = useState<Point[]>((zone?.outline as Point[]) ?? []);
  const [history, setHistory] = useState<Point[][]>([]);
  const [future, setFuture] = useState<Point[][]>([]);
  const outlineRef = useRef(outline);
  const historyRef = useRef(history);
  const futureRef = useRef(future);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [snapToAxes, setSnapToAxes] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const initialOutline = (zone?.outline as Point[]) ?? [];

    setDraft(toDraft(zone, restaurants, zones, initialRestaurantId));
    setOutline(initialOutline);
    setHistory([]);
    setFuture([]);
    outlineRef.current = initialOutline;
    historyRef.current = [];
    futureRef.current = [];
    setSelectedPointIndex(null);
    setFailure(null);
  }, [initialRestaurantId, restaurants, zone, zones]);

  const restaurant = restaurants.find((item) => item.id === draft.restaurant_id) ?? null;
  const backgroundZones = useMemo(() => zones.filter((item) => item.id !== zone?.id).map(zoneMap), [zone?.id, zones]);
  const selectedPoint = selectedPointIndex === null ? null : outline[selectedPointIndex] ?? null;
  const zoneStyle = { "--zone-color": draft.color } as CSSProperties;
  const canSave = outline.length >= 3 && draft.name.trim().length >= 2 && Boolean(draft.restaurant_id);

  const set = <K extends keyof ZoneEditorDraft>(key: K, value: ZoneEditorDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const commitOutline = useCallback((next: Point[]) => {
    const current = outlineRef.current;
    if (sameOutline(current, next)) return;

    const nextHistory = [current, ...historyRef.current].slice(0, 40);

    outlineRef.current = next;
    historyRef.current = nextHistory;
    futureRef.current = [];
    setOutline(next);
    setHistory(nextHistory);
    setFuture([]);
    setSelectedPointIndex((current) => (current !== null && current >= next.length ? null : current));
  }, []);

  const undo = useCallback(() => {
    const [previous, ...rest] = historyRef.current;
    if (!previous) return;

    const nextFuture = [outlineRef.current, ...futureRef.current].slice(0, 40);

    outlineRef.current = previous;
    historyRef.current = rest;
    futureRef.current = nextFuture;
    setOutline(previous);
    setHistory(rest);
    setFuture(nextFuture);
    setSelectedPointIndex(null);
  }, []);

  const redo = useCallback(() => {
    const [next, ...rest] = futureRef.current;
    if (!next) return;

    const nextHistory = [outlineRef.current, ...historyRef.current].slice(0, 40);

    outlineRef.current = next;
    historyRef.current = nextHistory;
    futureRef.current = rest;
    setOutline(next);
    setHistory(nextHistory);
    setFuture(rest);
    setSelectedPointIndex(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isTyping =
        target?.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
      if (isTyping) return;

      const key = event.key.toLocaleLowerCase("ru-RU");
      const command = event.metaKey || event.ctrlKey;
      if (!command) return;

      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }

      if (key === "y" && event.ctrlKey) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [redo, undo]);

  const createStarter = () => {
    const next = starterContour(restaurant);
    commitOutline(next);
    setSelectedPointIndex(0);
    window.setTimeout(() => mapRef.current?.fitCurrent(), 60);
  };

  const removeSelectedPoint = () => {
    if (selectedPointIndex === null || outline.length <= 3) return;
    commitOutline(outline.filter((_, index) => index !== selectedPointIndex));
    setSelectedPointIndex(null);
  };

  const save = async () => {
    if (!canSave) {
      setFailure("Заполните название, ресторан и минимум три точки контура");
      return;
    }

    const cityId = restaurant?.city_id ?? cities[0]?.id ?? "";
    if (!cityId) {
      setFailure("Не удалось определить город для зоны");
      return;
    }

    setBusy(true);
    setFailure(null);

    const payload = {
      color: draft.color,
      delivery_minutes: draft.delivery_minutes.trim() === "" ? null : Number(onlyDigits(draft.delivery_minutes)),
      delivery_price_kopecks: rubToKopecks(draft.delivery_price_rub) ?? 0,
      free_delivery_from_kopecks: rubToKopecks(draft.free_delivery_from_rub),
      min_order_kopecks: rubToKopecks(draft.min_order_rub) ?? 0,
      min_order_weekend_kopecks: rubToKopecks(draft.min_order_weekend_rub),
      name: draft.name.trim(),
      outline,
      restaurant_id: draft.restaurant_id,
      sort_order: Number(onlyDigits(draft.sort_order) || 0),
    };

    try {
      const saved = zone
        ? await api.updateZone(zone.id, { ...payload, is_active: draft.is_active })
        : await api.createZone({ ...payload, city_id: cityId });

      toast.success(zone ? "Зона обновлена" : "Зона создана");
      onSaved(saved);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="drawer-overlay zone-editor-overlay" onClick={onClose} />
      <aside className="zone-editor-shell" aria-label={zone ? "Редактор зоны доставки" : "Новая зона доставки"}>
        <header className="zone-editor-topbar">
          <div className="zone-editor-title-block">
            <span className="zone-editor-mark" style={zoneStyle}>
              <MapPinned size={20} aria-hidden />
            </span>
            <div className="min-w-0">
              <h2>{zone ? zone.name : "Новая зона доставки"}</h2>
              <div className="zone-editor-subline">
                <span>{outline.length} точек</span>
                <span>{restaurant?.name ?? "ресторан не выбран"}</span>
                {draft.is_active ? <Badge text="работает" tone="ok" /> : <Badge text="выключена" tone="muted" />}
              </div>
            </div>
          </div>
          <span className="toolbar-spacer" />
          <div className="zone-editor-top-actions">
            <Button className="zone-editor-close-text" disabled={busy} variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
            <Button disabled={busy || !canSave} onClick={() => void save()}>
              <Save size={15} aria-hidden />
              {busy ? "Сохраняем..." : "Сохранить"}
            </Button>
            <IconButton label="Закрыть" size="sm" variant="quiet" onClick={onClose}>
              <X size={16} aria-hidden />
            </IconButton>
          </div>
        </header>

        <div className="zone-editor-workspace">
          <section className="zone-editor-map-panel">
            <div className="zone-editor-map-toolbar">
              <Button variant="ghost" onClick={createStarter}>
                <Plus size={15} aria-hidden />
                Стартовый контур
              </Button>
              <Button disabled={history.length === 0} variant="ghost" onClick={undo}>
                <Undo2 size={15} aria-hidden />
                Отменить
              </Button>
              <Button disabled={future.length === 0} variant="ghost" onClick={redo}>
                <Redo2 size={15} aria-hidden />
                Вернуть
              </Button>
              <Button disabled={outline.length === 0} variant="ghost" onClick={() => mapRef.current?.fitCurrent()}>
                <LocateFixed size={15} aria-hidden />
                Показать контур
              </Button>
              <button className="filter-chip" data-active={snapToAxes} type="button" onClick={() => setSnapToAxes((value) => !value)}>
                Ровные углы
              </button>
              <span className="toolbar-spacer" />
              <Button
                disabled={outline.length === 0}
                variant="ghost"
                onClick={() => {
                  commitOutline([]);
                  setSelectedPointIndex(null);
                }}
              >
                <RotateCcw size={15} aria-hidden />
                Очистить
              </Button>
            </div>

            <ZoneMap
              ref={mapRef}
              center={restaurant}
              color={draft.color}
              editable
              outline={outline}
              selectedPointIndex={selectedPointIndex}
              snapToAxes={snapToAxes}
              zones={backgroundZones}
              onChange={commitOutline}
              onSelectPoint={setSelectedPointIndex}
            />
          </section>

          <aside className="zone-editor-panel">
            <section className="zone-editor-section">
              <div className="zone-editor-section-head">
                <strong>Паспорт зоны</strong>
                <CheckCircle2 size={16} aria-hidden />
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
                    <strong>{draft.is_active ? "Зона работает" : "Зона выключена"}</strong>
                    <small>{draft.is_active ? "участвует в расчете" : "не участвует в расчете"}</small>
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
                    data-color-index={colorIndex(option)}
                    type="button"
                    onClick={() => set("color", option)}
                  />
                ))}
              </div>
            </section>

            <section className="zone-editor-section">
              <div className="zone-editor-section-head">
                <strong>Условия доставки</strong>
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

            <section className="zone-editor-section">
              <div className="zone-editor-section-head">
                <strong>Точки контура</strong>
                <span className="zone-point-count">{outline.length}</span>
              </div>

              {selectedPoint ? (
                <div className="zone-selected-point">
                  <span>#{(selectedPointIndex ?? 0) + 1}</span>
                  <strong>{selectedPoint[1].toFixed(6)}</strong>
                  <strong>{selectedPoint[0].toFixed(6)}</strong>
                  <IconButton
                    disabled={outline.length <= 3}
                    label="Удалить точку"
                    size="xs"
                    variant="danger"
                    onClick={removeSelectedPoint}
                  >
                    <Trash2 size={14} aria-hidden />
                  </IconButton>
                </div>
              ) : null}

              <div className="zone-point-list">
                {outline.length > 0 ? (
                  <div className="zone-point-row zone-point-row-head" aria-hidden>
                    <span>точка</span>
                    <strong>широта</strong>
                    <strong>долгота</strong>
                  </div>
                ) : null}
                {outline.map((point, index) => (
                  <button
                    key={`${point[0]}-${point[1]}-${index}`}
                    className="zone-point-row"
                    data-active={selectedPointIndex === index}
                    type="button"
                    onClick={() => setSelectedPointIndex(index)}
                  >
                    <span>#{index + 1}</span>
                    <strong>{point[1].toFixed(5)}</strong>
                    <strong>{point[0].toFixed(5)}</strong>
                  </button>
                ))}
                {outline.length === 0 ? <div className="zone-empty-note">Контур еще не задан</div> : null}
              </div>
            </section>

            {failure ? <div className="form-error">{failure}</div> : null}
          </aside>
        </div>
      </aside>
    </>
  );
}
