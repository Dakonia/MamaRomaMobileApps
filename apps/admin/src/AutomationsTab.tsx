import { useEffect, useState } from "react";

import { api, ApiError, type Automation } from "./api";
import { Button, c, radius, spacing, styles, typography } from "./ui";

/** Сценарии, которые срабатывают сами. Настройка у каждого своя. */
const KINDS: {
  trigger: string;
  label: string;
  note: string;
  param: { key: string; label: string; hint: string; fallback: number };
  title: string;
  body: string;
}[] = [
  {
    trigger: "birthday",
    label: "День рождения",
    note: "Пишем гостю заранее, чтобы он успел позвать друзей",
    param: { key: "days_before", label: "За сколько дней", hint: "0 — в сам день", fallback: 3 },
    title: "С днём рождения, {name}!",
    body: "Дарим подарок к вашему заказу — загляните в приложение",
  },
  {
    trigger: "inactive",
    label: "Давно не заказывал",
    note: "Тем, кто заказывал раньше, но перестал",
    param: { key: "days", label: "Дней молчания", hint: "Обычно 30–45", fallback: 30 },
    title: "Скучаем, {name}",
    body: "Ваша любимая пицца на месте — и мы придумали пару новинок",
  },
  {
    trigger: "abandoned_cart",
    label: "Забытая корзина",
    note: "Собрал корзину и не оформил заказ",
    param: { key: "hours", label: "Через сколько часов", hint: "Обычно 2–4", fallback: 2 },
    title: "Корзина ждёт",
    body: "Ваш заказ собран — осталось оформить",
  },
  {
    trigger: "points_expiring",
    label: "Сгорают баллы",
    note: "Напоминание, пока баллами ещё можно воспользоваться",
    param: { key: "days_before", label: "За сколько дней", hint: "Обычно 7", fallback: 7 },
    title: "Баллы скоро сгорят",
    body: "Успейте потратить их на любимое блюдо",
  },
];

function AutomationCard({
  kind,
  saved,
  onSaved,
}: {
  kind: (typeof KINDS)[number];
  saved: Automation | undefined;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Automation>(
    saved ?? {
      trigger: kind.trigger,
      is_enabled: false,
      title: kind.title,
      body: kind.body,
      target: { screen: "promos" },
      params: { [kind.param.key]: kind.param.fallback },
    },
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);

  const save = async () => {
    setBusy(true);
    setFailure(null);

    try {
      await api.saveAutomation(draft);
      onSaved();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const value = draft.params?.[kind.param.key] ?? kind.param.fallback;

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
          <span style={{ fontWeight: 600 }}>{kind.label}</span>
        </label>

        <span style={{ flex: 1 }} />

        {saved?.sent_count ? (
          <span style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>
            отправлено {saved.sent_count}
          </span>
        ) : null}
      </div>

      <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
        {kind.note}
      </div>

      <div style={{ display: "flex", gap: spacing.md, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, width: 150 }}>
          <span style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>
            {kind.param.label}
          </span>
          <input
            style={styles.input}
            inputMode="numeric"
            value={value}
            onChange={(event) =>
              setDraft({
                ...draft,
                params: { [kind.param.key]: Number(event.target.value.replace(/\D/g, "")) || 0 },
              })
            }
          />
          <span style={{ fontSize: 12, color: c.textTertiary }}>{kind.param.hint}</span>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 200px" }}>
          <span style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>
            Заголовок
          </span>
          <input
            style={styles.input}
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "2 1 280px" }}>
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

      <div
        style={{
          background: c.surfaceSunken,
          borderRadius: radius.md,
          padding: spacing.md,
          fontSize: 13,
          color: c.textSecondary,
        }}
      >
        <b style={{ color: c.textPrimary }}>{draft.title.replace("{name}", "Владислав")}</b>
        <br />
        {draft.body.replace("{name}", "Владислав")}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
        <span style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>
          Одному гостю по одному сценарию пишем не чаще раза в месяц
        </span>
        <span style={{ flex: 1 }} />
        {failure ? <span style={{ color: c.danger }}>{failure}</span> : null}
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? "…" : "Сохранить"}
        </Button>
      </div>
    </div>
  );
}

/** Сценарии: поводы написать, которые наступают сами. */
export function AutomationsTab() {
  const [rows, setRows] = useState<Automation[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  const load = async () => {
    try {
      setRows(await api.automations());
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось загрузить сценарии");
    }
  };

  useEffect(() => {
    void load();
  }, []);

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
        Сценарий срабатывает сам, когда наступает повод. Проверка идёт раз в несколько минут, в
        тихие часы сообщения ждут утра. В тексте доступна подстановка {"{name}"} — имя гостя.
      </div>

      {KINDS.map((kind) => (
        <AutomationCard
          key={kind.trigger}
          kind={kind}
          saved={rows.find((row) => row.trigger === kind.trigger)}
          onSaved={load}
        />
      ))}
    </div>
  );
}
