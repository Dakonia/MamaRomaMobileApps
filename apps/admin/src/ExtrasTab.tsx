import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { api, ApiError, formatPrice, type Category, type DishExtra } from "./api";
import { ConfirmDialog } from "./components/patterns/ConfirmDialog";
import { DataTable, DensityToggle, createAdminColumnHelper, useTableDensity } from "./components/patterns/DataTable";
import { DetailDrawer } from "./components/patterns/DetailDrawer";
import { Badge, Button, IconButton, Section } from "./ui";

type ExtraDraft = {
  category_ids: string[];
  is_active: boolean;
  name: string;
  price_rub: string;
};

const column = createAdminColumnHelper<DishExtra>();

function toDraft(extra?: DishExtra): ExtraDraft {
  return {
    category_ids: extra?.category_ids ?? [],
    is_active: extra?.is_active ?? true,
    name: extra?.name ?? "",
    price_rub: extra ? String(Math.round(extra.price_kopecks / 100)) : "",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function ExtraDrawer({
  categories,
  extra,
  onClose,
  onSubmit,
  pending,
}: {
  categories: Category[];
  extra: DishExtra | null;
  onClose: () => void;
  onSubmit: (draft: ExtraDraft) => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState(() => toDraft(extra ?? undefined));

  useEffect(() => {
    setDraft(toDraft(extra ?? undefined));
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

  return (
    <DetailDrawer
      badge={draft.is_active ? <Badge text="активна" tone="ok" /> : <Badge text="выключена" tone="muted" />}
      footer={
        <>
          <Button disabled={pending} variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={pending || draft.name.trim().length < 2} onClick={() => onSubmit(draft)}>
            {pending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </>
      }
      subtitle={extra ? "Правка добавки и доступности по разделам" : "Создание добавки к блюдам"}
      title={extra?.name ?? "Новая добавка"}
      onClose={onClose}
    >
      <div className="drawer-form">
        <div className="drawer-form-grid">
          <label className="field" data-wide="true">
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

          <label className="inline-check">
            <input
              checked={draft.is_active}
              type="checkbox"
              onChange={(event) => set("is_active", event.target.checked)}
            />
            Продаётся
          </label>
        </div>

        <section className="drawer-section">
          <h3 className="drawer-section-title">Разделы меню</h3>
          <div className="checkbox-grid">
            {categories.map((category) => (
              <label key={category.id} className="inline-check">
                <input
                  checked={draft.category_ids.includes(category.id)}
                  type="checkbox"
                  onChange={() => toggleCategory(category.id)}
                />
                {category.name}
              </label>
            ))}
          </div>
        </section>
      </div>
    </DetailDrawer>
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
      return result;
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

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return (extras.data ?? []).filter((row) => row.name.toLocaleLowerCase("ru-RU").includes(needle));
  }, [extras.data, search]);

  const selected = selectedId ? (extras.data ?? []).find((extra) => extra.id === selectedId) ?? null : null;
  const categoryById = useMemo(
    () => new Map((categories.data ?? []).map((category) => [category.id, category.name])),
    [categories.data],
  );

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("name", {
          header: "Добавка",
          cell: (info) => {
            const extra = info.row.original;
            return (
              <div>
                <div className="row-main">{info.getValue()}</div>
                <div className="row-sub">
                  {extra.dishes_count > 0 ? `В ${extra.dishes_count} блюдах` : "Не привязана к блюдам"}
                </div>
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
        column.display({
          id: "categories",
          header: "Разделы",
          cell: (info) => {
            const names = info.row.original.category_ids
              .slice(0, 3)
              .map((id) => categoryById.get(id))
              .filter(Boolean);

            return names.length > 0 ? (
              <div className="chips-line">
                {names.map((name) => (
                  <span key={name} className="mini-chip">
                    {name}
                  </span>
                ))}
                {info.row.original.category_ids.length > names.length ? (
                  <span className="mini-chip">+{info.row.original.category_ids.length - names.length}</span>
                ) : null}
              </div>
            ) : (
              <span className="row-muted">нет</span>
            );
          },
        }),
        column.accessor("is_active", {
          header: "Статус",
          cell: (info) => (info.getValue() ? <Badge text="активна" tone="ok" /> : <Badge text="выключена" tone="muted" />),
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
                  label="Править"
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
    [categoryById, toggle],
  );

  const stats = useMemo(() => {
    const list = extras.data ?? [];
    const active = list.filter((extra) => extra.is_active).length;
    const linked = list.filter((extra) => extra.category_ids.length > 0 || extra.dishes_count > 0).length;
    const average = list.length
      ? Math.round(list.reduce((sum, extra) => sum + extra.price_kopecks, 0) / list.length)
      : 0;

    return { active, average, linked, total: list.length };
  }, [extras.data]);

  return (
    <div className="page-layout-with-drawer" data-drawer-open={creating || Boolean(selected)}>
      <div className="page-stack">
        <Section
          title="Добавки к блюдам"
          description="Цены, доступность и привязка добавок к разделам меню."
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
            <div className="metric-card">
              <div className="metric-label">Всего</div>
              <div className="metric-value">{stats.total}</div>
              <div className="metric-note">добавок в базе</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Активные</div>
              <div className="metric-value">{stats.active}</div>
              <div className="metric-note">доступны гостю</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Связаны</div>
              <div className="metric-value">{stats.linked}</div>
              <div className="metric-note">есть раздел или блюдо</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Средняя цена</div>
              <div className="metric-value">{formatPrice(stats.average)}</div>
              <div className="metric-note">по всем добавкам</div>
            </div>
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
            isLoading={extras.isPending || categories.isPending}
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
