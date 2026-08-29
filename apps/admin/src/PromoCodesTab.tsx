import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Edit3, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { api, ApiError, formatDate, formatPrice, type PromoCode, type PromoCodeDraft } from "./api";
import { ConfirmDialog } from "./components/patterns/ConfirmDialog";
import { DataTable, DensityToggle, createAdminColumnHelper, useTableDensity } from "./components/patterns/DataTable";
import { DetailDrawer } from "./components/patterns/DetailDrawer";
import { Badge, Button, IconButton, Section, Select } from "./ui";

type PromoFilter = "all" | "active" | "inactive" | "expired";

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

const KINDS: { value: PromoCode["kind"]; label: string; hint: string }[] = [
  { value: "percent", label: "Процент", hint: "Скидка от суммы блюд" },
  { value: "fixed", label: "Сумма", hint: "Фиксированная скидка в рублях" },
  { value: "free_delivery", label: "Доставка", hint: "Гасит стоимость доставки" },
];

const column = createAdminColumnHelper<PromoCode>();

function toInputDate(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function toDraft(promo: PromoCode): PromoCodeDraft {
  const { id: _id, used_count: _used, ...draft } = promo;
  return {
    ...draft,
    ends_at: toInputDate(promo.ends_at),
    starts_at: toInputDate(promo.starts_at),
  };
}

function normalizeDraft(draft: PromoCodeDraft): PromoCodeDraft {
  return {
    ...draft,
    code: draft.code.trim().toLocaleUpperCase("ru-RU"),
    title: draft.title.trim(),
    ends_at: draft.ends_at ? `${draft.ends_at}T23:59:00Z` : null,
    starts_at: draft.starts_at ? `${draft.starts_at}T00:00:00Z` : null,
  };
}

function describe(promo: PromoCode | PromoCodeDraft): string {
  if (promo.kind === "free_delivery") return "Бесплатная доставка";
  if (promo.kind === "percent") return `-${promo.value}%`;
  return `-${Math.round(promo.value / 100)} ₽`;
}

function isExpired(promo: PromoCode): boolean {
  return promo.ends_at ? new Date(promo.ends_at).getTime() < Date.now() : false;
}

function statusBadge(promo: PromoCode) {
  if (!promo.is_active) return <Badge text="выключен" tone="muted" />;
  if (isExpired(promo)) return <Badge text="истёк" tone="bad" />;
  if (promo.usage_limit !== null && promo.used_count >= promo.usage_limit) {
    return <Badge text="лимит" tone="warn" />;
  }
  return <Badge text="активен" tone="ok" />;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function rubToKopecks(value: string): number {
  return Number(value.replace(/\D/g, "") || 0) * 100;
}

function PromoDrawer({
  onClose,
  onSubmit,
  pending,
  promo,
}: {
  onClose: () => void;
  onSubmit: (draft: PromoCodeDraft) => void;
  pending: boolean;
  promo: PromoCode | null;
}) {
  const [draft, setDraft] = useState<PromoCodeDraft>(() => (promo ? toDraft(promo) : empty));

  useEffect(() => {
    setDraft(promo ? toDraft(promo) : empty);
  }, [promo]);

  const set = <K extends keyof PromoCodeDraft>(key: K, value: PromoCodeDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <DetailDrawer
      badge={draft.is_active ? <Badge text="активен" tone="ok" /> : <Badge text="выключен" tone="muted" />}
      footer={
        <>
          <Button disabled={pending} variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={pending || draft.code.trim().length < 3} onClick={() => onSubmit(normalizeDraft(draft))}>
            {pending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </>
      }
      subtitle={promo ? "Правка условий и лимитов" : "Код появится в корзине после сохранения"}
      title={promo?.code ?? "Новый промокод"}
      onClose={onClose}
    >
      <div className="drawer-form">
        <div className="drawer-form-grid">
          <label className="field">
            <span className="field-label">Код</span>
            <input
              className="input"
              placeholder="ROMA10"
              value={draft.code}
              onChange={(event) => set("code", event.target.value.toLocaleUpperCase("ru-RU"))}
            />
          </label>

          <label className="field">
            <span className="field-label">Название</span>
            <input
              className="input"
              placeholder="Скидка 10%"
              value={draft.title}
              onChange={(event) => set("title", event.target.value)}
            />
          </label>

          <div className="field">
            <span className="field-label">Тип</span>
            <Select
              value={draft.kind}
              options={KINDS.map((item) => ({ label: item.label, description: item.hint, value: item.value }))}
              onChange={(value) => {
                const kind = value as PromoCode["kind"];
                setDraft((current) => ({
                  ...current,
                  kind,
                  value: kind === "free_delivery" ? 0 : kind === "percent" ? 10 : 50000,
                }));
              }}
            />
          </div>

          {draft.kind !== "free_delivery" ? (
            <label className="field">
              <span className="field-label">{draft.kind === "percent" ? "Процент" : "Скидка, ₽"}</span>
              <input
                className="input"
                min={0}
                type="number"
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

          <label className="field">
            <span className="field-label">Заказ от, ₽</span>
            <input
              className="input"
              inputMode="numeric"
              value={Math.round(draft.min_order_kopecks / 100)}
              onChange={(event) => set("min_order_kopecks", rubToKopecks(event.target.value))}
            />
          </label>

          <label className="field">
            <span className="field-label">Максимум скидки, ₽</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="без ограничения"
              value={draft.max_discount_kopecks ? Math.round(draft.max_discount_kopecks / 100) : ""}
              onChange={(event) =>
                set("max_discount_kopecks", event.target.value ? rubToKopecks(event.target.value) : null)
              }
            />
          </label>

          <label className="field">
            <span className="field-label">Старт</span>
            <input
              className="input"
              type="date"
              value={draft.starts_at ?? ""}
              onChange={(event) => set("starts_at", event.target.value || null)}
            />
          </label>

          <label className="field">
            <span className="field-label">Конец</span>
            <input
              className="input"
              type="date"
              value={draft.ends_at ?? ""}
              onChange={(event) => set("ends_at", event.target.value || null)}
            />
          </label>

          <label className="field">
            <span className="field-label">Всего применений</span>
            <input
              className="input"
              min={1}
              placeholder="без ограничения"
              type="number"
              value={draft.usage_limit ?? ""}
              onChange={(event) => set("usage_limit", event.target.value === "" ? null : Number(event.target.value))}
            />
          </label>

          <label className="field">
            <span className="field-label">Раз на гостя</span>
            <input
              className="input"
              min={0}
              type="number"
              value={draft.per_guest_limit}
              onChange={(event) => set("per_guest_limit", Number(event.target.value))}
            />
          </label>

          <label className="inline-check">
            <input
              checked={draft.is_active}
              type="checkbox"
              onChange={(event) => set("is_active", event.target.checked)}
            />
            Активен
          </label>
        </div>

        <div className="split-list-card">
          <div className="row-main">{describe(draft)}</div>
          <div className="row-sub">
            {KINDS.find((item) => item.value === draft.kind)?.hint}. Скидка считается до списания баллов.
          </div>
        </div>
      </div>
    </DetailDrawer>
  );
}

export function PromoCodesTab() {
  const queryClient = useQueryClient();
  const [density, setDensity] = useTableDensity();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PromoFilter>("all");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromoCode | null>(null);

  const codes = useQuery({ queryKey: ["promo-codes"], queryFn: api.promoCodes });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["promo-codes"] });

  const save = useMutation({
    mutationFn: ({ draft, id }: { draft: PromoCodeDraft; id: string | null }) =>
      id === null ? api.createPromoCode(draft) : api.updatePromoCode(id, draft),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (promo) => {
      setCreating(false);
      setSelectedId(promo.id);
      refresh();
      toast.success("Промокод сохранён");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deletePromoCode(id),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      setDeleteTarget(null);
      setSelectedId(null);
      refresh();
      toast.success("Промокод удалён");
    },
  });

  const duplicate = async (promo: PromoCode) => {
    const draft = toDraft(promo);
    await save.mutateAsync({
      draft: normalizeDraft({
        ...draft,
        code: `${draft.code}_COPY`.slice(0, 32),
        is_active: false,
      }),
      id: null,
    });
  };

  const toggle = (promo: PromoCode) =>
    save.mutate({
      draft: normalizeDraft({ ...toDraft(promo), is_active: !promo.is_active }),
      id: promo.id,
    });

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return (codes.data ?? []).filter((promo) => {
      const text = `${promo.code} ${promo.title} ${describe(promo)}`.toLocaleLowerCase("ru-RU");
      const matchesSearch = text.includes(needle);
      const matchesFilter =
        filter === "all" ||
        (filter === "active" && promo.is_active && !isExpired(promo)) ||
        (filter === "inactive" && !promo.is_active) ||
        (filter === "expired" && isExpired(promo));

      return matchesSearch && matchesFilter;
    });
  }, [codes.data, filter, search]);

  const selected = selectedId ? (codes.data ?? []).find((promo) => promo.id === selectedId) ?? null : null;

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("code", {
          header: "Код",
          cell: (info) => (
            <div>
              <div className="row-main mono">{info.getValue()}</div>
              <div className="row-sub">{info.row.original.title || describe(info.row.original)}</div>
            </div>
          ),
        }),
        column.accessor("kind", {
          header: "Скидка",
          cell: (info) => (
            <div>
              <div className="row-main">{describe(info.row.original)}</div>
              <div className="row-sub">
                {info.row.original.min_order_kopecks > 0
                  ? `от ${formatPrice(info.row.original.min_order_kopecks)}`
                  : "без порога"}
              </div>
            </div>
          ),
        }),
        column.accessor("ends_at", {
          header: "Период",
          sortFn: "datetime",
          cell: (info) => (
            <div>
              <div className="row-main">
                {info.row.original.starts_at ? formatDate(info.row.original.starts_at) : "сейчас"}
              </div>
              <div className="row-sub">{info.getValue() ? `до ${formatDate(info.getValue())}` : "бессрочно"}</div>
            </div>
          ),
        }),
        column.accessor("used_count", {
          header: "Использован",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => {
            const limit = info.row.original.usage_limit;
            return (
              <span className="mono">
                {info.getValue()}
                {limit ? ` / ${limit}` : ""}
              </span>
            );
          },
        }),
        column.accessor("is_active", {
          header: "Статус",
          cell: (info) => statusBadge(info.row.original),
        }),
        column.display({
          id: "actions",
          header: "",
          meta: { align: "right" },
          cell: (info) => {
            const promo = info.row.original;
            return (
              <div className="cell-actions">
                <IconButton
                  label="Править"
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setCreating(false);
                    setSelectedId(promo.id);
                  }}
                >
                  <Edit3 size={14} aria-hidden />
                </IconButton>
                <IconButton
                  label="Дублировать"
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    void duplicate(promo);
                  }}
                >
                  <Copy size={14} aria-hidden />
                </IconButton>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(promo);
                  }}
                >
                  {promo.is_active ? "Выключить" : "Включить"}
                </Button>
                <IconButton
                  label="Удалить"
                  size="xs"
                  variant="danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDeleteTarget(promo);
                  }}
                >
                  <Trash2 size={14} aria-hidden />
                </IconButton>
              </div>
            );
          },
        }),
      ]),
    [save],
  );

  const stats = useMemo(() => {
    const list = codes.data ?? [];
    return {
      active: list.filter((promo) => promo.is_active && !isExpired(promo)).length,
      expired: list.filter(isExpired).length,
      total: list.length,
      used: list.reduce((sum, promo) => sum + promo.used_count, 0),
    };
  }, [codes.data]);

  return (
    <div className="page-layout-with-drawer" data-drawer-open={creating || Boolean(selected)}>
      <div className="page-stack">
        <Section
          title="Промокоды"
          description="Коды для корзины: скидка, сроки действия, лимиты и активность."
          action={
            <Button
              onClick={() => {
                setSelectedId(null);
                setCreating(true);
              }}
            >
              <Plus size={15} aria-hidden />
              Новый промокод
            </Button>
          }
        >
          <div className="metric-strip">
            <div className="metric-card">
              <div className="metric-label">Всего</div>
              <div className="metric-value">{stats.total}</div>
              <div className="metric-note">кодов в базе</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Активные</div>
              <div className="metric-value">{stats.active}</div>
              <div className="metric-note">можно применить</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Истекли</div>
              <div className="metric-value">{stats.expired}</div>
              <div className="metric-note">нужна проверка</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Использований</div>
              <div className="metric-value">{stats.used}</div>
              <div className="metric-note">за всё время</div>
            </div>
          </div>

          <div className="surface-toolbar">
            <label className="field toolbar-field">
              <span className="field-label">Поиск</span>
              <span className="search-control">
                <Search className="search-icon" size={15} aria-hidden />
                <input
                  className="input"
                  placeholder="Поиск промокода"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </span>
            </label>

            <div className="filter-chips" aria-label="Фильтр промокодов">
              {[
                ["all", "Все"],
                ["active", "Активные"],
                ["inactive", "Выключены"],
                ["expired", "Истекли"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className="filter-chip"
                  data-active={filter === key}
                  type="button"
                  onClick={() => setFilter(key as PromoFilter)}
                >
                  {label}
                </button>
              ))}
            </div>

            <span className="toolbar-spacer" />
            <DensityToggle density={density} onChange={setDensity} />
          </div>

          <DataTable
            columns={columns}
            data={rows}
            density={density}
            empty={
              <div className="empty-state">
                <h2>Промокодов не найдено</h2>
                <p>Сбросьте поиск, фильтр или создайте новый код.</p>
              </div>
            }
            getRowId={(row) => row.id}
            isLoading={codes.isPending}
            selectedId={selectedId}
            onRowClick={(row) => {
              setCreating(false);
              setSelectedId(row.id);
            }}
          />
        </Section>
      </div>

      {creating || selected ? (
        <PromoDrawer
          pending={save.isPending}
          promo={selected}
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
          message={`Код ${deleteTarget.code} больше нельзя будет применить в корзине.`}
          title="Удалить промокод"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => remove.mutate(deleteTarget.id)}
        />
      ) : null}
    </div>
  );
}
