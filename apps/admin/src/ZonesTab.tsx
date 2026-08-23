import { useEffect, useState } from "react";

import {
  api,
  ApiError,
  formatPrice,
  type AdminRestaurant,
  type City,
  type Zone,
} from "./api";
import { ZoneEditor } from "./ZoneEditor";
import { Badge, Button, c, radius, Section, spacing, styles, typography } from "./ui";

/** Копейки → рубли в поле ввода и обратно. */
const toRub = (kopecks: number | null) =>
  kopecks === null ? "" : String(Math.round(kopecks / 100));
const toKop = (value: string) =>
  value.trim() === "" ? null : Number(value.replace(/\D/g, "")) * 100;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 120 }}>
      <span style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>{label}</span>
      {children}
    </label>
  );
}

function ZoneRow({
  zone,
  restaurants,
  onSaved,
  onEdit,
}: {
  zone: Zone;
  restaurants: AdminRestaurant[];
  onSaved: () => void;
  onEdit: () => void;
}) {
  const [draft, setDraft] = useState(zone);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => setDraft(zone), [zone]);

  const dirty =
    draft.restaurant_id !== zone.restaurant_id ||
    draft.delivery_price_kopecks !== zone.delivery_price_kopecks ||
    draft.min_order_kopecks !== zone.min_order_kopecks ||
    draft.min_order_weekend_kopecks !== zone.min_order_weekend_kopecks ||
    draft.free_delivery_from_kopecks !== zone.free_delivery_from_kopecks ||
    draft.delivery_minutes !== zone.delivery_minutes ||
    draft.is_active !== zone.is_active;

  const save = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await api.updateZone(zone.id, {
        restaurant_id: draft.restaurant_id,
        delivery_price_kopecks: draft.delivery_price_kopecks,
        min_order_kopecks: draft.min_order_kopecks,
        min_order_weekend_kopecks: draft.min_order_weekend_kopecks,
        free_delivery_from_kopecks: draft.free_delivery_from_kopecks,
        delivery_minutes: draft.delivery_minutes,
        is_active: draft.is_active,
      });
      onSaved();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td style={styles.td}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
          <span
            title={zone.color}
            style={{
              width: 14,
              height: 14,
              borderRadius: 4,
              background: zone.color,
              border: `1px solid ${c.border}`,
            }}
          />
          <div>
            <div style={{ fontWeight: 600 }}>{zone.name}</div>
            <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
              {zone.outline.length} точек контура
            </div>
          </div>
        </div>
      </td>

      <td style={styles.td}>
        <select
          style={{ ...styles.input, maxWidth: 230 }}
          value={draft.restaurant_id}
          onChange={(event) => setDraft({ ...draft, restaurant_id: event.target.value })}
        >
          {restaurants.map((restaurant) => (
            <option key={restaurant.id} value={restaurant.id}>
              {restaurant.name}
            </option>
          ))}
        </select>
      </td>

      <td style={styles.td}>
        <div style={{ display: "flex", gap: spacing.sm, flexWrap: "wrap" }}>
          <Field label="Доставка, ₽">
            <input
              style={{ ...styles.input, width: 90 }}
              inputMode="numeric"
              value={toRub(draft.delivery_price_kopecks)}
              onChange={(event) =>
                setDraft({ ...draft, delivery_price_kopecks: toKop(event.target.value) ?? 0 })
              }
            />
          </Field>
          <Field label="Минимум, ₽">
            <input
              style={{ ...styles.input, width: 90 }}
              inputMode="numeric"
              value={toRub(draft.min_order_kopecks)}
              onChange={(event) =>
                setDraft({ ...draft, min_order_kopecks: toKop(event.target.value) ?? 0 })
              }
            />
          </Field>
          <Field label="Минимум пт–вс, ₽">
            <input
              style={{ ...styles.input, width: 110 }}
              inputMode="numeric"
              value={toRub(draft.min_order_weekend_kopecks)}
              onChange={(event) =>
                setDraft({ ...draft, min_order_weekend_kopecks: toKop(event.target.value) })
              }
            />
          </Field>
          <Field label="Бесплатно от, ₽">
            <input
              style={{ ...styles.input, width: 110 }}
              inputMode="numeric"
              value={toRub(draft.free_delivery_from_kopecks)}
              onChange={(event) =>
                setDraft({ ...draft, free_delivery_from_kopecks: toKop(event.target.value) })
              }
            />
          </Field>
          <Field label="Минут в пути">
            <input
              style={{ ...styles.input, width: 90 }}
              inputMode="numeric"
              value={draft.delivery_minutes ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  delivery_minutes:
                    event.target.value.trim() === ""
                      ? null
                      : Number(event.target.value.replace(/\D/g, "")),
                })
              }
            />
          </Field>
        </div>
        {failure ? <div style={{ color: c.danger }}>{failure}</div> : null}
      </td>

      <td style={styles.td}>
        <label style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
          <input
            type="checkbox"
            checked={draft.is_active}
            onChange={(event) => setDraft({ ...draft, is_active: event.target.checked })}
          />
          <span>{draft.is_active ? "работает" : "выключена"}</span>
        </label>
      </td>

      <td style={{ ...styles.td, textAlign: "right" }}>
        <div style={{ display: "flex", gap: spacing.sm, justifyContent: "flex-end" }}>
          <Button tone="quiet" onClick={onEdit}>
            Контур
          </Button>
          <Button onClick={() => void save()} disabled={!dirty || busy}>
            {busy ? "…" : "Сохранить"}
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function ZonesTab() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [restaurants, setRestaurants] = useState<AdminRestaurant[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  // null — окно закрыто, зона — правим её контур, "new" — рисуем новую
  const [editing, setEditing] = useState<Zone | "new" | null>(null);

  const load = async () => {
    try {
      const [zoneRows, restaurantRows, cityRows] = await Promise.all([
        api.zones(),
        api.adminRestaurants(),
        api.cities(),
      ]);
      setZones(zoneRows);
      setRestaurants(restaurantRows);
      setCities(cityRows);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось загрузить зоны");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const covered = zones.filter((zone) => zone.is_active).length;

  return (
    <Section title="Зоны доставки">
      {failure ? <div style={{ color: c.danger }}>{failure}</div> : null}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button onClick={() => setEditing("new")} disabled={restaurants.length === 0}>
          Нарисовать зону
        </Button>
      </div>

      <div
        style={{
          background: c.surfaceSunken,
          borderRadius: radius.lg,
          padding: spacing.base,
          color: c.textSecondary,
        }}
      >
        Зон {zones.length}, из них работают {covered}. Адрес гостя проверяется по контуру зоны:
        какой ресторан её обслуживает, тот и принимает заказ, а условия доставки берутся отсюда,
        а не из карточки ресторана. Если зоны наложились, побеждает та, что выше в списке.
      </div>

      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Зона</th>
              <th style={styles.th}>Ресторан</th>
              <th style={styles.th}>Условия</th>
              <th style={styles.th}>Состояние</th>
              <th style={styles.th} />
            </tr>
          </thead>
          <tbody>
            {zones.map((zone) => (
              <ZoneRow
                key={zone.id}
                zone={zone}
                restaurants={restaurants}
                onSaved={load}
                onEdit={() => setEditing(zone)}
              />
            ))}
            {zones.length === 0 ? (
              <tr>
                <td style={{ ...styles.td, color: c.textTertiary }} colSpan={5}>
                  Зон пока нет. Загрузите их командой{" "}
                  <code>uv run python -m app.import_zones</code>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
        Минимальная сумма показана в рублях. Пустое поле «Бесплатно от» — доставка платная всегда.
        Средний чек по зонам:{" "}
        {zones.length > 0
          ? formatPrice(
              Math.round(
                zones.reduce((sum, zone) => sum + zone.min_order_kopecks, 0) / zones.length,
              ),
            )
          : "—"}
      </div>
      {editing ? (
        <ZoneEditor
          zone={editing === "new" ? null : editing}
          restaurants={restaurants}
          cities={cities}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      ) : null}
    </Section>
  );
}
