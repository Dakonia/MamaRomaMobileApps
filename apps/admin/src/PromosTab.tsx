import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Edit3,
  Eye,
  EyeOff,
  ImageUp,
  Megaphone,
  Plus,
  Power,
  Search,
  Send,
  Store,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { PromoPush } from "./PromoPush";
import { Badge, Button, IconButton, Section } from "./ui";

type PromoFilter = "all" | "active" | "scheduled" | "inactive" | "expired";

const empty: PromotionDraft = {
  description: null,
  ends_at: null,
  image_url: null,
  is_active: true,
  label: null,
  restaurant_ids: [],
  show_in_menu: false,
  sort_order: 0,
  starts_at: null,
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
    starts_at: promotion.starts_at ? promotion.starts_at.slice(0, 10) : null,
    title: promotion.title,
  };
}

function normalizeDraft(draft: PromotionDraft): PromotionDraft {
  return {
    ...draft,
    description: draft.description?.trim() || null,
    ends_at: draft.ends_at ? `${draft.ends_at}T23:59:00Z` : null,
    label: draft.label?.trim() || null,
    starts_at: draft.starts_at ? `${draft.starts_at}T00:00:00Z` : null,
    title: draft.title.trim(),
  };
}

function isExpired(promotion: Promotion): boolean {
  return promotion.ends_at !== null && new Date(promotion.ends_at).getTime() < Date.now();
}

function isScheduled(promotion: Promotion): boolean {
  return promotion.starts_at !== null && new Date(promotion.starts_at).getTime() > Date.now();
}

function promoStatus(promotion: Promotion) {
  if (!promotion.is_active) return <Badge text="выключена" tone="muted" />;
  if (isExpired(promotion)) return <Badge text="истекла" tone="bad" />;
  if (isScheduled(promotion)) return <Badge text="запланирована" tone="accent" />;
  return <Badge text="активна" tone="ok" />;
}

function draftStatus(draft: PromotionDraft) {
  if (!draft.is_active) return <Badge text="выключена" tone="muted" />;
  if (draft.ends_at && new Date(draft.ends_at).getTime() < Date.now()) return <Badge text="истекла" tone="bad" />;
  if (draft.starts_at && new Date(draft.starts_at).getTime() > Date.now()) return <Badge text="запланирована" tone="accent" />;
  return <Badge text="активна" tone="ok" />;
}

function periodLabel(item: Promotion | PromotionDraft): string {
  if (item.starts_at && item.ends_at) return `${formatDate(item.starts_at)} — ${formatDate(item.ends_at)}`;
  if (item.starts_at) return `с ${formatDate(item.starts_at)}`;
  if (item.ends_at) return `до ${formatDate(item.ends_at)}`;
  return "без срока окончания";
}

function placementLabel(item: Pick<Promotion | PromotionDraft, "show_in_menu">): string {
  return item.show_in_menu ? "Лента акций и карусель меню" : "Только лента акций";
}

function scopeLabel(item: Pick<Promotion | PromotionDraft, "restaurant_ids">, restaurants?: Restaurant[]): string {
  if (item.restaurant_ids.length === 0) return "Вся сеть";
  if (!restaurants) return `${item.restaurant_ids.length} ресторанов`;
  const names = restaurants.filter((restaurant) => item.restaurant_ids.includes(restaurant.id)).map((restaurant) => restaurant.name);
  if (names.length === 0) return `${item.restaurant_ids.length} ресторанов`;
  if (names.length === 1) return names[0];
  return `${names.length} ресторанов`;
}

function promotionScopeLabel(promotion: Promotion): string {
  if (promotion.restaurant_names.length === 0) return "Вся сеть";
  if (promotion.restaurant_names.length === 1) return promotion.restaurant_names[0];
  return `${promotion.restaurant_names.length} ресторанов`;
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

  const networkWide = draft.restaurant_ids.length === 0;
  const selectedRestaurants = restaurants.filter((restaurant) => draft.restaurant_ids.includes(restaurant.id));
  const restaurantCount = networkWide ? restaurants.length : selectedRestaurants.length;
  const selectedModeCount = selectedRestaurants.length > 0 ? selectedRestaurants.length : restaurants.length > 0 ? 1 : 0;
  const previewTitle = draft.title.trim() || "Новая акция";
  const previewDescription = draft.description?.trim() || "Описание появится в карточке акции.";
  const periodInvalid = Boolean(draft.starts_at && draft.ends_at && draft.starts_at > draft.ends_at);
  const canSave = draft.title.trim().length >= 2 && !periodInvalid;
  const switchToSelectedRestaurants = () => {
    if (draft.restaurant_ids.length > 0) return;
    set("restaurant_ids", restaurants[0] ? [restaurants[0].id] : []);
  };

  return (
    <>
      <div className="drawer-overlay promo-editor-overlay" onClick={onClose} />
      <aside className="promo-drawer-shell" aria-label="Редактор акции">
        <header className="promo-drawer-head">
          <div className="promo-drawer-title-block">
            <span className="metric-label">Акции</span>
            <h2>{promotion ? "Редактор акции" : "Новая акция"}</h2>
            <div className="promo-drawer-subline">
              {draftStatus(draft)}
              <span>{placementLabel(draft)}</span>
              <span>{scopeLabel(draft, restaurants)}</span>
            </div>
          </div>
          <IconButton label="Закрыть редактор" size="sm" variant="quiet" onClick={onClose}>
            <X size={17} aria-hidden />
          </IconButton>
        </header>

        <div className="promo-drawer-body">
          <aside className="promo-preview-panel">
            <div className="promo-editor-card">
              <div className="promo-editor-media">
                {draft.image_url ? (
                  <img src={mediaUrl(draft.image_url) ?? undefined} alt="" />
                ) : (
                  <div className="promo-editor-empty">
                    <Trophy size={30} aria-hidden />
                  </div>
                )}
                {draft.label ? <span className="promo-editor-label">{draft.label}</span> : null}
              </div>
              <div className="promo-editor-card-body">
                <div className="chips-line">
                  {draftStatus(draft)}
                  {draft.show_in_menu ? <Badge text="в меню" tone="accent" /> : null}
                </div>
                <h3>{previewTitle}</h3>
                <p>{previewDescription}</p>
              </div>
            </div>

            <div className="promo-preview-facts">
              <span>
                <small>Показ</small>
                <strong>{draft.show_in_menu ? "Лента + меню" : "Лента"}</strong>
              </span>
              <span>
                <small>Рестораны</small>
                <strong>{networkWide ? "Вся сеть" : restaurantCount}</strong>
              </span>
              <span>
                <small>Период</small>
                <strong>{periodLabel(draft)}</strong>
              </span>
              <span>
                <small>Порядок</small>
                <strong>{draft.sort_order}</strong>
              </span>
            </div>

            <div className="promo-preview-scope">
              <div className="metric-label">Где действует</div>
              {networkWide ? (
                <div className="row-muted">Вся сеть ресторанов</div>
              ) : selectedRestaurants.length > 0 ? (
                <div className="chips-line">
                  {selectedRestaurants.slice(0, 6).map((restaurant) => (
                    <span key={restaurant.id} className="mini-chip">
                      {restaurant.name}
                    </span>
                  ))}
                  {selectedRestaurants.length > 6 ? (
                    <span className="mini-chip">+{selectedRestaurants.length - 6}</span>
                  ) : null}
                </div>
              ) : (
                <div className="row-muted">Рестораны не выбраны</div>
              )}
            </div>
          </aside>

          <main className="promo-form-panel">
            <section className="promo-form-section">
              <div className="promo-form-section-head">
                <h3>Контент карточки</h3>
              </div>
              <div className="promo-form-grid">
                <label className="field promo-field-wide">
                  <span className="field-label">Заголовок</span>
                  <input
                    className="input"
                    placeholder="Паста дня за 490 ₽"
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
                <div className="field promo-upload-field">
                  <span className="field-label">Картинка</span>
                  <label className="upload-button promo-upload-button">
                    <ImageUp size={15} aria-hidden />
                    {uploading ? "Загружаем..." : draft.image_url ? "Заменить" : "Загрузить"}
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
                </div>
                <label className="field promo-field-wide">
                  <span className="field-label">Текст акции</span>
                  <textarea
                    className="textarea promo-description-input"
                    placeholder="Коротко опишите механику и выгоду для гостя"
                    value={draft.description ?? ""}
                    onChange={(event) => set("description", event.target.value || null)}
                  />
                </label>
              </div>
            </section>

            <section className="promo-form-section">
              <div className="promo-form-section-head">
                <h3>Показ и сроки</h3>
              </div>
              <div className="promo-toggle-grid">
                <label className="promo-toggle-card" data-active={draft.is_active}>
                  <input checked={draft.is_active} type="checkbox" onChange={(event) => set("is_active", event.target.checked)} />
                  <span className="promo-toggle-icon">
                    {draft.is_active ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
                  </span>
                  <span className="promo-toggle-copy">
                    <span>Публикация</span>
                    <strong>{draft.is_active ? "Видна гостям" : "Выключена"}</strong>
                  </span>
                </label>
                <label className="promo-toggle-card" data-active={draft.show_in_menu}>
                  <input
                    checked={draft.show_in_menu}
                    type="checkbox"
                    onChange={(event) => set("show_in_menu", event.target.checked)}
                  />
                  <span className="promo-toggle-icon">
                    <Megaphone size={16} aria-hidden />
                  </span>
                  <span className="promo-toggle-copy">
                    <span>Размещение</span>
                    <strong>{draft.show_in_menu ? "Лента и меню" : "Только лента"}</strong>
                  </span>
                </label>
              </div>
              <div className="promo-form-grid">
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
                  <span className="field-label">Порядок</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={draft.sort_order}
                    onChange={(event) => set("sort_order", Number(event.target.value.replace(/\D/g, "") || 0))}
                  />
                </label>
                {periodInvalid ? (
                  <div className="form-warning promo-field-wide">Дата старта не может быть позже даты окончания.</div>
                ) : null}
              </div>
            </section>

            <section className="promo-form-section">
              <div className="promo-form-section-head">
                <h3>Рестораны</h3>
                <Badge text={networkWide ? "вся сеть" : `${selectedRestaurants.length} выбрано`} tone={networkWide ? "ok" : "accent"} />
              </div>
              <div className="promo-scope-mode-grid">
                <button className="promo-scope-mode" data-active={networkWide} type="button" onClick={() => set("restaurant_ids", [])}>
                  <Store size={16} aria-hidden />
                  <span>
                    <strong>Вся сеть</strong>
                    <small>{restaurants.length} ресторанов</small>
                  </span>
                </button>
                <button
                  className="promo-scope-mode"
                  data-active={!networkWide}
                  type="button"
                  onClick={switchToSelectedRestaurants}
                >
                  <Store size={16} aria-hidden />
                  <span>
                    <strong>Выбрать точки</strong>
                    <small>{selectedModeCount} в списке</small>
                  </span>
                </button>
              </div>
              {!networkWide ? (
                <>
                  <div className="drawer-actions">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => set("restaurant_ids", restaurants.map((restaurant) => restaurant.id))}
                    >
                      Отметить все
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => set("restaurant_ids", [])}>
                      Вся сеть
                    </Button>
                  </div>
                  <div className="promo-restaurant-grid">
                    {restaurants.map((restaurant) => {
                      const checked = draft.restaurant_ids.includes(restaurant.id);
                      return (
                        <label key={restaurant.id} className="promo-restaurant-card" data-checked={checked}>
                          <input checked={checked} type="checkbox" onChange={() => toggleRestaurant(restaurant.id)} />
                          <span className="row-main">{restaurant.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </section>
          </main>
        </div>

        <footer className="promo-drawer-foot">
          <Button disabled={pending || uploading} variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={pending || uploading || !canSave} onClick={() => onSubmit(normalizeDraft(draft))}>
            {pending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </footer>
      </aside>
    </>
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
      .filter((promotion) => {
        const text = [
          promotion.title,
          promotion.description ?? "",
          promotion.label ?? "",
          promotion.restaurant_names.join(" "),
          placementLabel(promotion),
          periodLabel(promotion),
        ]
          .join(" ")
          .toLocaleLowerCase("ru-RU");
        const expired = isExpired(promotion);
        const scheduled = isScheduled(promotion);
        const matchesFilter =
          filter === "all" ||
          (filter === "active" && promotion.is_active && !expired && !scheduled) ||
          (filter === "scheduled" && promotion.is_active && scheduled) ||
          (filter === "inactive" && !promotion.is_active) ||
          (filter === "expired" && expired);
        return text.includes(needle) && matchesFilter;
      })
      .sort((a, b) => {
        if (filter === "all") {
          const aExpired = isExpired(a);
          const bExpired = isExpired(b);
          if (aExpired !== bExpired) return aExpired ? 1 : -1;
        }
        return a.sort_order - b.sort_order;
      });
  }, [filter, promos.data, search]);

  const selected = selectedId ? (promos.data ?? []).find((promotion) => promotion.id === selectedId) ?? null : null;
  const promoList = promos.data ?? [];
  const active = promoList.filter((promotion) => promotion.is_active && !isExpired(promotion) && !isScheduled(promotion)).length;
  const scheduledCount = promoList.filter((promotion) => promotion.is_active && isScheduled(promotion)).length;
  const expiredCount = promoList.filter(isExpired).length;
  const inMenu = promoList.filter((promotion) => promotion.show_in_menu).length;
  const networkWide = promoList.filter((promotion) => promotion.restaurant_ids.length === 0).length;

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
                  <div className="row-sub promo-row-description">{promotion.description || "Описание не заполнено"}</div>
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
              <div className="promo-scope-cell">
                <div className="row-main">{promotionScopeLabel(promotion)}</div>
                {promotion.restaurant_names.length > 0 ? (
                  <div className="chips-line">
                    {promotion.restaurant_names.slice(0, 3).map((name) => (
                      <span key={name} className="mini-chip">
                        {name}
                      </span>
                    ))}
                    {promotion.restaurant_names.length > 3 ? (
                      <span className="mini-chip">+{promotion.restaurant_names.length - 3}</span>
                    ) : null}
                  </div>
                ) : (
                  <div className="row-sub">все рестораны сети</div>
                )}
              </div>
            );
          },
        }),
        column.display({
          id: "placement",
          header: "Показ",
          cell: (info) => {
            const promotion = info.row.original;
            return (
              <div className="chips-line">
                <Badge text="лента акций" tone="accent" />
                {promotion.show_in_menu ? <Badge text="карусель меню" tone="ok" /> : null}
              </div>
            );
          },
        }),
        column.display({
          id: "period",
          header: "Период",
          cell: (info) => <span className="row-main">{periodLabel(info.row.original)}</span>,
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
                  label="Отправить push"
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPushing(promotion);
                  }}
                >
                  <Send size={14} aria-hidden />
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
    [swap, toggle],
  );

  return (
    <div className="page-layout-with-drawer promos-layout" data-drawer-open={creating || Boolean(selected)}>
      <div className="page-stack">
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
          description="Промо-карточки в ленте, карусель меню, сроки показа и рестораны действия."
        >
          <div className="metric-strip">
            <Metric
              icon={<Trophy size={18} aria-hidden />}
              label="Акции"
              note="в промо-ленте"
              value={String(promos.data?.length ?? 0)}
            />
            <Metric
              icon={<Eye size={18} aria-hidden />}
              label="Активные"
              note={`${scheduledCount} запланировано`}
              tone="ok"
              value={String(active)}
            />
            <Metric
              icon={<Megaphone size={18} aria-hidden />}
              label="В меню"
              note="видны в карусели"
              value={String(inMenu)}
            />
            <Metric
              icon={<CalendarDays size={18} aria-hidden />}
              label="Истекшие"
              note={`${networkWide} на всю сеть`}
              tone={expiredCount > 0 ? "warn" : "ok"}
              value={String(expiredCount)}
            />
          </div>

          <div className="surface-toolbar">
            <label className="field toolbar-field">
              <span className="field-label">Поиск</span>
              <span className="search-control">
                <Search className="search-icon" size={15} aria-hidden />
                <input
                  className="input"
                  placeholder="Название, текст, ресторан"
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
              <button
                className="filter-chip"
                data-active={filter === "scheduled"}
                type="button"
                onClick={() => setFilter("scheduled")}
              >
                Запланированные
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
        </Section>
      </div>

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

      {pushing ? <PromoPush promo={pushing} cities={cities.data ?? []} onClose={() => setPushing(null)} /> : null}

      {deleteTarget ? (
        <ConfirmDialog
          busy={remove.isPending}
          message={`Удалить акцию «${deleteTarget.title}»?`}
          title="Удалить акцию"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => remove.mutate(deleteTarget.id)}
        />
      ) : null}
    </div>
  );
}
