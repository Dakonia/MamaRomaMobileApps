import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Edit3,
  Eye,
  EyeOff,
  Link2,
  PackageCheck,
  Plus,
  Search,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  formatPrice,
  type Category,
  type Dish,
  type DishExtra,
  type DishExtraLinkedDish,
} from "./api";
import { ConfirmDialog } from "./components/patterns/ConfirmDialog";
import { DataTable, DensityToggle, createAdminColumnHelper, useTableDensity } from "./components/patterns/DataTable";
import { Badge, Button, IconButton, Section } from "./ui";

type ExtraDraft = {
  category_ids: string[];
  dish_ids: string[];
  is_active: boolean;
  name: string;
  price_rub: string;
};

const column = createAdminColumnHelper<DishExtra>();

function toDraft(extra?: DishExtra): ExtraDraft {
  return {
    category_ids: extra?.category_ids ?? [],
    dish_ids: linkedDishes(extra).map((dish) => dish.id),
    is_active: extra?.is_active ?? true,
    name: extra?.name ?? "",
    price_rub: extra ? String(Math.round(extra.price_kopecks / 100)) : "",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function rubToKopecks(value: string): number {
  return Number(value.replace(/\D/g, "") || 0) * 100;
}

function plural(value: number, one: string, few: string, many: string): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function linkedDishes(extra?: DishExtra | null): DishExtraLinkedDish[] {
  return extra?.linked_dishes ?? [];
}

function categoryNames(extra: DishExtra, categoryById: Map<string, Category>): string[] {
  return extra.category_ids
    .map((id) => categoryById.get(id)?.name)
    .filter((name): name is string => Boolean(name));
}

function dishesForCategoryIds(categoryIds: string[], dishesByCategory: Map<string, Dish[]>): Dish[] {
  return categoryIds.flatMap((categoryId) => dishesByCategory.get(categoryId) ?? []);
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

function ExtraDrawer({
  categories,
  dishes,
  extra,
  onClose,
  onSubmit,
  pending,
}: {
  categories: Category[];
  dishes: Dish[];
  extra: DishExtra | null;
  onClose: () => void;
  onSubmit: (draft: ExtraDraft) => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState(() => toDraft(extra ?? undefined));
  const [dishSearch, setDishSearch] = useState("");

  useEffect(() => {
    setDraft(toDraft(extra ?? undefined));
    setDishSearch("");
  }, [extra]);

  const set = <K extends keyof ExtraDraft>(key: K, value: ExtraDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const toggleCategory = (categoryId: string) => {
    setDraft((current) => ({
      ...current,
      category_ids: current.category_ids.includes(categoryId)
        ? current.category_ids.filter((id) => id !== categoryId)
        : [...current.category_ids, categoryId],
    }));
  };

  const toggleDish = (dishId: string) => {
    setDraft((current) => ({
      ...current,
      dish_ids: current.dish_ids.includes(dishId)
        ? current.dish_ids.filter((id) => id !== dishId)
        : [...current.dish_ids, dishId],
    }));
  };

  const sortedCategories = [...categories].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ru-RU"),
  );
  const categoryById = new Map(sortedCategories.map((category) => [category.id, category]));
  const pickedCategories = sortedCategories.filter((category) => draft.category_ids.includes(category.id));
  const dishById = new Map(dishes.map((dish) => [dish.id, dish]));
  const linkedFallbackById = new Map(linkedDishes(extra).map((dish) => [dish.id, dish]));
  const directDishes = draft.dish_ids
    .map((dishId) => dishById.get(dishId) ?? linkedFallbackById.get(dishId))
    .filter((dish): dish is Dish | DishExtraLinkedDish => Boolean(dish))
    .sort((a, b) => {
      const categoryOrder =
        (categoryById.get(a.category_id)?.sort_order ?? 0) - (categoryById.get(b.category_id)?.sort_order ?? 0);
      return categoryOrder || a.name.localeCompare(b.name, "ru-RU");
    });
  const directCount = Math.max(directDishes.length, draft.dish_ids.length);
  const sectionDishes = dishes
    .filter((dish) => draft.category_ids.includes(dish.category_id))
    .sort((a, b) => {
      const categoryOrder =
        (categoryById.get(a.category_id)?.sort_order ?? 0) - (categoryById.get(b.category_id)?.sort_order ?? 0);
      return categoryOrder || a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ru-RU");
    });
  const affectedDishIds = new Set([...sectionDishes.map((dish) => dish.id), ...draft.dish_ids]);
  const affectedCount = affectedDishIds.size || directCount;
  const filteredDishes = dishes.filter((dish) => {
    const needle = dishSearch.trim().toLocaleLowerCase("ru-RU");
    if (!needle) return true;
    const categoryName = categoryById.get(dish.category_id)?.name ?? "";
    return `${dish.name} ${categoryName}`.toLocaleLowerCase("ru-RU").includes(needle);
  });
  const dishGroups = sortedCategories
    .map((category) => ({
      category,
      dishes: filteredDishes.filter((dish) => dish.category_id === category.id),
    }))
    .filter((group) => group.dishes.length > 0);
  const editorTitle = draft.name.trim() || "Новая добавка";
  const priceKopecks = rubToKopecks(draft.price_rub);
  const canSave = draft.name.trim().length >= 2;

  return (
    <>
      <div className="drawer-overlay extra-editor-overlay" onClick={onClose} />
      <aside className="extra-drawer-shell" aria-label="Редактор добавки">
        <header className="extra-drawer-head">
          <div className="extra-drawer-title-block">
            <span className="metric-label">Добавки</span>
            <h2>{extra ? "Редактор добавки" : "Новая добавка"}</h2>
            <div className="extra-drawer-subline">
              {draft.is_active ? <Badge text="активна" tone="ok" /> : <Badge text="выключена" tone="muted" />}
              <span>
                {pickedCategories.length} {plural(pickedCategories.length, "раздел", "раздела", "разделов")}
              </span>
              {affectedCount > 0 ? (
                <span>
                  {affectedCount} {plural(affectedCount, "блюдо", "блюда", "блюд")}
                </span>
              ) : null}
            </div>
          </div>
          <IconButton label="Закрыть редактор" size="sm" variant="quiet" onClick={onClose}>
            <X size={17} aria-hidden />
          </IconButton>
        </header>

        <div className="extra-drawer-body">
          <aside className="extra-preview-panel">
            <div className="extra-preview-mark">
              <Plus size={34} aria-hidden />
            </div>
            <div className="extra-preview-copy">
              <span className="metric-label">Добавка к блюду</span>
              <h3>{editorTitle}</h3>
            </div>
            <div className="extra-preview-facts">
              <span>
                <small>Цена</small>
                <strong>{formatPrice(priceKopecks)}</strong>
              </span>
              <span>
                <small>Разделы</small>
                <strong>{pickedCategories.length}</strong>
              </span>
              <span>
                <small>Блюда</small>
                <strong>{affectedCount}</strong>
              </span>
              <span>
                <small>Точечно</small>
                <strong>{directCount}</strong>
              </span>
            </div>
            <div className="extra-preview-scope">
              <div className="metric-label">Где появится</div>
              {pickedCategories.length > 0 ? (
                <div className="chips-line">
                  {pickedCategories.slice(0, 6).map((category) => (
                    <span key={category.id} className="mini-chip">
                      {category.name}
                    </span>
                  ))}
                  {pickedCategories.length > 6 ? (
                    <span className="mini-chip">+{pickedCategories.length - 6}</span>
                  ) : null}
                </div>
              ) : (
                <div className="row-muted">Разделы не выбраны</div>
              )}
            </div>
            <div className="extra-preview-scope">
              <div className="metric-label">Конкретные блюда</div>
              {directDishes.length > 0 ? (
                <div className="chips-line">
                  {directDishes.slice(0, 6).map((dish) => (
                    <span key={dish.id} className="mini-chip">
                      {dish.name}
                    </span>
                  ))}
                  {directDishes.length > 6 ? <span className="mini-chip">+{directDishes.length - 6}</span> : null}
                </div>
              ) : (
                <div className="row-muted">Нет точечных блюд</div>
              )}
            </div>
          </aside>

          <main className="extra-form-panel">
            <section className="extra-form-section">
              <div className="extra-form-section-head">
                <h3>Основное</h3>
              </div>
              <div className="extra-form-grid">
                <label className="field extra-field-wide">
                  <span className="field-label">Название</span>
                  <input
                    className="input"
                    placeholder="Например, бекон 50 г"
                    value={draft.name}
                    onChange={(event) => set("name", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Цена, ₽</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder="120"
                    value={draft.price_rub}
                    onChange={(event) => set("price_rub", event.target.value.replace(/\D/g, ""))}
                  />
                </label>
                <label className="extra-toggle-card" data-active={draft.is_active}>
                  <input
                    checked={draft.is_active}
                    type="checkbox"
                    onChange={(event) => set("is_active", event.target.checked)}
                  />
                  <span className="extra-toggle-icon">
                    {draft.is_active ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
                  </span>
                  <span className="extra-toggle-copy">
                    <span>Витрина</span>
                    <strong>{draft.is_active ? "Продаётся" : "Выключена"}</strong>
                  </span>
                </label>
              </div>
            </section>

            <section className="extra-form-section">
              <div className="extra-form-section-head">
                <h3>Разделы меню</h3>
                <Badge
                  text={`${pickedCategories.length} выбрано`}
                  tone={pickedCategories.length > 0 ? "accent" : "muted"}
                />
              </div>
              <div className="extra-category-grid">
                {sortedCategories.map((category) => {
                  const checked = draft.category_ids.includes(category.id);
                  return (
                    <label key={category.id} className="extra-category-card" data-checked={checked}>
                      <input checked={checked} type="checkbox" onChange={() => toggleCategory(category.id)} />
                      <span className="extra-category-copy">
                        <span className="row-main">{category.name}</span>
                        <span className="row-sub">
                          {category.dishes_count} {plural(category.dishes_count, "блюдо", "блюда", "блюд")} в разделе
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="extra-form-section">
              <div className="extra-form-section-head">
                <h3>Блюда через разделы</h3>
                <Badge
                  text={`${sectionDishes.length} ${plural(sectionDishes.length, "блюдо", "блюда", "блюд")}`}
                  tone={sectionDishes.length > 0 ? "accent" : "muted"}
                />
              </div>
              {sectionDishes.length > 0 ? (
                <div className="extra-linked-list">
                  {sectionDishes.map((dish) => (
                    <div key={dish.id} className="extra-linked-row">
                      <span className="extra-linked-icon">
                        <Utensils size={15} aria-hidden />
                      </span>
                      <span className="extra-linked-copy">
                        <span className="row-main">{dish.name}</span>
                        <span className="row-sub">
                          {categoryById.get(dish.category_id)?.name ?? "Раздел меню"}
                          {dish.is_active ? "" : " · снято с продажи"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="extra-empty-note">Выберите раздел меню, чтобы увидеть блюда</div>
              )}
            </section>

            <section className="extra-form-section">
              <div className="extra-form-section-head">
                <h3>Конкретные блюда</h3>
                <Badge
                  text={`${directCount} ${plural(directCount, "блюдо", "блюда", "блюд")}`}
                  tone={directCount > 0 ? "accent" : "muted"}
                />
              </div>
              <label className="field">
                <span className="field-label">Поиск блюда</span>
                <span className="search-control">
                  <Search className="search-icon" size={15} aria-hidden />
                  <input
                    className="input"
                    placeholder="Название блюда или раздел"
                    value={dishSearch}
                    onChange={(event) => setDishSearch(event.target.value)}
                  />
                </span>
              </label>
              {dishGroups.length > 0 ? (
                <div className="extra-dish-groups">
                  {dishGroups.map((group) => (
                    <div key={group.category.id} className="extra-dish-group">
                      <div className="extra-dish-group-head">
                        <span>{group.category.name}</span>
                        <small>
                          {group.dishes.length} {plural(group.dishes.length, "блюдо", "блюда", "блюд")}
                        </small>
                      </div>
                      <div className="extra-dish-grid">
                        {group.dishes.map((dish) => {
                          const checked = draft.dish_ids.includes(dish.id);
                          const alreadyFromCategory = draft.category_ids.includes(dish.category_id);
                          return (
                            <label key={dish.id} className="extra-dish-card" data-checked={checked}>
                              <input checked={checked} type="checkbox" onChange={() => toggleDish(dish.id)} />
                              <span className="extra-dish-copy">
                                <span className="row-main">{dish.name}</span>
                                <span className="row-sub">
                                  {formatPrice(dish.price_kopecks)}
                                  {alreadyFromCategory ? " · уже есть через раздел" : ""}
                                  {dish.is_active ? "" : " · снято с продажи"}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="extra-empty-note">Блюда не найдены</div>
              )}
            </section>
          </main>
        </div>

        <footer className="extra-drawer-foot">
          <Button disabled={pending} variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={pending || !canSave} onClick={() => onSubmit(draft)}>
            {pending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </footer>
      </aside>
    </>
  );
}

export function ExtrasTab() {
  const queryClient = useQueryClient();
  const [density, setDensity] = useTableDensity();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DishExtra | null>(null);

  const extras = useQuery({ queryKey: ["extras"], queryFn: api.extras });
  const categories = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const dishes = useQuery({ queryKey: ["dishes"], queryFn: api.dishes });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["extras"] });

  const save = useMutation({
    mutationFn: async ({ draft, id }: { draft: ExtraDraft; id: string | null }) => {
      const payload = {
        is_active: draft.is_active,
        name: draft.name.trim(),
        price_kopecks: Number(draft.price_rub || 0) * 100,
      };
      const result = id ? await api.updateExtra(id, payload) : await api.createExtra(payload);
      await api.setExtraCategories(result.id, draft.category_ids);
      return api.setExtraDishes(result.id, draft.dish_ids);
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (result) => {
      setCreating(false);
      setSelectedId(result.id);
      refresh();
      toast.success("Добавка сохранена");
    },
  });

  const toggle = useMutation({
    mutationFn: (extra: DishExtra) => api.updateExtra(extra.id, { is_active: !extra.is_active }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteExtra(id),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      setDeleteTarget(null);
      setSelectedId(null);
      refresh();
      toast.success("Добавка удалена");
    },
  });

  const categoryById = useMemo(
    () => new Map((categories.data ?? []).map((category) => [category.id, category])),
    [categories.data],
  );

  const dishesByCategory = useMemo(() => {
    const map = new Map<string, Dish[]>();
    for (const dish of dishes.data ?? []) {
      const bucket = map.get(dish.category_id) ?? [];
      bucket.push(dish);
      map.set(dish.category_id, bucket);
    }

    for (const bucket of map.values()) {
      bucket.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ru-RU"));
    }

    return map;
  }, [dishes.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return [...(extras.data ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name, "ru-RU"))
      .filter((extra) => {
        if (!needle) return true;
        const text = [
          extra.name,
          ...categoryNames(extra, categoryById),
          ...dishesForCategoryIds(extra.category_ids, dishesByCategory).map((dish) => dish.name),
          ...linkedDishes(extra).flatMap((dish) => [dish.name, dish.category_name]),
        ]
          .join(" ")
          .toLocaleLowerCase("ru-RU");

        return text.includes(needle);
      });
  }, [categoryById, dishesByCategory, extras.data, search]);

  const selected = selectedId ? (extras.data ?? []).find((extra) => extra.id === selectedId) ?? null : null;

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("name", {
          header: "Добавка",
          cell: (info) => {
            const extra = info.row.original;
            const directCount = Math.max(linkedDishes(extra).length, extra.dishes_count);
            return (
              <div className="extra-name-cell">
                <span className="extra-name-icon">
                  <Plus size={15} aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="row-main">{info.getValue()}</div>
                  <div className="row-sub">
                    {formatPrice(extra.price_kopecks)}
                    {" · "}
                    {extra.is_active ? "показывается гостям" : "выключена"}
                    {directCount > 0 ? ` · ${directCount} ${plural(directCount, "блюдо", "блюда", "блюд")}` : ""}
                  </div>
                </div>
              </div>
            );
          },
        }),
        column.display({
          id: "coverage",
          header: "Где доступна",
          cell: (info) => {
            const extra = info.row.original;
            const names = categoryNames(extra, categoryById);
            const sectionDishes = dishesForCategoryIds(extra.category_ids, dishesByCategory);
            const dishes = linkedDishes(extra);
            const directCount = Math.max(dishes.length, extra.dishes_count);

            if (names.length === 0 && directCount === 0) {
              return <Badge text="нигде не привязана" tone="bad" />;
            }

            return (
              <div className="extra-coverage-cell">
                {names.length > 0 ? (
                  <div className="extra-coverage-block">
                    <span className="extra-coverage-label">Все блюда разделов</span>
                    <span className="extra-coverage-items">
                      {names.slice(0, 3).map((name) => (
                        <span key={name} className="mini-chip">
                          {name}
                        </span>
                      ))}
                      {names.length > 3 ? <span className="mini-chip">+{names.length - 3}</span> : null}
                    </span>
                    {sectionDishes.length > 0 ? (
                      <span className="extra-coverage-preview">
                        {sectionDishes.slice(0, 3).map((dish) => dish.name).join(", ")}
                        {sectionDishes.length > 3 ? ` +${sectionDishes.length - 3}` : ""}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {directCount > 0 ? (
                  <div className="extra-coverage-block">
                    <span className="extra-coverage-label">Точечно в блюдах</span>
                    {dishes.length > 0 ? (
                      <span className="extra-coverage-items">
                        {dishes.slice(0, 3).map((dish) => (
                          <span key={dish.id} className="mini-chip">
                            {dish.name}
                          </span>
                        ))}
                        {dishes.length > 3 ? <span className="mini-chip">+{dishes.length - 3}</span> : null}
                      </span>
                    ) : (
                      <span className="row-muted">
                        {directCount} {plural(directCount, "блюдо", "блюда", "блюд")}
                      </span>
                    )}
                  </div>
                ) : null}
              </div>
            );
          },
        }),
        column.accessor("price_kopecks", {
          header: "Цена",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => <span className="mono">{formatPrice(info.getValue())}</span>,
        }),
        column.accessor("is_active", {
          header: "Витрина",
          cell: (info) =>
            info.getValue() ? <Badge text="показывается" tone="ok" /> : <Badge text="выключена" tone="muted" />,
        }),
        column.display({
          id: "actions",
          header: "",
          meta: { align: "right" },
          cell: (info) => {
            const extra = info.row.original;
            return (
              <div className="cell-actions">
                <IconButton
                  label="Редактировать"
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setCreating(false);
                    setSelectedId(extra.id);
                  }}
                >
                  <Edit3 size={14} aria-hidden />
                </IconButton>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle.mutate(extra);
                  }}
                >
                  {extra.is_active ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                  {extra.is_active ? "Выключить" : "Включить"}
                </Button>
                <IconButton
                  label="Удалить"
                  size="xs"
                  variant="danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDeleteTarget(extra);
                  }}
                >
                  <Trash2 size={14} aria-hidden />
                </IconButton>
              </div>
            );
          },
        }),
      ]),
    [categoryById, dishesByCategory, toggle],
  );

  const stats = useMemo(() => {
    const list = extras.data ?? [];
    const active = list.filter((extra) => extra.is_active).length;
    const sectionLinked = list.filter((extra) => extra.category_ids.length > 0).length;
    const directLinks = list.reduce((sum, extra) => sum + Math.max(linkedDishes(extra).length, extra.dishes_count), 0);
    const unlinked = list.filter(
      (extra) => extra.category_ids.length === 0 && Math.max(linkedDishes(extra).length, extra.dishes_count) === 0,
    ).length;
    const average = list.length
      ? Math.round(list.reduce((sum, extra) => sum + extra.price_kopecks, 0) / list.length)
      : 0;

    return { active, average, directLinks, sectionLinked, total: list.length, unlinked };
  }, [extras.data]);

  return (
    <div className="page-layout-with-drawer extras-layout" data-drawer-open={creating || Boolean(selected)}>
      <div className="page-stack">
        <Section
          title="Добавки к блюдам"
          description="Цена, витрина, разделы меню и конкретные блюда, где добавка доступна гостю."
          action={
            <Button
              onClick={() => {
                setSelectedId(null);
                setCreating(true);
              }}
            >
              <Plus size={15} aria-hidden />
              Добавить
            </Button>
          }
        >
          <div className="metric-strip">
            <Metric
              icon={<PackageCheck size={18} aria-hidden />}
              label="Добавки"
              note="в справочнике меню"
              value={String(stats.total)}
            />
            <Metric
              icon={<BadgeCheck size={18} aria-hidden />}
              label="Активные"
              note="показываются гостям"
              tone="ok"
              value={String(stats.active)}
            />
            <Metric
              icon={<Link2 size={18} aria-hidden />}
              label="По разделам"
              note={`${stats.directLinks} ${plural(stats.directLinks, "точечная привязка", "точечные привязки", "точечных привязок")}`}
              value={String(stats.sectionLinked)}
            />
            <Metric
              icon={<Utensils size={18} aria-hidden />}
              label="Без привязки"
              note={`средняя цена ${formatPrice(stats.average)}`}
              tone={stats.unlinked > 0 ? "warn" : "ok"}
              value={String(stats.unlinked)}
            />
          </div>

          <div className="surface-toolbar">
            <label className="field toolbar-field">
              <span className="field-label">Поиск</span>
              <span className="search-control">
                <Search className="search-icon" size={15} aria-hidden />
                <input
                  className="input"
                  placeholder="Поиск добавки"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </span>
            </label>
            <span className="toolbar-spacer" />
            <DensityToggle density={density} onChange={setDensity} />
          </div>

          <DataTable
            columns={columns}
            data={rows}
            density={density}
            empty={
              <div className="empty-state">
                <h2>Добавок не найдено</h2>
                <p>Сбросьте поиск или создайте новую добавку.</p>
              </div>
            }
            getRowId={(row) => row.id}
            isLoading={extras.isPending || categories.isPending || dishes.isPending}
            selectedId={selectedId}
            onRowClick={(row) => {
              setCreating(false);
              setSelectedId(row.id);
            }}
          />
        </Section>
      </div>

      {creating || selected ? (
        <ExtraDrawer
          categories={categories.data ?? []}
          dishes={dishes.data ?? []}
          extra={selected}
          pending={save.isPending}
          onClose={() => {
            setCreating(false);
            setSelectedId(null);
          }}
          onSubmit={(draft) => save.mutate({ draft, id: selected?.id ?? null })}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          busy={remove.isPending}
          message={`Добавка «${deleteTarget.name}» пропадёт из доступных настроек блюд.`}
          title="Удалить добавку"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => remove.mutate(deleteTarget.id)}
        />
      ) : null}
    </div>
  );
}
