import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  api,
  ApiError,
  mediaUrl,
  type Promotion,
  type PromotionDraft,
  type Restaurant,
} from "./api";
import { Badge, Button, c, Section, spacing, styles, typography } from "./ui";

const empty: PromotionDraft = {
  title: "",
  description: null,
  label: null,
  image_url: null,
  restaurant_id: null,
  ends_at: null,
  sort_order: 0,
  is_active: true,
};

function toDraft(promotion: Promotion): PromotionDraft {
  return {
    title: promotion.title,
    description: promotion.description,
    label: promotion.label,
    image_url: promotion.image_url,
    restaurant_id: promotion.restaurant_id,
    ends_at: promotion.ends_at ? promotion.ends_at.slice(0, 10) : null,
    sort_order: promotion.sort_order,
    is_active: promotion.is_active,
  };
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

function PromoForm({
  restaurants,
  initial,
  title,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  restaurants: Restaurant[];
  initial: PromotionDraft;
  title: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (draft: PromotionDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const set = <K extends keyof PromotionDraft>(key: K, value: PromotionDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const nullable = (value: string) => (value.trim() === "" ? null : value);

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
        <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
          {label("Заголовок")}
          <input
            style={styles.input}
            value={draft.title}
            placeholder="Паста дня — 490 ₽"
            onChange={(event) => set("title", event.target.value)}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          {label("Плашка на картинке")}
          <input
            style={styles.input}
            value={draft.label ?? ""}
            placeholder="−30%"
            maxLength={24}
            onChange={(event) => set("label", nullable(event.target.value))}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          {label("Действует до")}
          <input
            style={styles.input}
            type="date"
            value={draft.ends_at ?? ""}
            onChange={(event) => set("ends_at", nullable(event.target.value))}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          {label("Ресторан")}
          <select
            style={styles.input}
            value={draft.restaurant_id ?? ""}
            onChange={(event) => set("restaurant_id", nullable(event.target.value))}
          >
            <option value="">Во всех ресторанах</option>
            {restaurants.map((restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>
                {restaurant.name}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
          {label("Текст акции")}
          <textarea
            style={{ ...styles.input, minHeight: 80, resize: "vertical" }}
            value={draft.description ?? ""}
            onChange={(event) => set("description", nullable(event.target.value))}
          />
        </label>

        <div style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
          {label("Картинка")}
          <div style={{ display: "flex", gap: spacing.base, alignItems: "center" }}>
            {draft.image_url ? (
              <img
                src={mediaUrl(draft.image_url) ?? ""}
                alt=""
                style={{
                  width: 140,
                  height: 84,
                  objectFit: "cover",
                  borderRadius: 12,
                  border: `1px solid ${c.border}`,
                }}
              />
            ) : (
              <div
                style={{
                  width: 140,
                  height: 84,
                  borderRadius: 12,
                  border: `1px dashed ${c.borderStrong}`,
                  display: "grid",
                  placeItems: "center",
                  color: c.textTertiary,
                  fontSize: typography.caption.fontSize,
                }}
              >
                нет картинки
              </div>
            )}

            <div style={{ display: "grid", gap: 6 }}>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setUploading(true);
                  api
                    .uploadImage(file, "promos")
                    .then((url) => set("image_url", url))
                    .catch((exc: ApiError) => setUploadError(exc.message))
                    .finally(() => setUploading(false));
                }}
                style={{ fontSize: typography.caption.fontSize }}
              />
              {uploading ? (
                <span style={{ color: c.textSecondary }}>Загружаем…</span>
              ) : uploadError ? (
                <span style={{ color: c.danger }}>{uploadError}</span>
              ) : (
                <span style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                  Горизонтальная картинка смотрится лучше
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {error ? <span style={{ color: c.danger }}>{error}</span> : null}

      <div style={{ display: "flex", gap: spacing.sm }}>
        <Button onClick={() => onSubmit(draft)} disabled={pending || draft.title.trim().length < 2}>
          {pending ? "Сохраняем…" : "Сохранить"}
        </Button>
        <Button tone="quiet" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

export function PromosTab() {
  const queryClient = useQueryClient();
  const promos = useQuery({ queryKey: ["promotions"], queryFn: api.promotions });
  const restaurants = useQuery({ queryKey: ["restaurants"], queryFn: api.restaurants });

  const [editing, setEditing] = useState<{ id: string | null; draft: PromotionDraft } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["promotions"] });
  const fail = (exc: ApiError) => setError(exc.message);

  const save = useMutation({
    mutationFn: ({ id, draft }: { id: string | null; draft: PromotionDraft }) => {
      const body = { ...draft, ends_at: draft.ends_at ? `${draft.ends_at}T23:59:00Z` : null };
      return id === null ? api.createPromotion(body) : api.updatePromotion(id, body);
    },
    onSuccess: () => {
      setEditing(null);
      setError(null);
      refresh();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deletePromotion(id),
    onSuccess: refresh,
    onError: fail,
  });

  const expired = (promotion: Promotion) =>
    promotion.ends_at !== null && new Date(promotion.ends_at) < new Date();

  return (
    <Section
      title="Акции"
      action={
        editing === null ? (
          <Button onClick={() => setEditing({ id: null, draft: empty })}>Новая акция</Button>
        ) : null
      }
    >
      {error ? <div style={{ color: c.danger }}>{error}</div> : null}

      {editing !== null ? (
        <PromoForm
          restaurants={restaurants.data ?? []}
          initial={editing.draft}
          title={editing.id === null ? "Новая акция" : "Правка акции"}
          pending={save.isPending}
          error={error}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
          onSubmit={(draft) => save.mutate({ id: editing.id, draft })}
        />
      ) : null}

      {(promos.data ?? []).length === 0 ? (
        <p style={{ color: c.textSecondary, margin: 0 }}>
          Акций пока нет. Первая появится в приложении сразу после сохранения.
        </p>
      ) : (
        <div style={{ display: "grid", gap: spacing.md }}>
          {(promos.data ?? []).map((promotion) => (
            <div
              key={promotion.id}
              style={{
                ...styles.card,
                padding: spacing.base,
                display: "flex",
                gap: spacing.base,
                opacity: promotion.is_active && !expired(promotion) ? 1 : 0.55,
              }}
            >
              {promotion.image_url ? (
                <img
                  src={mediaUrl(promotion.image_url) ?? ""}
                  alt=""
                  style={{
                    width: 120,
                    height: 76,
                    objectFit: "cover",
                    borderRadius: 10,
                    flexShrink: 0,
                  }}
                />
              ) : null}

              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: spacing.sm, alignItems: "center" }}>
                  <strong>{promotion.title}</strong>
                  {promotion.label ? <Badge text={promotion.label} tone="warn" /> : null}
                  {expired(promotion) ? <Badge text="истекла" tone="muted" /> : null}
                  {!promotion.is_active ? <Badge text="выключена" tone="muted" /> : null}
                </div>

                {promotion.description ? (
                  <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                    {promotion.description}
                  </div>
                ) : null}

                <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                  {promotion.restaurant_name ?? "Во всех ресторанах"}
                  {promotion.ends_at
                    ? ` · до ${new Date(promotion.ends_at).toLocaleDateString("ru-RU")}`
                    : " · бессрочно"}
                </div>
              </div>

              <div style={{ display: "flex", gap: spacing.sm, alignItems: "flex-start" }}>
                <Button
                  tone="quiet"
                  onClick={() => setEditing({ id: promotion.id, draft: toDraft(promotion) })}
                >
                  Править
                </Button>
                <Button
                  tone="quiet"
                  onClick={() =>
                    save.mutate({
                      id: promotion.id,
                      draft: { ...toDraft(promotion), is_active: !promotion.is_active },
                    })
                  }
                >
                  {promotion.is_active ? "Выключить" : "Включить"}
                </Button>
                <Button tone="danger" onClick={() => remove.mutate(promotion.id)}>
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
