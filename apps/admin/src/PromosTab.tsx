import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Edit3,
  ImageUp,
  Plus,
  Power,
  Search,
  Trash2,
  Trophy,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  formatDate,
  mediaUrl,
  type Promotion,
  type PromotionDraft,
  type Restaurant,
} from "./api";
import { ConfirmDialog } from "./components/patterns/ConfirmDialog";
import { DataTable, DensityToggle, createAdminColumnHelper, useTableDensity } from "./components/patterns/DataTable";
import { DetailDrawer } from "./components/patterns/DetailDrawer";
import { PromoPush } from "./PromoPush";
import { Badge, Button, IconButton, Section } from "./ui";

type PromoFilter = "all" | "active" | "inactive" | "expired";

const empty: PromotionDraft = {
  description: null,
  ends_at: null,
  image_url: null,
  is_active: true,
  label: null,
  restaurant_ids: [],
  show_in_menu: false,
  sort_order: 0,
  title: "",
};

const column = createAdminColumnHelper<Promotion>();

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function toDraft(promotion: Promotion): PromotionDraft {
  return {
    description: promotion.description,
    ends_at: promotion.ends_at ? promotion.ends_at.slice(0, 10) : null,
    image_url: promotion.image_url,
    is_active: promotion.is_active,
    label: promotion.label,
    restaurant_ids: promotion.restaurant_ids,
    show_in_menu: promotion.show_in_menu,
    sort_order: promotion.sort_order,
    title: promotion.title,
  };
}

function normalizeDraft(draft: PromotionDraft): PromotionDraft {
  return {
    ...draft,
    description: draft.description?.trim() || null,
    ends_at: draft.ends_at ? `${draft.ends_at}T23:59:00Z` : null,
    label: draft.label?.trim() || null,
    title: draft.title.trim(),
  };
}

function isExpired(promotion: Promotion): boolean {
  return promotion.ends_at !== null && new Date(promotion.ends_at).getTime() < Date.now();
}

function promoStatus(promotion: Promotion) {
  if (!promotion.is_active) return <Badge text="выключена" tone="muted" />;
  if (isExpired(promotion)) return <Badge text="истекла" tone="bad" />;
  return <Badge text="активна" tone="ok" />;
}

function Metric({ label, note, value }: { label: string; note: string; value: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-note">{note}</div>
    </div>
  );
}

function PromoImage({ promotion }: { promotion: Promotion }) {
  return (
    <div className="promo-thumb">
      {promotion.image_url ? (
        <img src={mediaUrl(promotion.image_url) ?? undefined} alt="" />
      ) : (
        <Trophy size={17} aria-hidden />
      )}
    </div>
  );
}

function PromoDrawer({
  onClose,
  onSubmit,
  pending,
  promotion,
  restaurants,
}: {
  onClose: () => void;
  onSubmit: (draft: PromotionDraft) => void;
  pending: boolean;
  promotion: Promotion | null;
  restaurants: Restaurant[];
}) {
  const [draft, setDraft] = useState<PromotionDraft>(() => (promotion ? toDraft(promotion) : empty));
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setDraft(promotion ? toDraft(promotion) : empty);
  }, [promotion]);

  const set = <K extends keyof PromotionDraft>(key: K, value: PromotionDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const toggleRestaurant = (id: string) => {
    setDraft((current) => ({
      ...current,
      restaurant_ids: current.restaurant_ids.includes(id)
        ? current.restaurant_ids.filter((restaurantId) => restaurantId !== id)
        : [...current.restaurant_ids, id],
    }));
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const url = await api.uploadImage(file, "promos");
      set("image_url", url);
      toast.success("Картинка загружена");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <DetailDrawer
      badge={
        draft.is_active ? <Badge text="активна" tone="ok" /> : <Badge text="выключена" tone="muted" />
      }
      footer={
        <>
          <Button disabled={pending || uploading} variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={pending || uploading || draft.title.trim().length < 2}
            onClick={() => onSubmit(normalizeDraft(draft))}
          >
            {pending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </>
      }
      subtitle={promotion ? "Правка текста, ресторанов и показа" : "Акция появится в приложении после сохранения"}
      title={promotion?.title ?? "Новая акция"}
      onClose={onClose}
    >
      <div className="drawer-form">
        <section className="drawer-section">
          <h3 className="drawer-section-title">Контент</h3>
          <div className="drawer-form-grid">
            <label className="field" data-wide="true">
              <span className="field-label">Заголовок</span>
              <input
                className="input"
                placeholder="Паста дня — 490 ₽"
                value={draft.title}
                onChange={(event) => set("title", event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Плашка</span>
              <input
                className="input"
                maxLength={24}
                placeholder="-30%"
                value={draft.label ?? ""}
                onChange={(event) => set("label", event.target.value || null)}
              />
            </label>
            <label className="field">
              <span className="field-label">Действует до</span>
              <input
                className="input"
                type="date"
                value={draft.ends_at ?? ""}
                onChange={(event) => set("ends_at", event.target.value || null)}
              />
            </label>
            <label className="field" data-wide="true">
              <span className="field-label">Текст акции</span>
              <textarea
                className="textarea"
                value={draft.description ?? ""}
                onChange={(event) => set("description", event.target.value || null)}
              />
            </label>
          </div>
        </section>

        <section className="drawer-section">
          <h3 className="drawer-section-title">Картинка</h3>
          <div className="promo-preview">
            {draft.image_url ? (
              <img src={mediaUrl(draft.image_url) ?? undefined} alt="" />
            ) : (
              <div className="promo-preview-empty">
                <Trophy size={22} aria-hidden />
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
              <div className="row-sub">Лучше работает горизонтальная картинка с понятным блюдом или оффером.</div>
            </div>
          </div>
        </section>

        <section className="drawer-section">
          <h3 className="drawer-section-title">Рестораны</h3>
          <div className="drawer-actions">
            <Button size="xs" variant="ghost" onClick={() => set("restaurant_ids", [])}>
              Во всех
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => set("restaurant_ids", restaurants.map((restaurant) => restaurant.id))}
            >
              Отметить все
            </Button>
          </div>
          <div className="checkbox-grid bordered-list">
            {restaurants.map((restaurant) => (
              <label key={restaurant.id} className="inline-check">
                <input
                  checked={draft.restaurant_ids.includes(restaurant.id)}
                  type="checkbox"
                  onChange={() => toggleRestaurant(restaurant.id)}
                />
                {restaurant.name}
              </label>
            ))}
          </div>
        </section>

        <section className="drawer-section">
          <h3 className="drawer-section-title">Показ</h3>
          <div className="checkbox-grid">
            <label className="inline-check">
              <input
                checked={draft.is_active}
                type="checkbox"
                onChange={(event) => set("is_active", event.target.checked)}
              />
              Активна
            </label>
            <label className="inline-check">
              <input
                checked={draft.show_in_menu}
                type="checkbox"
                onChange={(event) => set("show_in_menu", event.target.checked)}
              />
              Показывать в карусели меню
            </label>
          </div>
        </section>
      </div>
    </DetailDrawer>
  );
}

export function PromosTab() {
  const queryClient = useQueryClient();
  const [density, setDensity] = useTableDensity();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PromoFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pushing, setPushing] = useState<Promotion | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Promotion | null>(null);

  const promos = useQuery({ queryKey: ["promotions"], queryFn: api.promotions });
  const restaurants = useQuery({ queryKey: ["restaurants"], queryFn: api.restaurants });
  const cities = useQuery({ queryKey: ["cities"], queryFn: api.cities });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["promotions"] });

  const save = useMutation({
    mutationFn: ({ draft, id }: { draft: PromotionDraft; id: string | null }) =>
      id === null ? api.createPromotion(draft) : api.updatePromotion(id, draft),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (promotion) => {
      setCreating(false);
      setSelectedId(promotion.id);
      refresh();
      toast.success("Акция сохранена");
    },
  });

  const remove = useMutation({
    mutationFn: api.deletePromotion,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      setDeleteTarget(null);
      setSelectedId(null);
      refresh();
      toast.success("Акция удалена");
    },
  });

  const toggle = useMutation({
    mutationFn: (promotion: Promotion) =>
      api.updatePromotion(promotion.id, normalizeDraft({ ...toDraft(promotion), is_active: !promotion.is_active })),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: refresh,
  });

  const swap = (promotion: Promotion, direction: -1 | 1) => {
    const ordered = [...(promos.data ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((item) => item.id === promotion.id);
    const next = ordered[index + direction];
    if (!next) return;

    save.mutate({ id: promotion.id, draft: normalizeDraft({ ...toDraft(promotion), sort_order: next.sort_order }) });
    save.mutate({ id: next.id, draft: normalizeDraft({ ...toDraft(next), sort_order: promotion.sort_order }) });
  };

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return [...(promos.data ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .filter((promotion) => {
        const text = `${promotion.title} ${promotion.description ?? ""} ${promotion.label ?? ""} ${promotion.restaurant_names.join(" ")}`.toLocaleLowerCase("ru-RU");
        const expired = isExpired(promotion);
        const matchesFilter =
          filter === "all" ||
          (filter === "active" && promotion.is_active && !expired) ||
          (filter === "inactive" && !promotion.is_active) ||
          (filter === "expired" && expired);
        return text.includes(needle) && matchesFilter;
      });
  }, [filter, promos.data, search]);

  const selected = selectedId ? (promos.data ?? []).find((promotion) => promotion.id === selectedId) ?? null : null;
  const active = (promos.data ?? []).filter((promotion) => promotion.is_active && !isExpired(promotion)).length;
  const expiredCount = (promos.data ?? []).filter(isExpired).length;
  const inMenu = (promos.data ?? []).filter((promotion) => promotion.show_in_menu).length;

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("title", {
          header: "Акция",
          cell: (info) => {
            const promotion = info.row.original;
            return (
              <div className="promo-row-title">
                <PromoImage promotion={promotion} />
                <div className="min-w-0">
                  <div className="row-main">{info.getValue()}</div>
                  <div className="row-sub">{promotion.description || "Без описания"}</div>
                </div>
              </div>
            );
          },
        }),
        column.display({
          id: "scope",
          header: "Где действует",
          cell: (info) => {
            const promotion = info.row.original;
            return (
              <div>
                <div className="row-main">
                  {promotion.restaurant_names.length === 0
                    ? "Все рестораны"
                    : promotion.restaurant_names.length > 3
                      ? `${promotion.restaurant_names.length} ресторанов`
                      : promotion.restaurant_names.join(", ")}
                </div>
                <div className="row-sub">
                  {promotion.ends_at ? `до ${formatDate(promotion.ends_at)}` : "бессрочно"}
                </div>
              </div>
            );
          },
        }),
        column.accessor("sort_order", {
          header: "Порядок",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => <span className="mono">{info.getValue()}</span>,
        }),
        column.display({
          id: "status",
          header: "Статус",
          cell: (info) => (
            <div className="chips-line">
              {promoStatus(info.row.original)}
              {info.row.original.label ? <Badge text={info.row.original.label} tone="warn" /> : null}
              {info.row.original.show_in_menu ? <Badge text="в меню" tone="accent" /> : null}
            </div>
          ),
        }),
        column.display({
          id: "actions",
          header: "",
          meta: { align: "right" },
          cell: (info) => {
            const promotion = info.row.original;
            return (
              <div className="cell-actions">
                <IconButton
                  label="Выше"
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    swap(promotion, -1);
                  }}
                >
                  <ArrowUp size={14} aria-hidden />
                </IconButton>
                <IconButton
                  label="Ниже"
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    swap(promotion, 1);
                  }}
                >
                  <ArrowDown size={14} aria-hidden />
                </IconButton>
                <IconButton
                  label="Править"
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setCreating(false);
                    setSelectedId(promotion.id);
                  }}
                >
                  <Edit3 size={14} aria-hidden />
                </IconButton>
                <IconButton
                  label="Отправить уведомлением"
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPushing(promotion);
                  }}
                >
                  <Bell size={14} aria-hidden />
                </IconButton>
                <IconButton
                  label={promotion.is_active ? "Выключить" : "Включить"}
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle.mutate(promotion);
                  }}
                >
                  <Power size={14} aria-hidden />
                </IconButton>
                <IconButton
                  label="Удалить"
                  size="xs"
                  variant="danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDeleteTarget(promotion);
                  }}
                >
                  <Trash2 size={14} aria-hidden />
                </IconButton>
              </div>
            );
          },
        }),
      ]),
    [toggle],
  );

  return (
    <Section
      title="Акции"
      action={
        <Button
          onClick={() => {
            setCreating(true);
            setSelectedId(null);
          }}
        >
          <Plus size={15} aria-hidden />
          Новая акция
        </Button>
      }
      description="Промо-карточки в приложении, карусель меню и быстрый push по готовому офферу."
    >
      <div className="metric-strip">
        <Metric label="Всего" note="карточек" value={String(promos.data?.length ?? 0)} />
        <Metric label="Активны" note="видны гостям" value={String(active)} />
        <Metric label="Истекли" note="по дате окончания" value={String(expiredCount)} />
        <Metric label="В меню" note="показ в карусели" value={String(inMenu)} />
      </div>

      <div className="surface-toolbar">
        <label className="field toolbar-field">
          <span className="field-label">Поиск</span>
          <span className="search-control">
            <Search className="search-icon" size={15} aria-hidden />
            <input
              className="input"
              placeholder="Поиск акции"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </span>
        </label>

        <div className="filter-chips" aria-label="Фильтр акций">
          <button className="filter-chip" data-active={filter === "all"} type="button" onClick={() => setFilter("all")}>
            Все
          </button>
          <button className="filter-chip" data-active={filter === "active"} type="button" onClick={() => setFilter("active")}>
            Активные
          </button>
          <button className="filter-chip" data-active={filter === "expired"} type="button" onClick={() => setFilter("expired")}>
            Истекшие
          </button>
          <button className="filter-chip" data-active={filter === "inactive"} type="button" onClick={() => setFilter("inactive")}>
            Выключены
          </button>
        </div>

        <span className="toolbar-spacer" />
        <DensityToggle density={density} onChange={setDensity} />
      </div>

      {promos.error ? (
        <div className="error-state">
          <h2>Не удалось загрузить акции</h2>
          <p>{errorMessage(promos.error)}</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          density={density}
          getRowId={(row) => row.id}
          isLoading={promos.isPending}
          onRowClick={(promotion) => {
            setCreating(false);
            setSelectedId(promotion.id);
          }}
          pageSize={20}
          selectedId={selectedId}
          empty={
            <div className="empty-state">
              <h2>Акций пока нет</h2>
              <p>Создайте первую промо-карточку, чтобы она появилась в клиентском приложении.</p>
            </div>
          }
        />
      )}

      {creating || selected ? (
        <PromoDrawer
          pending={save.isPending}
          promotion={creating ? null : selected}
          restaurants={restaurants.data ?? []}
          onClose={() => {
            setCreating(false);
            setSelectedId(null);
          }}
          onSubmit={(draft) => save.mutate({ draft, id: creating ? null : selected?.id ?? null })}
        />
      ) : null}

      {pushing ? (
        <PromoPush promo={pushing} cities={cities.data ?? []} onClose={() => setPushing(null)} />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          busy={remove.isPending}
          message={`Удалить акцию «${deleteTarget.title}»?`}
          title="Удалить акцию"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => remove.mutate(deleteTarget.id)}
        />
      ) : null}
    </Section>
  );
}
