import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Edit3,
  Eye,
  EyeOff,
  Flame,
  ImageOff,
  ImageUp,
  Leaf,
  Plus,
  RotateCcw,
  Search,
  Star,
  StarOff,
  Trash2,
  Utensils,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  formatPrice,
  mediaUrl,
  type Category,
  type Dish,
  type DishDraft,
  type StopEntry,
} from "./api";
import { ConfirmDialog } from "./components/patterns/ConfirmDialog";
import { DataTable, DensityToggle, createAdminColumnHelper, useTableDensity } from "./components/patterns/DataTable";
import { DetailDrawer } from "./components/patterns/DetailDrawer";
import { Badge, Button, IconButton, Section, Select } from "./ui";

const dishColumn = createAdminColumnHelper<Dish>();
const stopColumn = createAdminColumnHelper<StopEntry>();

const emptyDraft = (categoryId: string): DishDraft => ({
  calories: null,
  carbs_g: null,
  category_id: categoryId,
  composition: null,
  description: null,
  fats_g: null,
  image_url: null,
  is_active: true,
  is_new: false,
  is_spicy: false,
  is_vegetarian: false,
  name: "",
  price_kopecks: 0,
  proteins_g: null,
  sort_order: 0,
  volume_ml: null,
  weight_grams: null,
});

const MAP: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ы: "y",
  э: "e",
  ю: "yu",
  я: "ya",
  ь: "",
  ъ: "",
  " ": "-",
};

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

function toDraft(dish: Dish): DishDraft {
  return {
    calories: dish.calories,
    carbs_g: dish.carbs_g,
    category_id: dish.category_id,
    composition: dish.composition,
    description: dish.description,
    fats_g: dish.fats_g,
    image_url: dish.image_url,
    is_active: dish.is_active,
    is_new: dish.is_new,
    is_spicy: dish.is_spicy,
    is_vegetarian: dish.is_vegetarian,
    name: dish.name,
    price_kopecks: dish.price_kopecks,
    proteins_g: dish.proteins_g,
    sort_order: dish.sort_order,
    volume_ml: dish.volume_ml,
    weight_grams: dish.weight_grams,
  };
}

function normalizeDraft(draft: DishDraft): DishDraft {
  return {
    ...draft,
    composition: draft.composition?.trim() || null,
    description: draft.description?.trim() || null,
    name: draft.name.trim(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function intNullable(value: string): number | null {
  const clean = value.replace(/\D/g, "");
  return clean === "" ? null : Number(clean);
}

function decimalNullable(value: string): number | null {
  const clean = value.replace(",", ".").replace(/[^\d.]/g, "");
  return clean === "" ? null : Number(clean);
}

function rubToKopecks(value: string): number {
  return Number(value.replace(/\D/g, "") || 0) * 100;
}

function categoryName(categoryById: Map<string, Category>, id: string): string {
  return categoryById.get(id)?.name ?? "Без категории";
}

function Metric({
  icon,
  label,
  note,
  tone = "accent",
  value,
}: {
  icon: ReactNode;
  label: string;
  note: string;
  tone?: "accent" | "ok" | "warn" | "bad";
  value: string;
}) {
  return (
    <div className="metric-card metric-card-rich" data-tone={tone}>
      <div className="metric-icon">{icon}</div>
      <div className="min-w-0">
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
        <div className="metric-note">{note}</div>
      </div>
    </div>
  );
}

function DishThumb({ dish }: { dish: Dish }) {
  return (
    <div className="dish-thumb">
      {dish.image_url ? <img src={mediaUrl(dish.image_url) ?? undefined} alt="" /> : <ImageOff size={16} aria-hidden />}
    </div>
  );
}

function portionText(dish: Dish): string {
  if (dish.weight_grams) return `${dish.weight_grams} г`;
  if (dish.volume_ml) return `${dish.volume_ml} мл`;
  return "Порция не задана";
}

function dishDetailsText(dish: Dish): string {
  return dish.description?.trim() || dish.composition?.trim() || "Описание не заполнено";
}

function DishDrawer({
  categories,
  dish,
  onClose,
  onSubmit,
  pending,
}: {
  categories: Category[];
  dish: Dish | null;
  onClose: () => void;
  onSubmit: (draft: DishDraft) => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState<DishDraft>(() =>
    dish ? toDraft(dish) : emptyDraft(categories[0]?.id ?? ""),
  );
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setDraft(dish ? toDraft(dish) : emptyDraft(categories[0]?.id ?? ""));
  }, [categories, dish]);

  const set = <K extends keyof DishDraft>(key: K, value: DishDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const url = await api.uploadImage(file);
      set("image_url", url);
      toast.success("Фото блюда загружено");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const canSave = draft.name.trim().length >= 2 && draft.price_kopecks > 0 && draft.category_id.length > 0;

  return (
    <DetailDrawer
      badge={draft.is_active ? <Badge text="в продаже" tone="ok" /> : <Badge text="снято" tone="muted" />}
      footer={
        <>
          <Button disabled={pending || uploading} variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={pending || uploading || !canSave}
            onClick={() => onSubmit(normalizeDraft(draft))}
          >
            {pending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </>
      }
      subtitle={dish ? "Правка карточки блюда" : "Создание позиции меню"}
      title={dish?.name ?? "Новое блюдо"}
      onClose={onClose}
    >
      <div className="drawer-form">
        <section className="drawer-section">
          <h3 className="drawer-section-title">Фото</h3>
          <div className="dish-preview">
            {draft.image_url ? (
              <img src={mediaUrl(draft.image_url) ?? undefined} alt="" />
            ) : (
              <div className="dish-preview-empty">
                <Utensils size={24} aria-hidden />
              </div>
            )}
            <div className="drawer-section">
              <label className="upload-button">
                <ImageUp size={15} aria-hidden />
                {uploading ? "Загружаем..." : "Загрузить"}
                <input
                  accept="image/jpeg,image/png,image/webp"
                  disabled={uploading}
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
              </label>
              {draft.image_url ? (
                <Button size="xs" variant="ghost" onClick={() => set("image_url", null)}>
                  Убрать фото
                </Button>
              ) : null}
              <div className="row-sub">Квадратное фото блюда лучше читается в карточках меню.</div>
            </div>
          </div>
        </section>

        <section className="drawer-section">
          <h3 className="drawer-section-title">Основное</h3>
          <div className="drawer-form-grid">
            <label className="field" data-wide="true">
              <span className="field-label">Название</span>
              <input className="input" value={draft.name} onChange={(event) => set("name", event.target.value)} />
            </label>
            <div className="field">
              <span className="field-label">Категория</span>
              <Select
                value={draft.category_id}
                options={categories.map((category) => ({ label: category.name, value: category.id }))}
                onChange={(value) => set("category_id", value)}
              />
            </div>
            <label className="field">
              <span className="field-label">Цена, ₽</span>
              <input
                className="input"
                inputMode="numeric"
                value={draft.price_kopecks === 0 ? "" : Math.round(draft.price_kopecks / 100)}
                onChange={(event) => set("price_kopecks", rubToKopecks(event.target.value))}
              />
            </label>
            <label className="field">
              <span className="field-label">Порядок</span>
              <input
                className="input"
                inputMode="numeric"
                value={draft.sort_order}
                onChange={(event) => set("sort_order", intNullable(event.target.value) ?? 0)}
              />
            </label>
            <label className="inline-check">
              <input
                checked={draft.is_active}
                type="checkbox"
                onChange={(event) => set("is_active", event.target.checked)}
              />
              В продаже
            </label>
          </div>
        </section>

        <section className="drawer-section">
          <h3 className="drawer-section-title">Порция и КБЖУ</h3>
          <div className="drawer-form-grid">
            <label className="field">
              <span className="field-label">Вес, г</span>
              <input
                className="input"
                inputMode="numeric"
                value={draft.weight_grams ?? ""}
                onChange={(event) => set("weight_grams", intNullable(event.target.value))}
              />
            </label>
            <label className="field">
              <span className="field-label">Объём, мл</span>
              <input
                className="input"
                inputMode="numeric"
                value={draft.volume_ml ?? ""}
                onChange={(event) => set("volume_ml", intNullable(event.target.value))}
              />
            </label>
            <label className="field">
              <span className="field-label">Калории</span>
              <input
                className="input"
                inputMode="numeric"
                value={draft.calories ?? ""}
                onChange={(event) => set("calories", intNullable(event.target.value))}
              />
            </label>
            <label className="field">
              <span className="field-label">Белки, г</span>
              <input
                className="input"
                inputMode="decimal"
                value={draft.proteins_g ?? ""}
                onChange={(event) => set("proteins_g", decimalNullable(event.target.value))}
              />
            </label>
            <label className="field">
              <span className="field-label">Жиры, г</span>
              <input
                className="input"
                inputMode="decimal"
                value={draft.fats_g ?? ""}
                onChange={(event) => set("fats_g", decimalNullable(event.target.value))}
              />
            </label>
            <label className="field">
              <span className="field-label">Углеводы, г</span>
              <input
                className="input"
                inputMode="decimal"
                value={draft.carbs_g ?? ""}
                onChange={(event) => set("carbs_g", decimalNullable(event.target.value))}
              />
            </label>
          </div>
        </section>

        <section className="drawer-section">
          <h3 className="drawer-section-title">Метки</h3>
          <div className="checkbox-grid">
            <label className="inline-check">
              <input
                checked={draft.is_new}
                type="checkbox"
                onChange={(event) => set("is_new", event.target.checked)}
              />
              Новинка
            </label>
            <label className="inline-check">
              <input
                checked={draft.is_spicy}
                type="checkbox"
                onChange={(event) => set("is_spicy", event.target.checked)}
              />
              Острое
            </label>
            <label className="inline-check">
              <input
                checked={draft.is_vegetarian}
                type="checkbox"
                onChange={(event) => set("is_vegetarian", event.target.checked)}
              />
              Вегетарианское
            </label>
          </div>
        </section>

        <section className="drawer-section">
          <h3 className="drawer-section-title">Описание</h3>
          <label className="field">
            <span className="field-label">Для гостя</span>
            <textarea
              className="textarea"
              value={draft.description ?? ""}
              onChange={(event) => set("description", event.target.value || null)}
            />
          </label>
          <label className="field">
            <span className="field-label">Состав</span>
            <textarea
              className="textarea"
              value={draft.composition ?? ""}
              onChange={(event) => set("composition", event.target.value || null)}
            />
          </label>
        </section>
      </div>
    </DetailDrawer>
  );
}

export function MenuTab() {
  const queryClient = useQueryClient();
  const [density, setDensity] = useTableDensity();
  const [filter, setFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteDishTarget, setDeleteDishTarget] = useState<Dish | null>(null);
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<Category | null>(null);

  const categories = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const dishes = useQuery({ queryKey: ["dishes"], queryFn: api.dishes });
  const stopList = useQuery({ queryKey: ["stop-list"], queryFn: api.stopList });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["categories"] });
    void queryClient.invalidateQueries({ queryKey: ["dishes"] });
    void queryClient.invalidateQueries({ queryKey: ["stop-list"] });
  };

  const saveDish = useMutation({
    mutationFn: ({ draft, id }: { draft: DishDraft; id: string | null }) =>
      id === null ? api.createDish(draft) : api.updateDish(id, draft),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (dish) => {
      setCreating(false);
      setSelectedId(dish.id);
      refresh();
      toast.success("Блюдо сохранено");
    },
  });

  const removeDish = useMutation({
    mutationFn: api.deleteDish,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      setDeleteDishTarget(null);
      setSelectedId(null);
      refresh();
      toast.success("Блюдо удалено");
    },
  });

  const addCategory = useMutation({
    mutationFn: (name: string) =>
      api.createCategory({
        name,
        slug: translit(name),
        sort_order: (categories.data?.length ?? 0) + 1,
      }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (category) => {
      setNewCategory("");
      setFilter(category.id);
      refresh();
      toast.success("Категория создана");
    },
  });

  const toggleCategory = useMutation({
    mutationFn: ({ category, is_active }: { category: Category; is_active: boolean }) =>
      api.updateCategory(category.id, { is_active }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: refresh,
  });

  const togglePopular = useMutation({
    mutationFn: ({ category, show_in_popular }: { category: Category; show_in_popular: boolean }) =>
      api.updateCategory(category.id, { show_in_popular }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: refresh,
  });

  const removeCategory = useMutation({
    mutationFn: api.deleteCategory,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      setDeleteCategoryTarget(null);
      setFilter(null);
      refresh();
      toast.success("Категория удалена");
    },
  });

  const removeStop = useMutation({
    mutationFn: api.removeStop,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      refresh();
      toast.success("Блюдо вернули в меню");
    },
  });

  const categoryById = useMemo(
    () => new Map((categories.data ?? []).map((category) => [category.id, category])),
    [categories.data],
  );
  const categoryList = categories.data ?? [];
  const dishList = dishes.data ?? [];
  const selectedCategory = filter ? categoryById.get(filter) ?? null : null;
  const activeCategories = categoryList.filter((category) => category.is_active).length;
  const popularCategories = categoryList.filter((category) => category.show_in_popular).length;
  const stopDishIds = useMemo(() => new Set((stopList.data ?? []).map((entry) => entry.dish_id)), [stopList.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return [...dishList]
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ru-RU"))
      .filter((dish) => {
        const text = `${dish.name} ${dish.description ?? ""} ${dish.composition ?? ""} ${categoryName(
          categoryById,
          dish.category_id,
        )}`.toLocaleLowerCase("ru-RU");
        return (!filter || dish.category_id === filter) && text.includes(needle);
      });
  }, [categoryById, dishList, filter, search]);

  const selected = selectedId ? dishList.find((dish) => dish.id === selectedId) ?? null : null;
  const activeCount = dishList.filter((dish) => dish.is_active).length;
  const hiddenCount = dishList.length - activeCount;
  const noPhoto = dishList.filter((dish) => !dish.image_url).length;
  const stopCount = stopList.data?.length ?? 0;

  const dishColumns = useMemo(
    () =>
      dishColumn.columns([
        dishColumn.accessor("name", {
          header: "Блюдо",
          cell: (info) => {
            const dish = info.row.original;
            return (
              <div className="dish-row-title">
                <DishThumb dish={dish} />
                <div className="dish-row-copy">
                  <div className="dish-row-head">
                    <span className="row-main">{info.getValue()}</span>
                    {!dish.image_url ? <Badge text="без фото" tone="muted" /> : null}
                  </div>
                  <div className="dish-row-meta">
                    <span>{categoryName(categoryById, dish.category_id)}</span>
                    <span>{dishDetailsText(dish)}</span>
                  </div>
                </div>
              </div>
            );
          },
        }),
        dishColumn.accessor("price_kopecks", {
          header: "Цена / порция",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => {
            const dish = info.row.original;
            return (
              <div className="dish-price-cell">
                <span className="mono">{formatPrice(info.getValue())}</span>
                <span className="row-sub">
                  {portionText(dish)}
                  {dish.calories ? ` · ${dish.calories} ккал` : ""}
                </span>
              </div>
            );
          },
        }),
        dishColumn.display({
          id: "flags",
          header: "Метки",
          cell: (info) => {
            const dish = info.row.original;
            return (
              <div className="chips-line">
                {dish.is_new ? <Badge text="новинка" tone="accent" /> : null}
                {dish.is_spicy ? <Badge text="острое" tone="warn" /> : null}
                {dish.is_vegetarian ? <Badge text="вегетарианское" tone="ok" /> : null}
                {!dish.is_new && !dish.is_spicy && !dish.is_vegetarian ? (
                  <span className="row-muted">нет</span>
                ) : null}
              </div>
            );
          },
        }),
        dishColumn.accessor("is_active", {
          header: "Витрина",
          cell: (info) => {
            const dish = info.row.original;
            return (
              <div className="status-stack">
                {info.getValue() ? <Badge text="в продаже" tone="ok" /> : <Badge text="снято" tone="muted" />}
                {stopDishIds.has(dish.id) ? <Badge text="в стоп-листе" tone="warn" /> : null}
              </div>
            );
          },
        }),
        dishColumn.accessor("sort_order", {
          header: "Сортировка",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => <span className="mono">{info.getValue()}</span>,
        }),
        dishColumn.display({
          id: "actions",
          header: "",
          meta: { align: "right" },
          cell: (info) => {
            const dish = info.row.original;
            return (
              <div className="cell-actions">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setCreating(false);
                    setSelectedId(dish.id);
                  }}
                >
                  <Edit3 size={14} aria-hidden />
                  Детали
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveDish.mutate({
                      id: dish.id,
                      draft: normalizeDraft({ ...toDraft(dish), is_active: !dish.is_active }),
                    });
                  }}
                >
                  {dish.is_active ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                  {dish.is_active ? "Снять" : "В продажу"}
                </Button>
                <IconButton
                  label="Удалить"
                  size="xs"
                  variant="danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDeleteDishTarget(dish);
                  }}
                >
                  <Trash2 size={14} aria-hidden />
                </IconButton>
              </div>
            );
          },
        }),
      ]),
    [categoryById, saveDish, stopDishIds],
  );

  const stopColumns = useMemo(
    () =>
      stopColumn.columns([
        stopColumn.accessor("dish_name", {
          header: "Блюдо",
          cell: (info) => <span className="row-main">{info.getValue()}</span>,
        }),
        stopColumn.accessor("restaurant_name", {
          header: "Ресторан",
          cell: (info) => <span className="row-sub">{info.getValue()}</span>,
        }),
        stopColumn.accessor("comment", {
          header: "Комментарий",
          cell: (info) => info.getValue() ?? <span className="row-muted">нет</span>,
        }),
        stopColumn.display({
          id: "actions",
          header: "",
          meta: { align: "right" },
          cell: (info) => (
            <Button size="xs" variant="ghost" onClick={() => removeStop.mutate(info.row.original.id)}>
              <RotateCcw size={14} aria-hidden />
              Вернуть
            </Button>
          ),
        }),
      ]),
    [removeStop],
  );

  return (
    <div className="page-stack">
      <Section
        title="Меню"
        action={
          <Button
            disabled={categoryList.length === 0}
            onClick={() => {
              setCreating(true);
              setSelectedId(null);
            }}
          >
            <Plus size={15} aria-hidden />
            Новое блюдо
          </Button>
        }
        description="Категории, блюда, карточки для приложения и стоп-лист по ресторанам."
      >
        <div className="metric-strip">
          <Metric
            icon={<Utensils size={17} aria-hidden />}
            label="Блюд"
            note={`${activeCount} в продаже, ${hiddenCount} снято`}
            value={String(dishList.length)}
          />
          <Metric
            icon={<Eye size={17} aria-hidden />}
            label="Категорий"
            note={`${activeCategories} опубликовано, ${popularCategories} в подборке`}
            tone="ok"
            value={String(categoryList.length)}
          />
          <Metric
            icon={<ImageOff size={17} aria-hidden />}
            label="Без фото"
            note="карточки требуют оформления"
            tone={noPhoto > 0 ? "warn" : "ok"}
            value={String(noPhoto)}
          />
          <Metric
            icon={<Flame size={17} aria-hidden />}
            label="Стоп-лист"
            note="позиции скрыты по ресторанам"
            tone={stopCount > 0 ? "bad" : "ok"}
            value={String(stopCount)}
          />
        </div>
      </Section>

      <Section title="Категории меню">
        <div className="surface-toolbar">
          <label className="field">
            <span className="field-label">Новая категория</span>
            <input
              className="input"
              placeholder="Например, Пицца"
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
            />
          </label>
          <Button
            disabled={newCategory.trim().length < 2 || addCategory.isPending}
            onClick={() => addCategory.mutate(newCategory.trim())}
          >
            <Plus size={15} aria-hidden />
            Добавить
          </Button>
          <span className="toolbar-spacer" />
          <Button variant={filter === null ? "primary" : "ghost"} onClick={() => setFilter(null)}>
            Все блюда
          </Button>
        </div>

        {categories.error ? (
          <div className="error-state">
            <h2>Не удалось загрузить категории</h2>
            <p>{errorMessage(categories.error)}</p>
          </div>
        ) : (
          <div className="category-grid">
            {categoryList.map((category) => (
              <div key={category.id} className="category-card" data-active={filter === category.id}>
                <button
                  aria-pressed={filter === category.id}
                  className="category-main"
                  type="button"
                  onClick={() => setFilter((current) => (current === category.id ? null : category.id))}
                >
                  <span className="category-title-row">
                    <span className="row-main">{category.name}</span>
                    {filter === category.id ? <Badge text="фильтр" tone="accent" /> : null}
                  </span>
                  <span className="category-stats-row">
                    <span>
                      <strong>{category.dishes_count}</strong>
                      <span> блюд</span>
                    </span>
                    <span>
                      <strong>{category.sort_order}</strong>
                      <span> порядок</span>
                    </span>
                  </span>
                  <span className="category-status-row">
                    {category.is_active ? (
                      <Badge text="опубликована" tone="ok" />
                    ) : (
                      <Badge text="скрыта в меню" tone="muted" />
                    )}
                    {category.show_in_popular ? (
                      <Badge text="в часто заказывают" tone="accent" />
                    ) : (
                      <Badge text="не в подборке" tone="muted" />
                    )}
                  </span>
                </button>
                <div className="category-action-row">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      togglePopular.mutate({
                        category,
                        show_in_popular: !category.show_in_popular,
                      });
                    }}
                  >
                    {category.show_in_popular ? <StarOff size={14} aria-hidden /> : <Star size={14} aria-hidden />}
                    {category.show_in_popular ? "Убрать из подборки" : "В подборку"}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleCategory.mutate({
                        category,
                        is_active: !category.is_active,
                      });
                    }}
                  >
                    {category.is_active ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                    {category.is_active ? "Скрыть" : "Показать"}
                  </Button>
                  <IconButton
                    label="Удалить категорию"
                    size="xs"
                    variant="danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDeleteCategoryTarget(category);
                    }}
                  >
                    <Trash2 size={14} aria-hidden />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Блюда">
        <div className="surface-toolbar">
          <label className="field toolbar-field">
            <span className="field-label">Поиск</span>
            <span className="search-control">
              <Search className="search-icon" size={15} aria-hidden />
              <input
                className="input"
                placeholder="Поиск блюда"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </span>
          </label>
          {selectedCategory ? (
            <div className="active-filter-pill">
              <span className="row-muted">Категория</span>
              <span className="row-main">{selectedCategory.name}</span>
              <Button size="xs" variant="ghost" onClick={() => setFilter(null)}>
                Сбросить
              </Button>
            </div>
          ) : (
            <span className="toolbar-note">
              Показано {rows.length} из {dishList.length}
            </span>
          )}
          <span className="toolbar-spacer" />
          <DensityToggle density={density} onChange={setDensity} />
        </div>

        {dishes.error ? (
          <div className="error-state">
            <h2>Не удалось загрузить блюда</h2>
            <p>{errorMessage(dishes.error)}</p>
          </div>
        ) : (
          <DataTable
            columns={dishColumns}
            data={rows}
            density={density}
            getRowId={(row) => row.id}
            isLoading={dishes.isPending}
            onRowClick={(dish) => {
              setCreating(false);
              setSelectedId(dish.id);
            }}
            pageSize={20}
            selectedId={selectedId}
            empty={
              <div className="empty-state">
                <h2>Блюд не найдено</h2>
                <p>Создайте блюдо или измените фильтр категории и поиск.</p>
              </div>
            }
          />
        )}
      </Section>

      <Section title="Стоп-лист">
        <DataTable
          columns={stopColumns}
          data={stopList.data ?? []}
          density={density}
          getRowId={(row) => row.id}
          isLoading={stopList.isPending}
          pageSize={10}
          empty={
            <div className="empty-state">
              <h2>Сейчас всё есть в наличии</h2>
              <p>Когда ресторан поставит блюдо в стоп-лист, оно появится здесь.</p>
            </div>
          }
        />
      </Section>

      {creating || selected ? (
        <DishDrawer
          categories={categories.data ?? []}
          dish={creating ? null : selected}
          pending={saveDish.isPending}
          onClose={() => {
            setCreating(false);
            setSelectedId(null);
          }}
          onSubmit={(draft) => saveDish.mutate({ draft, id: creating ? null : selected?.id ?? null })}
        />
      ) : null}

      {deleteDishTarget ? (
        <ConfirmDialog
          busy={removeDish.isPending}
          message={`Удалить блюдо «${deleteDishTarget.name}»?`}
          title="Удалить блюдо"
          onCancel={() => setDeleteDishTarget(null)}
          onConfirm={() => removeDish.mutate(deleteDishTarget.id)}
        />
      ) : null}

      {deleteCategoryTarget ? (
        <ConfirmDialog
          busy={removeCategory.isPending}
          message={`Удалить категорию «${deleteCategoryTarget.name}»? Если в ней есть блюда, сервер может отказать.`}
          title="Удалить категорию"
          onCancel={() => setDeleteCategoryTarget(null)}
          onConfirm={() => removeCategory.mutate(deleteCategoryTarget.id)}
        />
      ) : null}
    </div>
  );
}
