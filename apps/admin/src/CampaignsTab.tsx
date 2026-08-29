import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Edit3, ImageUp, Play, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  formatDateTime,
  mediaUrl,
  type AdminRestaurant,
  type Audience,
  type Campaign,
  type CampaignWrite,
  type City,
  type Promotion,
  type Reach,
} from "./api";
import { ConfirmDialog } from "./components/patterns/ConfirmDialog";
import { DataTable, DensityToggle, createAdminColumnHelper, useTableDensity } from "./components/patterns/DataTable";
import { DetailDrawer } from "./components/patterns/DetailDrawer";
import { Badge, Button, IconButton, Select } from "./ui";

type CampaignFilter = "all" | "draft" | "scheduled" | "sent";

const EMPTY: CampaignWrite = {
  audience: {},
  body: "",
  image_url: null,
  name: "",
  scheduled_at: null,
  target: { screen: "promos" },
  title: "",
};

const SCREENS: { label: string; needsId?: boolean; value: string }[] = [
  { value: "promos", label: "Лента акций" },
  { value: "promo", label: "Конкретная акция", needsId: true },
  { value: "menu", label: "Меню" },
  { value: "cart", label: "Корзина" },
  { value: "booking", label: "Бронь стола" },
  { value: "loyalty", label: "Карта лояльности" },
];

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "muted" | "bad" }> = {
  cancelled: { label: "отменена", tone: "muted" },
  draft: { label: "черновик", tone: "muted" },
  scheduled: { label: "запланирована", tone: "warn" },
  sending: { label: "отправляется", tone: "warn" },
  sent: { label: "отправлена", tone: "ok" },
};

const column = createAdminColumnHelper<Campaign>();

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function campaignToDraft(campaign: Campaign): CampaignWrite {
  return {
    audience: campaign.audience,
    body: campaign.body,
    image_url: campaign.image_url,
    name: campaign.name,
    scheduled_at: campaign.scheduled_at,
    target: campaign.target,
    title: campaign.title,
  };
}

function cleanAudience(audience: Audience): Audience {
  return {
    booked: audience.booked || undefined,
    cities: audience.cities?.length ? audience.cities : undefined,
    min_orders: audience.min_orders,
    ordered_within_days: audience.ordered_within_days,
    restaurants: audience.restaurants?.length ? audience.restaurants : undefined,
    tiers: audience.tiers?.length ? audience.tiers : undefined,
  };
}

function cleanDraft(draft: CampaignWrite): CampaignWrite {
  return {
    ...draft,
    audience: cleanAudience(draft.audience),
    body: draft.body.trim(),
    name: draft.name.trim() || draft.title.trim(),
    title: draft.title.trim(),
  };
}

function statusBadge(campaign: Campaign) {
  const state = STATUS[campaign.status] ?? STATUS.draft;
  return <Badge text={state.label} tone={state.tone} />;
}

function useDebounced<T>(value: T, delayMs = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}

function AudienceReach({ reach }: { reach: Reach | undefined }) {
  return (
    <div className="reach-card">
      <div>
        <div className="metric-label">Охват</div>
        <div className="metric-value">{reach?.count ?? "..."}</div>
      </div>
      <div className="row-sub">
        {reach
          ? `Всего гостей ${reach.guests}, push включён у ${reach.with_push}, на акции согласны ${reach.agreed}`
          : "Считаем аудиторию"}
      </div>
    </div>
  );
}

function PushPreview({ draft }: { draft: CampaignWrite }) {
  return (
    <div className="push-preview">
      <div className="push-icon">
        <Play size={15} aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="row-main">{draft.title || "Заголовок уведомления"}</div>
        <div className="row-sub">{draft.body || "Короткий текст, который прочитает гость"}</div>
      </div>
      {draft.image_url ? (
        <img className="push-media" src={mediaUrl(draft.image_url) ?? undefined} alt="" />
      ) : null}
    </div>
  );
}

function CampaignDrawer({
  campaign,
  cities,
  forceNote,
  onClose,
  onForce,
  onSubmit,
  pending,
  promos,
  restaurants,
}: {
  campaign: Campaign | null;
  cities: City[];
  forceNote: string | null;
  onClose: () => void;
  onForce: () => void;
  onSubmit: (draft: CampaignWrite, send: boolean) => void;
  pending: boolean;
  promos: Promotion[];
  restaurants: AdminRestaurant[];
}) {
  const [draft, setDraft] = useState<CampaignWrite>(() => (campaign ? campaignToDraft(campaign) : EMPTY));
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setDraft(campaign ? campaignToDraft(campaign) : EMPTY);
  }, [campaign]);

  const debouncedAudience = useDebounced(draft.audience);
  const reach = useQuery({
    queryKey: ["campaign-audience", debouncedAudience],
    queryFn: () => api.campaignAudience(cleanAudience(debouncedAudience)),
  });

  const screen = SCREENS.find((item) => item.value === draft.target.screen) ?? SCREENS[0];
  const set = <K extends keyof CampaignWrite>(key: K, value: CampaignWrite[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const audience = (patch: Partial<Audience>) =>
    setDraft((current) => ({ ...current, audience: { ...current.audience, ...patch } }));

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const url = await api.uploadImage(file, "promos");
      set("image_url", url);
      toast.success("Изображение загружено");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const canSubmit = draft.title.trim().length >= 2 && draft.body.trim().length >= 2;

  return (
    <DetailDrawer
      badge={campaign ? statusBadge(campaign) : <Badge text="новая" tone="accent" />}
      footer={
        <>
          <Button disabled={pending || uploading} variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={pending || uploading || !canSubmit} variant="ghost" onClick={() => onSubmit(cleanDraft(draft), false)}>
            Сохранить
          </Button>
          <Button disabled={pending || uploading || !canSubmit} onClick={() => onSubmit(cleanDraft(draft), true)}>
            {pending ? "Отправляем..." : "Отправить"}
          </Button>
        </>
      }
      subtitle={campaign ? "Правка рассылки и аудитории" : "Создание рекламного push-уведомления"}
      title={campaign?.name || "Новая рассылка"}
      onClose={onClose}
    >
      <div className="drawer-form">
        {forceNote ? (
          <div className="alert-band">
            <span>{forceNote}</span>
            <span className="toolbar-spacer" />
            <Button size="xs" variant="ghost" onClick={onForce}>
              Отправить всё равно
            </Button>
          </div>
        ) : null}

        <section className="drawer-section">
          <h3 className="drawer-section-title">Сообщение</h3>
          <div className="drawer-form-grid">
            <label className="field">
              <span className="field-label">Название</span>
              <input
                className="input"
                placeholder="Видно только в админке"
                value={draft.name}
                onChange={(event) => set("name", event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Заголовок</span>
              <input
                className="input"
                placeholder="Новая акция"
                value={draft.title}
                onChange={(event) => set("title", event.target.value)}
              />
            </label>
            <label className="field" data-wide="true">
              <span className="field-label">Текст</span>
              <textarea
                className="textarea"
                placeholder="Одно-два коротких предложения"
                value={draft.body}
                onChange={(event) => set("body", event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="drawer-section">
          <h3 className="drawer-section-title">Переход</h3>
          <div className="drawer-form-grid">
            <div className="field">
              <span className="field-label">Куда ведёт нажатие</span>
              <Select
                value={draft.target.screen ?? "promos"}
                options={SCREENS.map((item) => ({ label: item.label, value: item.value }))}
                onChange={(value) => set("target", { screen: value })}
              />
            </div>
            {screen.needsId ? (
              <div className="field">
                <span className="field-label">Акция</span>
                <Select
                  value={draft.target.id ?? ""}
                  options={[
                    { label: "Выберите акцию", value: "" },
                    ...promos.map((promo) => ({ label: promo.title, value: promo.id })),
                  ]}
                  onChange={(value) => set("target", { ...draft.target, id: value })}
                />
              </div>
            ) : null}
            <label className="field">
              <span className="field-label">Отправить позже</span>
              <input
                className="input"
                type="datetime-local"
                value={draft.scheduled_at?.slice(0, 16) ?? ""}
                onChange={(event) =>
                  set(
                    "scheduled_at",
                    event.target.value ? new Date(event.target.value).toISOString() : null,
                  )
                }
              />
            </label>
          </div>
        </section>

        <section className="drawer-section">
          <h3 className="drawer-section-title">Изображение</h3>
          <div className="push-preview">
            <label className="upload-button">
              <ImageUp size={15} aria-hidden />
              {uploading ? "Загружаем..." : "Загрузить"}
              <input
                accept="image/*"
                disabled={uploading}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
            </label>
            <span className="row-sub">Картинка усилит уведомление на Android и в раскрытом push на iOS.</span>
            <span className="toolbar-spacer" />
            {draft.image_url ? <img className="push-media" src={mediaUrl(draft.image_url) ?? undefined} alt="" /> : null}
          </div>
        </section>

        <section className="drawer-section">
          <h3 className="drawer-section-title">Аудитория</h3>
          <div className="drawer-form-grid">
            <div className="field">
              <span className="field-label">Город</span>
              <Select
                value={draft.audience.cities?.[0] ?? ""}
                options={[
                  { label: "Все города", value: "" },
                  ...cities.map((city) => ({ label: city.name, value: city.id })),
                ]}
                onChange={(value) => audience({ cities: value ? [value] : [] })}
              />
            </div>
            <div className="field">
              <span className="field-label">Ресторан</span>
              <Select
                value={draft.audience.restaurants?.[0] ?? ""}
                options={[
                  { label: "Любой", value: "" },
                  ...restaurants.map((restaurant) => ({ label: restaurant.name, value: restaurant.id })),
                ]}
                onChange={(value) => audience({ restaurants: value ? [value] : [] })}
              />
            </div>
            <label className="field">
              <span className="field-label">Заказывал за дней</span>
              <input
                className="input"
                inputMode="numeric"
                placeholder="не важно"
                value={draft.audience.ordered_within_days ?? ""}
                onChange={(event) =>
                  audience({
                    ordered_within_days: event.target.value
                      ? Number(event.target.value.replace(/\D/g, ""))
                      : undefined,
                  })
                }
              />
            </label>
            <label className="field">
              <span className="field-label">Заказов не меньше</span>
              <input
                className="input"
                inputMode="numeric"
                placeholder="любой"
                value={draft.audience.min_orders ?? ""}
                onChange={(event) =>
                  audience({
                    min_orders: event.target.value
                      ? Number(event.target.value.replace(/\D/g, ""))
                      : undefined,
                  })
                }
              />
            </label>
            <label className="inline-check">
              <input
                checked={Boolean(draft.audience.booked)}
                type="checkbox"
                onChange={(event) => audience({ booked: event.target.checked })}
              />
              Только те, кто бронировал стол
            </label>
          </div>
        </section>

        <AudienceReach reach={reach.data} />
        <PushPreview draft={draft} />
      </div>
    </DetailDrawer>
  );
}

function ForceSendDialog({
  busy,
  campaign,
  message,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  campaign: Campaign;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      busy={busy}
      confirmLabel="Отправить"
      message={`${message} Рассылка: «${campaign.name}».`}
      title="Отправить всё равно"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function CampaignsTab() {
  const queryClient = useQueryClient();
  const [density, setDensity] = useTableDensity();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CampaignFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [forceTarget, setForceTarget] = useState<{ campaign: Campaign; message: string } | null>(null);

  const campaigns = useQuery({ queryKey: ["campaigns"], queryFn: api.campaigns });
  const restaurants = useQuery({ queryKey: ["admin-restaurants"], queryFn: api.adminRestaurants });
  const cities = useQuery({ queryKey: ["cities"], queryFn: api.cities });
  const promos = useQuery({ queryKey: ["promotions"], queryFn: api.promotions });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["campaigns"] });

  const upsert = useMutation({
    mutationFn: async ({
      draft,
      force,
      id,
      send,
    }: {
      draft: CampaignWrite;
      force?: boolean;
      id: string | null;
      send: boolean;
    }) => {
      const saved = id ? await api.updateCampaign(id, draft) : await api.createCampaign(draft);
      if (!send) return { campaign: saved, message: null };
      const sent = await api.sendCampaign(saved.id, Boolean(force));
      return { campaign: sent, message: sent.error };
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: ({ campaign, message }) => {
      setSelectedId(campaign.id);
      refresh();
      if (message) {
        setForceTarget({ campaign, message });
        toast.warning(message);
        return;
      }

      setCreating(false);
      toast.success("Рассылка сохранена");
    },
  });

  const copy = useMutation({
    mutationFn: api.copyCampaign,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (campaign) => {
      setSelectedId(campaign.id);
      refresh();
      toast.success("Копия создана");
    },
  });

  const send = useMutation({
    mutationFn: ({ force, id }: { force?: boolean; id: string }) => api.sendCampaign(id, Boolean(force)),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (campaign) => {
      setSelectedId(campaign.id);
      refresh();
      if (campaign.error) {
        setForceTarget({ campaign, message: campaign.error });
        toast.warning(campaign.error);
        return;
      }
      setForceTarget(null);
      toast.success("Рассылка отправлена");
    },
  });

  const remove = useMutation({
    mutationFn: api.deleteCampaign,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      setDeleteTarget(null);
      setSelectedId(null);
      refresh();
      toast.success("Рассылка удалена");
    },
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return (campaigns.data ?? []).filter((campaign) => {
      const text = `${campaign.name} ${campaign.title} ${campaign.body}`.toLocaleLowerCase("ru-RU");
      const matchesFilter =
        filter === "all" ||
        campaign.status === filter ||
        (filter === "sent" && campaign.sent_count > 0);
      return text.includes(needle) && matchesFilter;
    });
  }, [campaigns.data, filter, search]);

  const selected = selectedId
    ? (campaigns.data ?? []).find((campaign) => campaign.id === selectedId) ?? null
    : null;

  const total = campaigns.data?.length ?? 0;
  const sentCount = (campaigns.data ?? []).filter((campaign) => campaign.sent_count > 0).length;
  const scheduled = (campaigns.data ?? []).filter((campaign) => campaign.status === "scheduled").length;
  const planned = (campaigns.data ?? []).reduce((sum, campaign) => sum + campaign.planned_count, 0);

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("name", {
          header: "Рассылка",
          cell: (info) => {
            const campaign = info.row.original;
            return (
              <div>
                <div className="row-main">{info.getValue() || campaign.title}</div>
                <div className="row-sub">{campaign.title}</div>
              </div>
            );
          },
        }),
        column.accessor("status", {
          header: "Статус",
          cell: (info) => statusBadge(info.row.original),
        }),
        column.accessor("planned_count", {
          header: "Аудитория",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => {
            const campaign = info.row.original;
            return (
              <div>
                <div className="mono row-main">{info.getValue()}</div>
                <div className="row-sub">
                  {campaign.scheduled_at ? `на ${formatDateTime(campaign.scheduled_at)}` : "без расписания"}
                </div>
              </div>
            );
          },
        }),
        column.accessor("sent_count", {
          header: "Отправлено",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => {
            const campaign = info.row.original;
            return (
              <div>
                <div className="mono row-main">{info.getValue()}</div>
                <div className="row-sub">
                  {campaign.opened_count > 0 ? `открыли ${campaign.opened_count}` : "открытий нет"}
                </div>
              </div>
            );
          },
        }),
        column.display({
          id: "actions",
          header: "",
          meta: { align: "right" },
          cell: (info) => {
            const campaign = info.row.original;
            return (
              <div className="cell-actions">
                <IconButton
                  label="Открыть"
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setCreating(false);
                    setSelectedId(campaign.id);
                  }}
                >
                  <Edit3 size={14} aria-hidden />
                </IconButton>
                <IconButton
                  label="Создать копию"
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    copy.mutate(campaign.id);
                  }}
                >
                  <Copy size={14} aria-hidden />
                </IconButton>
                <IconButton
                  label="Отправить"
                  size="xs"
                  variant="ghost"
                  disabled={campaign.status === "sending"}
                  onClick={(event) => {
                    event.stopPropagation();
                    send.mutate({ id: campaign.id });
                  }}
                >
                  <Play size={14} aria-hidden />
                </IconButton>
                <IconButton
                  label="Удалить"
                  size="xs"
                  variant="danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDeleteTarget(campaign);
                  }}
                >
                  <Trash2 size={14} aria-hidden />
                </IconButton>
              </div>
            );
          },
        }),
      ]),
    [copy, send],
  );

  return (
    <div className="page-stack">
      <div className="metric-strip">
        <div className="metric-card">
          <div className="metric-label">Всего</div>
          <div className="metric-value">{total}</div>
          <div className="metric-note">рассылок</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Отправлены</div>
          <div className="metric-value">{sentCount}</div>
          <div className="metric-note">имеют отправки</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Запланированы</div>
          <div className="metric-value">{scheduled}</div>
          <div className="metric-note">ждут времени</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Аудитория</div>
          <div className="metric-value">{planned}</div>
          <div className="metric-note">в планах рассылок</div>
        </div>
      </div>

      <div className="surface-toolbar">
        <label className="field toolbar-field">
          <span className="field-label">Поиск</span>
          <span className="search-control">
            <Search className="search-icon" size={15} aria-hidden />
            <input
              className="input"
              placeholder="Поиск рассылки"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </span>
        </label>

        <div className="filter-chips" aria-label="Статус рассылок">
          <button className="filter-chip" data-active={filter === "all"} type="button" onClick={() => setFilter("all")}>
            Все
          </button>
          <button className="filter-chip" data-active={filter === "draft"} type="button" onClick={() => setFilter("draft")}>
            Черновики
          </button>
          <button className="filter-chip" data-active={filter === "scheduled"} type="button" onClick={() => setFilter("scheduled")}>
            План
          </button>
          <button className="filter-chip" data-active={filter === "sent"} type="button" onClick={() => setFilter("sent")}>
            Отправлены
          </button>
        </div>

        <span className="toolbar-spacer" />
        <DensityToggle density={density} onChange={setDensity} />
        <Button
          onClick={() => {
            setCreating(true);
            setSelectedId(null);
          }}
        >
          <Plus size={15} aria-hidden />
          Новая рассылка
        </Button>
      </div>

      {campaigns.error ? (
        <div className="error-state">
          <h2>Не удалось загрузить рассылки</h2>
          <p>{errorMessage(campaigns.error)}</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          density={density}
          getRowId={(row) => row.id}
          isLoading={campaigns.isPending}
          onRowClick={(campaign) => {
            setCreating(false);
            setSelectedId(campaign.id);
          }}
          pageSize={20}
          selectedId={selectedId}
          empty={
            <div className="empty-state">
              <h2>Рассылок пока нет</h2>
              <p>Создайте первую кампанию, выберите аудиторию и отправьте push гостям.</p>
            </div>
          }
        />
      )}

      {creating || selected ? (
        <CampaignDrawer
          campaign={creating ? null : selected}
          cities={cities.data ?? []}
          forceNote={forceTarget && selected && forceTarget.campaign.id === selected.id ? forceTarget.message : null}
          pending={upsert.isPending || send.isPending}
          promos={promos.data ?? []}
          restaurants={restaurants.data ?? []}
          onClose={() => {
            setCreating(false);
            setSelectedId(null);
          }}
          onForce={() => {
            if (forceTarget) send.mutate({ force: true, id: forceTarget.campaign.id });
          }}
          onSubmit={(draft, shouldSend) =>
            upsert.mutate({ draft, id: creating ? null : selected?.id ?? null, send: shouldSend })
          }
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          busy={remove.isPending}
          message={`Удалить рассылку «${deleteTarget.name || deleteTarget.title}»?`}
          title="Удалить рассылку"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => remove.mutate(deleteTarget.id)}
        />
      ) : null}

      {forceTarget ? (
        <ForceSendDialog
          busy={send.isPending}
          campaign={forceTarget.campaign}
          message={forceTarget.message}
          onCancel={() => setForceTarget(null)}
          onConfirm={() => send.mutate({ force: true, id: forceTarget.campaign.id })}
        />
      ) : null}
    </div>
  );
}
