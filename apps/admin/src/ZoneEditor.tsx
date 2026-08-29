import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api, ApiError, type AdminRestaurant, type City, type Zone } from "./api";
import { ZoneMap } from "./ZoneMap";
import { zoneColors } from "./theme";
import { Button, Select } from "./ui";

type Point = [number, number];

type Props = {
  cities: City[];
  onClose: () => void;
  onSaved: () => void;
  restaurants: AdminRestaurant[];
  zone: Zone | null;
};

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Не удалось сохранить зону";
}

function colorIndex(color: string): number {
  return Math.max(zoneColors.findIndex((option) => option.toUpperCase() === color.toUpperCase()), 0);
}

export function ZoneEditor({ zone, restaurants, cities, onClose, onSaved }: Props) {
  const [outline, setOutline] = useState<Point[]>((zone?.outline as Point[]) ?? []);
  const [name, setName] = useState(zone?.name ?? "");
  const [restaurantId, setRestaurantId] = useState(zone?.restaurant_id ?? restaurants[0]?.id ?? "");
  const [color, setColor] = useState(zone?.color ?? zoneColors[0]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    setOutline((zone?.outline as Point[]) ?? []);
    setName(zone?.name ?? "");
    setRestaurantId(zone?.restaurant_id ?? restaurants[0]?.id ?? "");
    setColor(zone?.color ?? zoneColors[0]);
  }, [restaurants, zone]);

  const restaurant = restaurants.find((item) => item.id === restaurantId) ?? null;

  const save = async () => {
    if (outline.length < 3) {
      setFailure("В контуре нужно хотя бы три точки");
      return;
    }
    if (name.trim().length < 2) {
      setFailure("У зоны должно быть название");
      return;
    }
    if (!restaurantId) {
      setFailure("Выберите ресторан");
      return;
    }

    setBusy(true);
    setFailure(null);

    try {
      if (zone) {
        await api.updateZone(zone.id, { color, name: name.trim(), outline, restaurant_id: restaurantId });
      } else {
        await api.createZone({
          city_id: restaurant?.city_id ?? cities[0]?.id ?? "",
          color,
          delivery_minutes: null,
          delivery_price_kopecks: 0,
          min_order_kopecks: 0,
          name: name.trim(),
          outline,
          restaurant_id: restaurantId,
        });
      }

      toast.success("Контур сохранён");
      onSaved();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="command-overlay" onClick={onClose} />
      <section aria-modal="true" className="zone-editor-dialog" role="dialog">
        <div className="zone-editor-head">
          <div>
            <h2 className="drawer-title">{zone ? "Контур зоны" : "Новая зона"}</h2>
            <div className="row-sub">
              {outline.length} точек · обслуживает {restaurant?.name ?? "ресторан не выбран"}
            </div>
          </div>
          <span className="toolbar-spacer" />
          <Button disabled={busy} variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Сохраняем..." : "Сохранить"}
          </Button>
        </div>

        <div className="zone-editor-body">
          <ZoneMap center={restaurant} color={color} outline={outline} onChange={setOutline} />

          <aside className="zone-editor-side">
            <label className="field">
              <span className="field-label">Название</span>
              <input
                className="input"
                placeholder="Например, Петергоф и Стрельна"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>

            <div className="field">
              <span className="field-label">Ресторан</span>
              <Select
                value={restaurantId}
                options={restaurants.map((item) => ({ label: item.name, value: item.id }))}
                onChange={setRestaurantId}
              />
            </div>

            <div className="field">
              <span className="field-label">Цвет на карте</span>
              <div className="zone-swatch-grid">
                {zoneColors.map((option) => (
                  <button
                    key={option}
                    aria-label={`Цвет ${option}`}
                    className="zone-swatch"
                    data-active={option === color}
                    data-color-index={colorIndex(option)}
                    type="button"
                    onClick={() => setColor(option)}
                  />
                ))}
              </div>
            </div>

            <div className="info-band">
              Контур замыкается сам. Двойной клик добавляет точку, перетаскивание двигает её,
              клик по точке удаляет.
            </div>

            {failure ? <div className="form-error">{failure}</div> : null}
          </aside>
        </div>
      </section>
    </>
  );
}
