import { useEffect, useState } from "react";

import { api, ApiError, type AdminRestaurant, type City, type Zone } from "./api";
import { ZoneMap } from "./ZoneMap";
import { zoneColors } from "./theme";
import { Button, c, radius, spacing, styles, typography } from "./ui";

type Point = [number, number];

type Props = {
  /** Зона на правку или null, если рисуем новую. */
  zone: Zone | null;
  restaurants: AdminRestaurant[];
  cities: City[];
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Окно правки зоны: слева карта с контуром, справа — к какому ресторану зона
 * относится и как называется. Всё остальное (цены, минимумы) правится прямо
 * в таблице, здесь только то, ради чего открывали карту.
 */
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
  }, [zone, restaurants]);

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

    setBusy(true);
    setFailure(null);

    try {
      if (zone) {
        await api.updateZone(zone.id, { name: name.trim(), color, outline, restaurant_id: restaurantId });
      } else {
        await api.createZone({
          city_id: restaurant?.city_id ?? cities[0]?.id ?? "",
          restaurant_id: restaurantId,
          name: name.trim(),
          color,
          outline,
          delivery_price_kopecks: 0,
          min_order_kopecks: 0,
          delivery_minutes: null,
        });
      }

      onSaved();
      onClose();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось сохранить зону");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(event) => event.stopPropagation()}>
        <div style={head}>
          <div>
            <div style={{ fontSize: typography.h3.fontSize, fontWeight: 600 }}>
              {zone ? "Контур зоны" : "Новая зона"}
            </div>
            <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
              {outline.length} точек · обслуживает {restaurant?.name ?? "—"}
            </div>
          </div>

          <span style={{ flex: 1 }} />

          <Button tone="quiet" onClick={onClose}>
            Закрыть
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </Button>
        </div>

        <div style={{ display: "flex", gap: spacing.lg, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ZoneMap
              outline={outline}
              color={color}
              center={restaurant}
              onChange={setOutline}
            />
          </div>

          <div style={{ width: 260, display: "flex", flexDirection: "column", gap: spacing.base }}>
            <label style={field}>
              <span style={label}>Название</span>
              <input
                style={styles.input}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Например, Петергоф и Стрельна"
              />
            </label>

            <label style={field}>
              <span style={label}>Ресторан</span>
              <select
                style={styles.input}
                value={restaurantId}
                onChange={(event) => setRestaurantId(event.target.value)}
              >
                {restaurants.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <div style={field}>
              <span style={label}>Цвет на карте</span>
              <div style={{ display: "flex", gap: spacing.sm, flexWrap: "wrap" }}>
                {zoneColors.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setColor(option)}
                    aria-label={`Цвет ${option}`}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: radius.sm,
                      background: option,
                      cursor: "pointer",
                      border:
                        option === color ? `2px solid ${c.textPrimary}` : `1px solid ${c.border}`,
                    }}
                  />
                ))}
              </div>
            </div>

            <div
              style={{
                background: c.surfaceSunken,
                borderRadius: radius.md,
                padding: spacing.md,
                color: c.textSecondary,
                fontSize: typography.caption.fontSize,
                lineHeight: 1.5,
              }}
            >
              Контур замыкается сам — последнюю точку с первой соединять не нужно. Если зоны
              перекрываются, адрес достаётся той, что выше в списке.
            </div>

            {failure ? (
              <div style={{ color: c.danger, fontSize: typography.caption.fontSize }}>{failure}</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: c.scrim,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: spacing.xl,
  zIndex: 40,
};

const sheet: React.CSSProperties = {
  background: c.surface,
  borderRadius: radius.lg,
  border: `1px solid ${c.border}`,
  padding: spacing.lg,
  width: "min(1080px, 100%)",
  maxHeight: "90vh",
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: spacing.lg,
  boxShadow: "0 24px 60px rgba(22, 27, 38, 0.24)",
};

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: spacing.md,
};

const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };

const label: React.CSSProperties = {
  fontSize: typography.caption.fontSize,
  color: c.textTertiary,
};
