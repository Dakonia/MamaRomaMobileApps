import { useEffect, useState } from "react";

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
import { Badge, Button, c, Section, spacing, styles, typography } from "./ui";

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
  // Время приходит как 11:00:00, а полю нужно 11:00
  return {
    ...rest,
    opens_at: rest.opens_at.slice(0, 5),
    closes_at: rest.closes_at.slice(0, 5),
    delivery_opens_at: rest.delivery_opens_at?.slice(0, 5) ?? null,
    delivery_closes_at: rest.delivery_closes_at?.slice(0, 5) ?? null,
  };
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        gridColumn: wide ? "1 / -1" : undefined,
      }}
    >
      <span style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>{label}</span>
      {children}
    </label>
  );
}

function Check({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: spacing.sm, cursor: "pointer" }}>
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function RestaurantsTab() {
  const [rows, setRows] = useState<AdminRestaurant[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [draft, setDraft] = useState<RestaurantDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuOf, setMenuOf] = useState<AdminRestaurant | null>(null);

  const load = async () => {
    try {
      const [list, cityList] = await Promise.all([api.adminRestaurants(), api.cities()]);
      setRows(list);
      setCities(cityList);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось загрузить рестораны");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const set = <K extends keyof RestaurantDraft>(key: K, value: RestaurantDraft[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setFailure(null);
    try {
      if (editingId) await api.updateRestaurant(editingId, draft);
      else await api.createRestaurant(draft);
      setDraft(null);
      setEditingId(null);
      await load();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async (restaurant: AdminRestaurant) => {
    setFailure(null);
    try {
      if (restaurant.is_paused) {
        await api.updateRestaurant(restaurant.id, { is_paused: false, pause_reason: null });
      } else {
        const reason = window.prompt(
          "Почему ставим на паузу? Причину увидит гость в приложении",
          "Технические работы",
        );
        if (reason === null) return;
        await api.updateRestaurant(restaurant.id, { is_paused: true, pause_reason: reason });
      }
      await load();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось сменить состояние");
    }
  };

  const remove = async (restaurant: AdminRestaurant) => {
    if (!window.confirm(`Удалить «${restaurant.name}»? Отменить это нельзя`)) return;
    setFailure(null);
    try {
      await api.deleteRestaurant(restaurant.id);
      await load();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось удалить");
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const url = await api.uploadImage(file, "restaurants");
      set("image_url", url);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось загрузить фото");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Рестораны"
      action={
        draft === null ? (
          <Button
            onClick={() => {
              setEditingId(null);
              setDraft(emptyDraft(cities[0]?.id ?? ""));
            }}
          >
            Добавить ресторан
          </Button>
        ) : null
      }
    >
      {failure ? <div style={{ color: c.danger }}>{failure}</div> : null}

      {menuOf ? (
        <RestaurantMenu
          restaurantId={menuOf.id}
          restaurantName={menuOf.name}
          onClose={() => setMenuOf(null)}
        />
      ) : null}

      {draft ? (
        <div style={{ ...styles.card, padding: spacing.lg, display: "grid", gap: spacing.base }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: spacing.base,
            }}
          >
            <Field label="Название">
              <input
                style={styles.input}
                value={draft.name}
                onChange={(event) => set("name", event.target.value)}
              />
            </Field>

            <Field label="Город">
              <select
                style={styles.input}
                value={draft.city_id}
                onChange={(event) => set("city_id", event.target.value)}
              >
                {cities.map((city) => (
                  <option key={city.id} value={city.id}>
                    {city.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Адрес" wide>
              <input
                style={styles.input}
                value={draft.address}
                onChange={(event) => set("address", event.target.value)}
              />
            </Field>

            <Field label="Метро">
              <input
                style={styles.input}
                value={draft.metro ?? ""}
                onChange={(event) => set("metro", event.target.value || null)}
              />
            </Field>

            <Field label="Телефон">
              <input
                style={styles.input}
                value={draft.phone ?? ""}
                onChange={(event) => set("phone", event.target.value || null)}
              />
            </Field>

            <Field label="Широта">
              <input
                style={styles.input}
                inputMode="decimal"
                value={draft.latitude}
                onChange={(event) => set("latitude", Number(event.target.value.replace(",", ".")))}
              />
            </Field>

            <Field label="Долгота">
              <input
                style={styles.input}
                inputMode="decimal"
                value={draft.longitude}
                onChange={(event) => set("longitude", Number(event.target.value.replace(",", ".")))}
              />
            </Field>

            <Field label="Открытие">
              <input
                style={styles.input}
                type="time"
                value={draft.opens_at}
                onChange={(event) => set("opens_at", event.target.value)}
              />
            </Field>

            <Field label="Закрытие">
              <input
                style={styles.input}
                type="time"
                value={draft.closes_at}
                onChange={(event) => set("closes_at", event.target.value)}
              />
            </Field>

            <Field label="Доставка с">
              <input
                style={styles.input}
                type="time"
                value={draft.delivery_opens_at ?? ""}
                onChange={(event) => set("delivery_opens_at", event.target.value || null)}
              />
            </Field>

            <Field label="Доставка до">
              <input
                style={styles.input}
                type="time"
                value={draft.delivery_closes_at ?? ""}
                onChange={(event) => set("delivery_closes_at", event.target.value || null)}
              />
            </Field>

            <Field label="Доставка, ₽">
              <input
                style={styles.input}
                inputMode="numeric"
                value={Math.round(draft.delivery_price_kopecks / 100)}
                onChange={(event) =>
                  set("delivery_price_kopecks", Number(event.target.value.replace(/\D/g, "")) * 100)
                }
              />
            </Field>

            <Field label="Минимальный заказ, ₽">
              <input
                style={styles.input}
                inputMode="numeric"
                value={Math.round(draft.delivery_min_order_kopecks / 100)}
                onChange={(event) =>
                  set(
                    "delivery_min_order_kopecks",
                    Number(event.target.value.replace(/\D/g, "")) * 100,
                  )
                }
              />
            </Field>

            <Field label="Бесплатная доставка от, ₽">
              <input
                style={styles.input}
                inputMode="numeric"
                value={
                  draft.free_delivery_from_kopecks === null
                    ? ""
                    : Math.round(draft.free_delivery_from_kopecks / 100)
                }
                onChange={(event) =>
                  set(
                    "free_delivery_from_kopecks",
                    event.target.value.trim() === ""
                      ? null
                      : Number(event.target.value.replace(/\D/g, "")) * 100,
                  )
                }
              />
            </Field>

            <Field label="Описание" wide>
              <textarea
                style={{ ...styles.input, minHeight: 80, resize: "vertical" }}
                value={draft.description ?? ""}
                onChange={(event) => set("description", event.target.value || null)}
              />
            </Field>

            <Field label="Фотография" wide>
              <div style={{ display: "flex", gap: spacing.base, alignItems: "center" }}>
                {draft.image_url ? (
                  <img
                    src={mediaUrl(draft.image_url) ?? ""}
                    alt=""
                    style={{ width: 96, height: 72, objectFit: "cover", borderRadius: 8 }}
                  />
                ) : null}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
              </div>
            </Field>
          </div>

          <div style={{ display: "flex", gap: spacing.lg, flexWrap: "wrap" }}>
            <Check label="Доставка" value={draft.has_delivery} onChange={(v) => set("has_delivery", v)} />
            <Check label="Самовывоз" value={draft.has_pickup} onChange={(v) => set("has_pickup", v)} />
            <Check label="Зал" value={draft.has_dine_in} onChange={(v) => set("has_dine_in", v)} />
            <Check label="Работает" value={draft.is_active} onChange={(v) => set("is_active", v)} />
            <Check
              label="Принимать заказы, пока закрыт"
              value={draft.preorder_enabled}
              onChange={(v) => set("preorder_enabled", v)}
            />
          </div>

          {/* Состояние пишем словами: «включено/выключено» читается двояко */}
          <span style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
            {draft.preorder_enabled
              ? "Сейчас: пока ресторан закрыт, гость оформляет заказ на время в ближайшие рабочие часы — и на доставку, и на самовывоз. «Как можно скорее» в это время не предлагается."
              : "Сейчас: в нерабочие часы заказ не оформить вовсе — ни на доставку, ни на самовывоз, ни на будущее время."}
          </span>

          <div style={{ display: "flex", gap: spacing.md }}>
            <Button onClick={() => void save()} disabled={busy || draft.name.trim().length < 2}>
              {busy ? "Сохраняем…" : editingId ? "Сохранить" : "Создать"}
            </Button>
            <Button
              tone="quiet"
              onClick={() => {
                setDraft(null);
                setEditingId(null);
              }}
            >
              Отмена
            </Button>
          </div>
        </div>
      ) : null}

      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Ресторан</th>
              <th style={styles.th}>Часы</th>
              <th style={styles.th}>Доставка</th>
              <th style={styles.th}>Состояние</th>
              <th style={styles.th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((restaurant) => (
              <tr key={restaurant.id}>
                <td style={styles.td}>
                  <div style={{ fontWeight: 600 }}>{restaurant.name}</div>
                  <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                    {restaurant.address}
                    {restaurant.metro ? ` · м. ${restaurant.metro}` : ""}
                  </div>
                </td>
                <td style={styles.td}>
                  {restaurant.opens_at.slice(0, 5)}–{restaurant.closes_at.slice(0, 5)}
                </td>
                <td style={styles.td}>
                  {restaurant.preorder_enabled ? <Badge text="предзаказ" tone="ok" /> : null}
                  {restaurant.has_delivery ? formatPrice(restaurant.delivery_price_kopecks) : "нет"}
                  {restaurant.has_delivery && restaurant.delivery_min_order_kopecks > 0 ? (
                    <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                      от {formatPrice(restaurant.delivery_min_order_kopecks)}
                    </div>
                  ) : null}
                </td>
                <td style={styles.td}>
                  {!restaurant.is_active ? (
                    <Badge text="отключён" tone="muted" />
                  ) : restaurant.is_paused ? (
                    <div style={{ display: "grid", gap: 4 }}>
                      <Badge text="на паузе" tone="warn" />
                      <span style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                        {restaurant.pause_reason}
                      </span>
                    </div>
                  ) : (
                    <Badge text="принимает заказы" tone="ok" />
                  )}
                </td>
                <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", gap: spacing.sm, justifyContent: "flex-end" }}>
                    <Button tone="quiet" onClick={() => setMenuOf(restaurant)}>
                      Меню
                    </Button>
                    <Button tone="quiet" onClick={() => void togglePause(restaurant)}>
                      {restaurant.is_paused ? "Снять паузу" : "Пауза"}
                    </Button>
                    <Button
                      tone="quiet"
                      onClick={() => {
                        setEditingId(restaurant.id);
                        setDraft(toDraft(restaurant));
                      }}
                    >
                      Изменить
                    </Button>
                    <Button tone="danger" onClick={() => void remove(restaurant)}>
                      Удалить
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
