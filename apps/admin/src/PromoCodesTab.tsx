import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, type ApiError, type PromoCode, type PromoCodeDraft } from "./api";
import { Badge, Button, c, Section, spacing, styles, typography } from "./ui";

const KINDS: { value: PromoCode["kind"]; label: string; hint: string }[] = [
  { value: "percent", label: "Процент", hint: "Скидка в процентах от суммы блюд" },
  { value: "fixed", label: "Сумма", hint: "Фиксированная скидка в рублях" },
  { value: "free_delivery", label: "Бесплатная доставка", hint: "Гасит стоимость доставки" },
];

const empty: PromoCodeDraft = {
  code: "",
  title: "",
  kind: "percent",
  value: 10,
  max_discount_kopecks: null,
  min_order_kopecks: 0,
  starts_at: null,
  ends_at: null,
  usage_limit: null,
  per_guest_limit: 1,
  is_active: true,
};

function toDraft(promo: PromoCode): PromoCodeDraft {
  const { id: _id, used_count: _used, ...draft } = promo;
  return { ...draft, ends_at: promo.ends_at ? promo.ends_at.slice(0, 10) : null };
}

function label(text: string) {
  return (
    <span
      style={{
        fontSize: typography.caption.fontSize,
        color: c.textTertiary,
        textTransform: "uppercase",
        letterSpacing: 0.6,
      }}
    >
      {text}
    </span>
  );
}

function describe(promo: PromoCode): string {
  if (promo.kind === "free_delivery") return "бесплатная доставка";
  if (promo.kind === "percent") return `−${promo.value}%`;
  return `−${Math.round(promo.value / 100)} ₽`;
}

function PromoForm({
  initial,
  title,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  initial: PromoCodeDraft;
  title: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (draft: PromoCodeDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);

  const set = <K extends keyof PromoCodeDraft>(key: K, value: PromoCodeDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const kind = KINDS.find((item) => item.value === draft.kind);

  return (
    <div style={{ ...styles.card, padding: spacing.lg, display: "grid", gap: spacing.base }}>
      <strong style={{ fontFamily: "'Comfortaa', sans-serif", fontSize: typography.h3.fontSize }}>
        {title}
      </strong>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: spacing.md,
        }}
      >
        <label style={{ display: "grid", gap: 4 }}>
          {label("Код")}
          <input
            style={{ ...styles.input, textTransform: "uppercase" }}
            value={draft.code}
            placeholder="ROMA10"
            onChange={(event) => set("code", event.target.value.toUpperCase())}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          {label("Название для чека")}
          <input
            style={styles.input}
            value={draft.title}
            placeholder="Скидка 10%"
            onChange={(event) => set("title", event.target.value)}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          {label("Что даёт")}
          <select
            style={styles.input}
            value={draft.kind}
            onChange={(event) => set("kind", event.target.value as PromoCode["kind"])}
          >
            {KINDS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        {draft.kind !== "free_delivery" ? (
          <label style={{ display: "grid", gap: 4 }}>
            {label(draft.kind === "percent" ? "Процент" : "Скидка, ₽")}
            <input
              style={styles.input}
              type="number"
              min={0}
              value={draft.kind === "percent" ? draft.value : Math.round(draft.value / 100)}
              onChange={(event) =>
                set(
                  "value",
                  draft.kind === "percent"
                    ? Number(event.target.value)
                    : Number(event.target.value) * 100,
                )
              }
            />
          </label>
        ) : null}

        <label style={{ display: "grid", gap: 4 }}>
          {label("Заказ от, ₽")}
          <input
            style={styles.input}
            type="number"
            min={0}
            value={Math.round(draft.min_order_kopecks / 100)}
            onChange={(event) => set("min_order_kopecks", Number(event.target.value) * 100)}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          {label("Действует до")}
          <input
            style={styles.input}
            type="date"
            value={draft.ends_at ?? ""}
            onChange={(event) => set("ends_at", event.target.value || null)}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          {label("Раз на гостя")}
          <input
            style={styles.input}
            type="number"
            min={0}
            value={draft.per_guest_limit}
            onChange={(event) => set("per_guest_limit", Number(event.target.value))}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          {label("Всего применений")}
          <input
            style={styles.input}
            type="number"
            min={1}
            placeholder="без ограничения"
            value={draft.usage_limit ?? ""}
            onChange={(event) =>
              set("usage_limit", event.target.value === "" ? null : Number(event.target.value))
            }
          />
        </label>
      </div>

      <span style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
        {kind?.hint} · скидка считается до списания баллов
      </span>

      {error ? <span style={{ color: c.danger }}>{error}</span> : null}

      <div style={{ display: "flex", gap: spacing.sm }}>
        <Button
          onClick={() => onSubmit({ ...draft, ends_at: draft.ends_at ? `${draft.ends_at}T23:59:00Z` : null })}
          disabled={pending || draft.code.trim().length < 3}
        >
          {pending ? "Сохраняем…" : "Сохранить"}
        </Button>
        <Button tone="quiet" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

export function PromoCodesTab() {
  const queryClient = useQueryClient();
  const codes = useQuery({ queryKey: ["promo-codes"], queryFn: api.promoCodes });

  const [editing, setEditing] = useState<{ id: string | null; draft: PromoCodeDraft } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["promo-codes"] });
  const fail = (exc: ApiError) => setError(exc.message);

  const save = useMutation({
    mutationFn: ({ id, draft }: { id: string | null; draft: PromoCodeDraft }) =>
      id === null ? api.createPromoCode(draft) : api.updatePromoCode(id, draft),
    onSuccess: () => {
      setEditing(null);
      setError(null);
      refresh();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deletePromoCode(id),
    onSuccess: refresh,
    onError: fail,
  });

  return (
    <Section
      title="Промокоды"
      action={
        editing === null ? (
          <Button onClick={() => setEditing({ id: null, draft: empty })}>Новый промокод</Button>
        ) : null
      }
    >
      {error ? <div style={{ color: c.danger }}>{error}</div> : null}

      {editing !== null ? (
        <PromoForm
          initial={editing.draft}
          title={editing.id === null ? "Новый промокод" : "Правка промокода"}
          pending={save.isPending}
          error={error}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
          onSubmit={(draft) => save.mutate({ id: editing.id, draft })}
        />
      ) : null}

      {(codes.data ?? []).length === 0 ? (
        <p style={{ color: c.textSecondary, margin: 0 }}>
          Промокодов пока нет. Гость вводит код в корзине, скидка считается до баллов.
        </p>
      ) : (
        <div style={{ display: "grid", gap: spacing.sm }}>
          {(codes.data ?? []).map((promo) => (
            <div
              key={promo.id}
              style={{
                ...styles.card,
                padding: spacing.base,
                display: "flex",
                gap: spacing.base,
                alignItems: "center",
                opacity: promo.is_active ? 1 : 0.55,
              }}
            >
              <strong style={{ fontFamily: "'Comfortaa', sans-serif", minWidth: 120 }}>
                {promo.code}
              </strong>

              <div style={{ flex: 1 }}>
                <div>
                  {promo.title || describe(promo)}
                  <span style={{ color: c.textSecondary }}> · {describe(promo)}</span>
                </div>
                <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                  {promo.min_order_kopecks > 0
                    ? `от ${Math.round(promo.min_order_kopecks / 100)} ₽`
                    : "без порога"}
                  {promo.ends_at
                    ? ` · до ${new Date(promo.ends_at).toLocaleDateString("ru-RU")}`
                    : " · бессрочно"}
                  {` · использован ${promo.used_count}`}
                  {promo.usage_limit ? ` из ${promo.usage_limit}` : ""}
                  {promo.per_guest_limit > 0 ? ` · ${promo.per_guest_limit} раз на гостя` : ""}
                </div>
              </div>

              {!promo.is_active ? <Badge text="выключен" tone="muted" /> : null}

              <div style={{ display: "flex", gap: spacing.sm }}>
                <Button
                  tone="quiet"
                  onClick={() => setEditing({ id: promo.id, draft: toDraft(promo) })}
                >
                  Править
                </Button>
                <Button
                  tone="quiet"
                  onClick={() =>
                    save.mutate({
                      id: promo.id,
                      draft: { ...toDraft(promo), is_active: !promo.is_active },
                    })
                  }
                >
                  {promo.is_active ? "Выключить" : "Включить"}
                </Button>
                <Button tone="danger" onClick={() => remove.mutate(promo.id)}>
                  Удалить
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
