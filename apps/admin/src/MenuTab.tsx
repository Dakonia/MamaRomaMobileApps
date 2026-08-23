import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  api,
  ApiError,
  formatPrice,
  mediaUrl,
  type Category,
  type Dish,
  type DishDraft,
} from "./api";
import { Badge, Button, c, Section, spacing, styles, typography } from "./ui";

const emptyDraft = (categoryId: string): DishDraft => ({
  category_id: categoryId,
  name: "",
  image_url: null,
  price_kopecks: 0,
  description: null,
  composition: null,
  weight_grams: null,
  volume_ml: null,
  calories: null,
  proteins_g: null,
  fats_g: null,
  carbs_g: null,
  is_spicy: false,
  is_vegetarian: false,
  is_new: false,
  sort_order: 0,
  is_active: true,
});

function toDraft(dish: Dish): DishDraft {
  return {
    category_id: dish.category_id,
    name: dish.name,
    image_url: dish.image_url,
    price_kopecks: dish.price_kopecks,
    description: dish.description,
    composition: dish.composition,
    weight_grams: dish.weight_grams,
    volume_ml: dish.volume_ml,
    calories: dish.calories,
    proteins_g: dish.proteins_g,
    fats_g: dish.fats_g,
    carbs_g: dish.carbs_g,
    is_spicy: dish.is_spicy,
    is_vegetarian: dish.is_vegetarian,
    is_new: dish.is_new,
    sort_order: dish.sort_order,
    is_active: dish.is_active,
  };
}

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label style={{ display: "grid", gap: 4, gridColumn: wide ? "1 / -1" : undefined }}>
      <span
        style={{
          fontSize: typography.caption.fontSize,
          color: c.textTertiary,
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function DishForm({
  categories,
  initial,
  title,
  onCancel,
  onSubmit,
  pending,
  error,
}: {
  categories: Category[];
  initial: DishDraft;
  title: string;
  onCancel: () => void;
  onSubmit: (draft: DishDraft) => void;
  pending: boolean;
  error: string | null;
}) {
  const [draft, setDraft] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const set = <K extends keyof DishDraft>(key: K, value: DishDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const number = (value: string) => (value.trim() === "" ? null : Number(value.replace(/\D/g, "")));
  // БЖУ бывает дробным: 12,5 г белка — обычное дело
  const decimal = (value: string) => {
    const clean = value.replace(",", ".").replace(/[^\d.]/g, "");
    return clean === "" ? null : Number(clean);
  };

  return (
    <div style={{ ...styles.card, padding: spacing.lg, display: "grid", gap: spacing.base }}>
      <strong style={{ fontFamily: "'Comfortaa', sans-serif", fontSize: typography.h3.fontSize }}>
        {title}
      </strong>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: spacing.md,
        }}
      >
        <Field label="Название" wide>
          <input
            style={styles.input}
            value={draft.name}
            onChange={(event) => set("name", event.target.value)}
          />
        </Field>

        <Field label="Категория">
          <select
            style={styles.input}
            value={draft.category_id}
            onChange={(event) => set("category_id", event.target.value)}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Цена, ₽">
          <input
            style={styles.input}
            inputMode="numeric"
            value={draft.price_kopecks === 0 ? "" : String(Math.round(draft.price_kopecks / 100))}
            onChange={(event) => set("price_kopecks", (number(event.target.value) ?? 0) * 100)}
          />
        </Field>

        <Field label="Вес, г">
          <input
            style={styles.input}
            inputMode="numeric"
            value={draft.weight_grams ?? ""}
            onChange={(event) => set("weight_grams", number(event.target.value))}
          />
        </Field>

        <Field label="Объём, мл">
          <input
            style={styles.input}
            inputMode="numeric"
            value={draft.volume_ml ?? ""}
            onChange={(event) => set("volume_ml", number(event.target.value))}
          />
        </Field>

        <Field label="Калории, ккал">
          <input
            style={styles.input}
            inputMode="numeric"
            value={draft.calories ?? ""}
            onChange={(event) => set("calories", number(event.target.value))}
          />
        </Field>

        <Field label="Белки, г">
          <input
            style={styles.input}
            inputMode="decimal"
            value={draft.proteins_g ?? ""}
            onChange={(event) => set("proteins_g", decimal(event.target.value))}
          />
        </Field>

        <Field label="Жиры, г">
          <input
            style={styles.input}
            inputMode="decimal"
            value={draft.fats_g ?? ""}
            onChange={(event) => set("fats_g", decimal(event.target.value))}
          />
        </Field>

        <Field label="Углеводы, г">
          <input
            style={styles.input}
            inputMode="decimal"
            value={draft.carbs_g ?? ""}
            onChange={(event) => set("carbs_g", decimal(event.target.value))}
          />
        </Field>

        <Field label="Порядок в списке">
          <input
            style={styles.input}
            inputMode="numeric"
            value={draft.sort_order}
            onChange={(event) => set("sort_order", number(event.target.value) ?? 0)}
          />
        </Field>

        <Field label="Фотография" wide>
          <div style={{ display: "flex", gap: spacing.base, alignItems: "center" }}>
            {draft.image_url ? (
              <img
                src={mediaUrl(draft.image_url) ?? ""}
                alt=""
                style={{
                  width: 84,
                  height: 84,
                  objectFit: "cover",
                  borderRadius: 12,
                  border: `1px solid ${c.border}`,
                }}
              />
            ) : (
              <div
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 12,
                  border: `1px dashed ${c.borderStrong}`,
                  display: "grid",
                  placeItems: "center",
                  color: c.textTertiary,
                  fontSize: typography.caption.fontSize,
                  textAlign: "center",
                }}
              >
                нет фото
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
                    .uploadImage(file)
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
                  JPEG, PNG или WebP, до 8 МБ. Уменьшим и сожмём сами
                </span>
              )}
              {draft.image_url ? (
                <Button tone="quiet" onClick={() => set("image_url", null)}>
                  Убрать фото
                </Button>
              ) : null}
            </div>
          </div>
        </Field>

        <Field label="Метки поверх фотографии" wide>
          <div style={{ display: "flex", gap: spacing.lg, flexWrap: "wrap", paddingTop: 6 }}>
            {(
              [
                ["is_new", "Новинка"],
                ["is_spicy", "Острое"],
                ["is_vegetarian", "Вегетарианское"],
              ] as const
            ).map(([key, title]) => (
              <label key={key} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(event) => set(key, event.target.checked)}
                />
                {title}
              </label>
            ))}
          </div>
        </Field>

        <Field label="Описание для гостя" wide>
          <textarea
            style={{ ...styles.input, minHeight: 64, resize: "vertical" }}
            value={draft.description ?? ""}
            onChange={(event) =>
              set("description", event.target.value.trim() === "" ? null : event.target.value)
            }
          />
        </Field>

        <Field label="Состав" wide>
          <textarea
            style={{ ...styles.input, minHeight: 64, resize: "vertical" }}
            value={draft.composition ?? ""}
            onChange={(event) =>
              set("composition", event.target.value.trim() === "" ? null : event.target.value)
            }
          />
        </Field>
      </div>

      {error ? <span style={{ color: c.danger }}>{error}</span> : null}

      <div style={{ display: "flex", gap: spacing.sm }}>
        <Button
          onClick={() => onSubmit(draft)}
          disabled={pending || draft.name.trim() === "" || draft.price_kopecks <= 0}
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

export function MenuTab() {
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const dishes = useQuery({ queryKey: ["dishes"], queryFn: api.dishes });
  const stopList = useQuery({ queryKey: ["stop-list"], queryFn: api.stopList });

  const [editing, setEditing] = useState<{ id: string | null; draft: DishDraft } | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["dishes"] });
    void queryClient.invalidateQueries({ queryKey: ["categories"] });
    void queryClient.invalidateQueries({ queryKey: ["stop-list"] });
  };

  const fail = (exc: ApiError) => setError(exc.message);

  const saveDish = useMutation({
    mutationFn: ({ id, draft }: { id: string | null; draft: DishDraft }) =>
      id === null ? api.createDish(draft) : api.updateDish(id, draft),
    onSuccess: () => {
      setEditing(null);
      setError(null);
      refresh();
    },
    onError: fail,
  });

  const removeDish = useMutation({
    mutationFn: (id: string) => api.deleteDish(id),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: fail,
  });

  const addCategory = useMutation({
    mutationFn: () =>
      api.createCategory({
        name: newCategory.trim(),
        slug: translit(newCategory),
        sort_order: (categories.data?.length ?? 0) + 1,
      }),
    onSuccess: () => {
      setNewCategory("");
      setError(null);
      refresh();
    },
    onError: fail,
  });

  const removeCategory = useMutation({
    mutationFn: (id: string) => api.deleteCategory(id),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: fail,
  });

  const toggleCategory = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.updateCategory(id, { is_active }),
    onSuccess: refresh,
    onError: fail,
  });

  // Полка «Часто заказывают» в приложении: соусам и напиткам там не место
  const togglePopular = useMutation({
    mutationFn: ({ id, show_in_popular }: { id: string; show_in_popular: boolean }) =>
      api.updateCategory(id, { show_in_popular }),
    onSuccess: refresh,
    onError: fail,
  });

  const removeStop = useMutation({
    mutationFn: (id: string) => api.removeStop(id),
    onSuccess: refresh,
    onError: fail,
  });

  const list = (dishes.data ?? []).filter(
    (dish) => filter === null || dish.category_id === filter,
  );
  const nameOf = (id: string) => categories.data?.find((item) => item.id === id)?.name ?? "—";

  return (
    <>
      {error ? (
        <div
          style={{
            ...styles.card,
            padding: spacing.md,
            borderColor: c.danger,
            color: c.danger,
          }}
        >
          {error}
        </div>
      ) : null}

      <Section
        title="Категории"
        action={
          <div style={{ display: "flex", gap: spacing.sm }}>
            <input
              style={{ ...styles.input, width: 190 }}
              placeholder="Новая категория"
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
            />
            <Button
              onClick={() => addCategory.mutate()}
              disabled={newCategory.trim().length < 2 || addCategory.isPending}
            >
              Добавить
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.sm }}>
          <Button tone={filter === null ? "brand" : "quiet"} onClick={() => setFilter(null)}>
            Все блюда
          </Button>
          {(categories.data ?? []).map((category) => (
            <div
              key={category.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: spacing.xs,
                border: `1px solid ${c.border}`,
                borderRadius: 999,
                paddingRight: spacing.sm,
                background: filter === category.id ? c.brandSubtle : "transparent",
              }}
            >
              <Button
                tone={filter === category.id ? "brand" : "quiet"}
                onClick={() => setFilter(category.id)}
              >
                {category.name} · {category.dishes_count}
              </Button>
              {!category.is_active ? <Badge text="скрыта" tone="muted" /> : null}
              {!category.show_in_popular ? <Badge text="не в хитах" tone="muted" /> : null}
              <button
                type="button"
                title={
                  category.show_in_popular
                    ? "Убрать с полки «Часто заказывают»"
                    : "Вернуть на полку «Часто заказывают»"
                }
                onClick={() =>
                  togglePopular.mutate({
                    id: category.id,
                    show_in_popular: !category.show_in_popular,
                  })
                }
                style={ghost}
              >
                {category.show_in_popular ? "★" : "☆"}
              </button>
              <button
                type="button"
                title={category.is_active ? "Скрыть" : "Показать"}
                onClick={() =>
                  toggleCategory.mutate({ id: category.id, is_active: !category.is_active })
                }
                style={ghost}
              >
                {category.is_active ? "◉" : "○"}
              </button>
              <button
                type="button"
                title="Удалить"
                onClick={() => removeCategory.mutate(category.id)}
                style={{ ...ghost, color: c.danger }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Блюда"
        action={
          editing === null ? (
            <Button
              onClick={() =>
                setEditing({
                  id: null,
                  draft: emptyDraft(filter ?? categories.data?.[0]?.id ?? ""),
                })
              }
              disabled={(categories.data ?? []).length === 0}
            >
              Новое блюдо
            </Button>
          ) : null
        }
      >
        {editing !== null ? (
          <DishForm
            categories={categories.data ?? []}
            initial={editing.draft}
            title={editing.id === null ? "Новое блюдо" : "Правка блюда"}
            pending={saveDish.isPending}
            error={error}
            onCancel={() => {
              setEditing(null);
              setError(null);
            }}
            onSubmit={(draft) => saveDish.mutate({ id: editing.id, draft })}
          />
        ) : null}

        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Название</th>
                <th style={styles.th}>Категория</th>
                <th style={styles.th}>Цена</th>
                <th style={styles.th}>Состояние</th>
                <th style={styles.th} />
              </tr>
            </thead>
            <tbody>
              {list.map((dish) => (
                <tr key={dish.id}>
                  <td style={styles.td}>
                    <div style={{ display: "flex", gap: spacing.md }}>
                      {dish.image_url ? (
                        <img
                          src={mediaUrl(dish.image_url) ?? ""}
                          alt=""
                          style={{
                            width: 52,
                            height: 52,
                            objectFit: "cover",
                            borderRadius: 8,
                            flexShrink: 0,
                          }}
                        />
                      ) : null}
                      <div>
                    <div style={{ fontWeight: 500 }}>{dish.name}</div>
                    {dish.description ? (
                      <div
                        style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}
                      >
                        {dish.description}
                      </div>
                    ) : null}
                    <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                      {dish.weight_grams ? `${dish.weight_grams} г` : null}
                      {dish.calories ? ` · ${dish.calories} ккал` : null}
                      {dish.image_url ? null : " · без фото"}
                    </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ ...styles.td, color: c.textSecondary }}>
                    {nameOf(dish.category_id)}
                  </td>
                  <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
                    {formatPrice(dish.price_kopecks)}
                  </td>
                  <td style={styles.td}>
                    <Badge
                      text={dish.is_active ? "в продаже" : "снято"}
                      tone={dish.is_active ? "ok" : "muted"}
                    />
                  </td>
                  <td style={styles.td}>
                    <div style={{ display: "flex", gap: spacing.sm, flexWrap: "wrap" }}>
                      <Button
                        tone="quiet"
                        onClick={() => setEditing({ id: dish.id, draft: toDraft(dish) })}
                      >
                        Править
                      </Button>
                      <Button
                        tone="quiet"
                        onClick={() =>
                          saveDish.mutate({
                            id: dish.id,
                            draft: { ...toDraft(dish), is_active: !dish.is_active },
                          })
                        }
                      >
                        {dish.is_active ? "Снять" : "Вернуть"}
                      </Button>
                      <Button tone="danger" onClick={() => removeDish.mutate(dish.id)}>
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

      <Section title="Стоп-лист">
        {(stopList.data ?? []).length === 0 ? (
          <p style={{ color: c.textSecondary, margin: 0 }}>Сейчас всё есть в наличии.</p>
        ) : (
          <div style={styles.card}>
            <table style={styles.table}>
              <tbody>
                {(stopList.data ?? []).map((entry) => (
                  <tr key={entry.id}>
                    <td style={styles.td}>{entry.dish_name}</td>
                    <td style={{ ...styles.td, color: c.textSecondary }}>
                      {entry.restaurant_name}
                    </td>
                    <td style={{ ...styles.td, color: c.textSecondary }}>
                      {entry.comment ?? "—"}
                    </td>
                    <td style={styles.td}>
                      <Button tone="quiet" onClick={() => removeStop.mutate(entry.id)}>
                        Вернуть в меню
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

const ghost: React.CSSProperties = {
  border: 0,
  background: "transparent",
  cursor: "pointer",
  fontSize: 18,
  lineHeight: 1,
  color: c.textTertiary,
  padding: "0 4px",
};

const MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e",
  ю: "yu", я: "ya", ь: "", ъ: "", " ": "-",
};

/** «Горячие блюда» → «goryachie-blyuda»: код категории нужен латиницей. */
function translit(value: string): string {
  return value
    .toLowerCase()
    .split("")
    .map((char) => MAP[char] ?? char)
    .join("")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
