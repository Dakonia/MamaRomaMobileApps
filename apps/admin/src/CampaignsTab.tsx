import { useEffect, useMemo, useState } from "react";

import {
  api,
  ApiError,
  type AdminRestaurant,
  type Audience,
  type Campaign,
  type CampaignWrite,
  type City,
  type Promotion,
  type Reach,
} from "./api";
import { Badge, Button, c, radius, spacing, styles, typography } from "./ui";

const EMPTY: CampaignWrite = {
  name: "",
  title: "",
  body: "",
  image_url: null,
  target: { screen: "promos" },
  audience: {},
  scheduled_at: null,
};

/** Куда открыть приложение по нажатию на уведомление. */
const SCREENS: { value: string; label: string; needsId?: boolean }[] = [
  { value: "promos", label: "Лента акций" },
  { value: "promo", label: "Конкретная акция", needsId: true },
  { value: "menu", label: "Меню" },
  { value: "cart", label: "Корзина" },
  { value: "booking", label: "Бронь стола" },
  { value: "loyalty", label: "Карта лояльности" },
];

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "muted" }> = {
  draft: { label: "черновик", tone: "muted" },
  scheduled: { label: "запланирована", tone: "warn" },
  sending: { label: "отправляется", tone: "warn" },
  sent: { label: "отправлена", tone: "ok" },
  cancelled: { label: "отменена", tone: "muted" },
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 220px" }}>
      <span style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>{label}</span>
      {children}
      {hint ? (
        <span style={{ fontSize: 12, color: c.textTertiary }}>{hint}</span>
      ) : null}
    </label>
  );
}

/** Рассылки: текст, кому и куда ведёт нажатие. */
export function CampaignsTab() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [restaurants, setRestaurants] = useState<AdminRestaurant[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [draft, setDraft] = useState<CampaignWrite>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [reach, setReach] = useState<Reach | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const load = async () => {
    try {
      const [campaignRows, restaurantRows, cityRows, promoRows] = await Promise.all([
        api.campaigns(),
        api.adminRestaurants(),
        api.cities(),
        api.promotions(),
      ]);
      setRows(campaignRows);
      setRestaurants(restaurantRows);
      setCities(cityRows);
      setPromos(promoRows);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось загрузить рассылки");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Охват считаем на сервере: он один знает, у кого включены уведомления
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void api
        .campaignAudience(draft.audience)
        .then((result) => alive && setReach(result))
        .catch(() => alive && setReach(null));
    }, 400);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [draft.audience]);

  const screen = useMemo(
    () => SCREENS.find((item) => item.value === draft.target.screen) ?? SCREENS[0],
    [draft.target.screen],
  );

  const audience = (patch: Partial<Audience>) =>
    setDraft({ ...draft, audience: { ...draft.audience, ...patch } });

  const save = async (send: boolean, force = false) => {
    setBusy(true);
    setFailure(null);
    setNote(null);

    try {
      const saved = editing
        ? await api.updateCampaign(editing, draft)
        : await api.createCampaign(draft);

      if (send) {
        const sent = await api.sendCampaign(saved.id, force);

        // Сервер мог отложить отправку — например, из-за тихих часов
        if (sent.error) {
          setNote(sent.error);
          setEditing(saved.id);
          await load();
          return;
        }
      }

      setDraft(EMPTY);
      setEditing(null);
      await load();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось сохранить рассылку");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.lg }}>
      {failure ? <div style={{ color: c.danger }}>{failure}</div> : null}

      {note ? (
        <div
          style={{
            background: c.warningSubtle,
            color: c.warning,
            borderRadius: radius.lg,
            padding: spacing.base,
            display: "flex",
            alignItems: "center",
            gap: spacing.md,
          }}
        >
          <span style={{ flex: 1 }}>{note}</span>
          <Button
            tone="quiet"
            onClick={() => {
              if (editing) void api.sendCampaign(editing, true).then(() => {
                setNote(null);
                setDraft(EMPTY);
                setEditing(null);
                void load();
              });
            }}
          >
            Отправить всё равно
          </Button>
        </div>
      ) : null}

      <div style={{ ...styles.card, padding: spacing.base, display: "flex", flexDirection: "column", gap: spacing.md }}>
        <div style={{ fontWeight: 600 }}>{editing ? "Правка рассылки" : "Новая рассылка"}</div>

        <div style={{ display: "flex", gap: spacing.md, flexWrap: "wrap" }}>
          <Field label="Название" hint="Видно только вам">
            <input
              style={styles.input}
              value={draft.name}
              placeholder="Ленинградский торт"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </Field>

          <Field label="Заголовок" hint="Первая строка уведомления">
            <input
              style={styles.input}
              value={draft.title}
              placeholder="Ленинградский торт: новинка"
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </Field>
        </div>

        <Field label="Текст" hint="Одно-два коротких предложения">
          <input
            style={styles.input}
            value={draft.body}
            placeholder="Десерт от победительницы конкурса — уже в ресторанах"
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          />
        </Field>

        <div style={{ display: "flex", gap: spacing.md, flexWrap: "wrap" }}>
          <Field label="Куда ведёт нажатие">
            <select
              style={styles.input}
              value={draft.target.screen}
              onChange={(event) =>
                setDraft({ ...draft, target: { screen: event.target.value } })
              }
            >
              {SCREENS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>

          {screen.needsId ? (
            <Field label="Какая акция">
              <select
                style={styles.input}
                value={draft.target.id ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, target: { ...draft.target, id: event.target.value } })
                }
              >
                <option value="">— выберите —</option>
                {promos.map((promo) => (
                  <option key={promo.id} value={promo.id}>
                    {promo.title}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field label="Отправить позже" hint="Пусто — отправим сразу по кнопке">
            <input
              type="datetime-local"
              style={styles.input}
              value={draft.scheduled_at?.slice(0, 16) ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  scheduled_at: event.target.value
                    ? new Date(event.target.value).toISOString()
                    : null,
                })
              }
            />
          </Field>
        </div>

        {/* Так уведомление увидят на телефоне */}
        <div
          style={{
            background: c.surfaceSunken,
            borderRadius: radius.md,
            padding: spacing.md,
            display: "flex",
            gap: spacing.md,
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: c.accentSubtle,
              display: "grid",
              placeItems: "center",
            }}
          >
            🍕
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {draft.title || "Заголовок уведомления"}
            </div>
            <div style={{ fontSize: 13, color: c.textSecondary }}>
              {draft.body || "Текст, который прочитает гость"}
            </div>
          </div>
        </div>

        <div style={{ fontWeight: 600, marginTop: spacing.xs }}>Кому отправляем</div>

        <div style={{ display: "flex", gap: spacing.md, flexWrap: "wrap" }}>
          <Field label="Город">
            <select
              style={styles.input}
              value={draft.audience.cities?.[0] ?? ""}
              onChange={(event) =>
                audience({ cities: event.target.value ? [event.target.value] : [] })
              }
            >
              <option value="">Все города</option>
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Ресторан" hint="Кто заказывал именно в нём">
            <select
              style={styles.input}
              value={draft.audience.restaurants?.[0] ?? ""}
              onChange={(event) =>
                audience({ restaurants: event.target.value ? [event.target.value] : [] })
              }
            >
              <option value="">Любой</option>
              {restaurants.map((restaurant) => (
                <option key={restaurant.id} value={restaurant.id}>
                  {restaurant.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Заказывал за последние" hint="Дней, пусто — не важно">
            <input
              style={styles.input}
              inputMode="numeric"
              value={draft.audience.ordered_within_days ?? ""}
              onChange={(event) =>
                audience({
                  ordered_within_days: event.target.value
                    ? Number(event.target.value.replace(/\D/g, ""))
                    : undefined,
                })
              }
            />
          </Field>

          <Field label="Заказов не меньше">
            <input
              style={styles.input}
              inputMode="numeric"
              value={draft.audience.min_orders ?? ""}
              onChange={(event) =>
                audience({
                  min_orders: event.target.value
                    ? Number(event.target.value.replace(/\D/g, ""))
                    : undefined,
                })
              }
            />
          </Field>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
          <input
            type="checkbox"
            checked={Boolean(draft.audience.booked)}
            onChange={(event) => audience({ booked: event.target.checked })}
          />
          <span>Только те, кто бронировал стол</span>
        </label>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: spacing.md,
            paddingTop: spacing.sm,
            borderTop: `1px solid ${c.divider}`,
          }}
        >
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{reach?.count ?? "…"}</div>
            <div style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>
              {reach
                ? `получат рассылку · всего гостей ${reach.guests}, из них с включёнными уведомлениями ${reach.with_push}, согласны на акции ${reach.agreed}`
                : "считаем охват"}
            </div>
          </div>

          <span style={{ flex: 1 }} />

          {editing ? (
            <Button
              tone="quiet"
              onClick={() => {
                setDraft(EMPTY);
                setEditing(null);
              }}
            >
              Отмена
            </Button>
          ) : null}

          <Button tone="quiet" onClick={() => void save(false)} disabled={busy || !draft.title}>
            Сохранить
          </Button>

          <Button onClick={() => void save(true)} disabled={busy || !draft.title}>
            {busy ? "…" : "Отправить сейчас"}
          </Button>
        </div>
      </div>

      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Рассылка</th>
              <th style={styles.th}>Состояние</th>
              <th style={styles.th}>Кому</th>
              <th style={styles.th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const state = STATUS[row.status] ?? STATUS.draft;

              return (
                <tr key={row.id}>
                  <td style={styles.td}>
                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                    <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                      {row.title}
                    </div>
                  </td>
                  <td style={styles.td}>
                    <Badge text={state.label} tone={state.tone} />
                  </td>
                  <td style={styles.td}>
                    {row.status === "sent" || row.sent_count > 0 ? (
                      <>
                        <div style={{ fontWeight: 600 }}>
                          отправлено {row.sent_count}
                        </div>
                        <div
                          style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}
                        >
                          из {row.planned_count} в аудитории
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontWeight: 600 }}>{row.planned_count} гостей</div>
                        <div
                          style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}
                        >
                          {row.scheduled_at
                            ? `отправим ${new Date(row.scheduled_at).toLocaleString("ru-RU", {
                                day: "numeric",
                                month: "long",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}`
                            : "ждёт отправки"}
                        </div>
                      </>
                    )}
                  </td>
                  <td style={{ ...styles.td, textAlign: "right" }}>
                    <div style={{ display: "flex", gap: spacing.sm, justifyContent: "flex-end" }}>
                      <Button
                        tone="quiet"
                        onClick={() => {
                          setEditing(row.id);
                          setDraft({
                            name: row.name,
                            title: row.title,
                            body: row.body,
                            image_url: row.image_url,
                            target: row.target,
                            audience: row.audience,
                            scheduled_at: row.scheduled_at,
                          });
                        }}
                      >
                        Открыть
                      </Button>
                      <Button
                        onClick={() =>
                          void api.sendCampaign(row.id).then((sent) => {
                            if (sent.error) {
                              setNote(sent.error);
                              setEditing(sent.id);
                            }
                            return load();
                          })
                        }
                        disabled={row.status === "sending"}
                      >
                        Отправить
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 ? (
              <tr>
                <td style={{ ...styles.td, color: c.textTertiary }} colSpan={4}>
                  Рассылок пока не было
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
