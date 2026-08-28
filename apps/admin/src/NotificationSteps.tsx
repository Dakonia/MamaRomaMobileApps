import { useEffect, useState } from "react";

import { api, ApiError, type NotificationRule, type QuietHours } from "./api";
import { Button, c, radius, spacing, styles, typography } from "./ui";

/** Человеческие названия шагов заказа: в базе они лежат кодами. */
const STEPS: Record<string, string> = {
  accepted: "Ресторан принял заказ",
  cooking: "Заказ готовится",
  ready: "Заказ готов",
  delivering: "Курьер выехал",
  completed: "Заказ доставлен",
  cancelled: "Заказ отменён",
  // Событие вне цепочки: ресторан поправил состав прямо на кассе
  items_changed: "Ресторан изменил состав заказа",
};

const HINT = "Доступные подстановки: {number} — номер заказа, {restaurant}, {time}";

function StepCard({ rule, onSaved }: { rule: NotificationRule; onSaved: () => void }) {
  const [draft, setDraft] = useState(rule);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => setDraft(rule), [rule]);

  const dirty =
    draft.is_enabled !== rule.is_enabled ||
    draft.title !== rule.title ||
    draft.body !== rule.body;

  const save = async () => {
    setBusy(true);
    setFailure(null);

    try {
      await api.saveNotificationRule(draft);
      onSaved();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        ...styles.card,
        padding: spacing.base,
        display: "flex",
        flexDirection: "column",
        gap: spacing.md,
        borderLeft: `3px solid ${draft.is_enabled ? c.accent : c.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
        <label style={{ display: "flex", alignItems: "center", gap: spacing.sm, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={draft.is_enabled}
            onChange={(event) => setDraft({ ...draft, is_enabled: event.target.checked })}
          />
          <span style={{ fontWeight: 600 }}>{STEPS[draft.event] ?? draft.event}</span>
        </label>

        <span style={{ flex: 1 }} />

        <span style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>
          {draft.is_enabled ? "уведомление уходит" : "молчим"}
        </span>
      </div>

      <div style={{ display: "flex", gap: spacing.md, flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>
            Заголовок
          </span>
          <input
            style={styles.input}
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>

        <label style={{ flex: "2 1 320px", display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>
            Текст
          </span>
          <input
            style={styles.input}
            value={draft.body}
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          />
        </label>
      </div>

      {/* Так гость увидит уведомление на телефоне */}
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
            fontSize: 16,
          }}
        >
          🔔
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {draft.title.replace("{number}", "1024").replace("{restaurant}", "Невский, 63")}
          </div>
          <div style={{ fontSize: 13, color: c.textSecondary }}>
            {draft.body
              .replace("{number}", "1024")
              .replace("{restaurant}", "Невский, 63")
              .replace("{time}", "19:40")}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
        <span style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>{HINT}</span>
        <span style={{ flex: 1 }} />
        {failure ? <span style={{ color: c.danger }}>{failure}</span> : null}
        <Button onClick={() => void save()} disabled={!dirty || busy}>
          {busy ? "…" : "Сохранить"}
        </Button>
      </div>
    </div>
  );
}

/** Шаги заказа и тихие часы: когда пишем гостю и какими словами. */
export function NotificationSteps() {
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [hours, setHours] = useState<QuietHours | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [ruleRows, hourRow] = await Promise.all([
        api.notificationRules(),
        api.notificationHours(),
      ]);
      setRules(ruleRows);
      setHours(hourRow);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось загрузить настройки");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveHours = async () => {
    if (!hours) return;

    setBusy(true);
    try {
      await api.saveNotificationHours(hours);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.lg }}>
      {failure ? <div style={{ color: c.danger }}>{failure}</div> : null}

      <div
        style={{
          background: c.surfaceSunken,
          borderRadius: radius.lg,
          padding: spacing.base,
          color: c.textSecondary,
        }}
      >
        Уведомления о заказе приходят всем, кто их разрешил, — от рекламы они не зависят и тихих
        часов не знают. Выключенный шаг означает, что на нём мы гостю не пишем.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
        {rules.map((rule) => (
          <StepCard key={`${rule.restaurant_id ?? "all"}-${rule.event}`} rule={rule} onSaved={load} />
        ))}
      </div>

      {hours ? (
        <div style={{ ...styles.card, padding: spacing.base, display: "flex", flexDirection: "column", gap: spacing.md }}>
          <div style={{ fontWeight: 600 }}>Тихие часы для акций</div>
          <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
            В это время рекламные рассылки не уходят и ждут утра. Уведомления о заказе приходят
            всегда — гость их ждёт.
          </div>

          <div style={{ display: "flex", gap: spacing.md, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>с</span>
              <input
                type="time"
                style={{ ...styles.input, width: 130 }}
                value={hours.quiet_from.slice(0, 5)}
                onChange={(event) => setHours({ ...hours, quiet_from: `${event.target.value}:00` })}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>до</span>
              <input
                type="time"
                style={{ ...styles.input, width: 130 }}
                value={hours.quiet_to.slice(0, 5)}
                onChange={(event) => setHours({ ...hours, quiet_to: `${event.target.value}:00` })}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>
                Рассылок в неделю
              </span>
              <input
                style={{ ...styles.input, width: 130 }}
                inputMode="numeric"
                value={hours.weekly_limit}
                onChange={(event) =>
                  setHours({ ...hours, weekly_limit: Number(event.target.value.replace(/\D/g, "")) })
                }
              />
            </label>

            <span style={{ flex: 1 }} />

            <Button onClick={() => void saveHours()} disabled={busy}>
              {busy ? "…" : "Сохранить"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
