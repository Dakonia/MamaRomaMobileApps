import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  CalendarClock,
  Check,
  Clock3,
  Copy,
  Crown,
  Edit3,
  Eye,
  ImageUp,
  MapPin,
  MessageSquareText,
  MousePointerClick,
  Play,
  Plus,
  Search,
  Send,
  ShoppingBag,
  Store,
  Target,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  formatDateTime,
  mediaUrl,
  tenant,
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
import { Badge, Button, IconButton, Select } from "./ui";

type CampaignFilter = "all" | "draft" | "scheduled" | "sent";
type ScheduleMode = "now" | "later";

type AudiencePreset = {
  audience: Audience;
  icon: ReactNode;
  key: string;
  label: string;
  note: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const EMPTY: CampaignWrite = {
  audience: {},
  body: "",
  image_url: null,
  name: "",
  scheduled_at: null,
  target: { screen: "promos" },
  title: "",
};

const SCREENS: { description: string; label: string; needsId?: boolean; value: string }[] = [
  { value: "promos", label: "Лента акций", description: "Открывает общий экран акций" },
  { value: "promo", label: "Конкретная акция", description: "Ведёт на выбранную акцию", needsId: true },
  { value: "menu", label: "Меню", description: "Гость сразу попадает к блюдам" },
  { value: "cart", label: "Корзина", description: "Подходит для доставки и допродаж" },
  { value: "booking", label: "Бронь стола", description: "Открывает запись на стол" },
  { value: "loyalty", label: "Карта лояльности", description: "Показывает баллы и уровень" },
];

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "muted" | "bad" }> = {
  cancelled: { label: "отменена", tone: "muted" },
  draft: { label: "черновик", tone: "muted" },
  scheduled: { label: "запланирована", tone: "warn" },
  sending: { label: "отправляется", tone: "warn" },
  sent: { label: "отправлена", tone: "ok" },
};

const HIGH_TIER_CODES = tenant.loyalty.tiers.slice(1).map((tier) => tier.code);

const AUDIENCE_PRESETS: AudiencePreset[] = [
  {
    key: "all",
    label: "Вся push-база",
    note: "Все с push и согласием",
    icon: <Users size={16} aria-hidden />,
    audience: {},
  },
  {
    key: "regulars",
    label: "Часто заказывают",
    note: "3+ заказа за 90 дней",
    icon: <ShoppingBag size={16} aria-hidden />,
    audience: { min_orders: 3, ordered_within_days: 90 },
  },
  {
    key: "recent",
    label: "Тёплые гости",
    note: "Заказывали за 30 дней",
    icon: <Clock3 size={16} aria-hidden />,
    audience: { ordered_within_days: 30 },
  },
  {
    key: "booking",
    label: "Бронировали стол",
    note: "Есть история броней",
    icon: <CalendarClock size={16} aria-hidden />,
    audience: { booked: true },
  },
  {
    key: "loyalty",
    label: "Лояльные гости",
    note: "Amico и выше",
    icon: <Crown size={16} aria-hidden />,
    audience: { tiers: HIGH_TIER_CODES },
  },
];

const column = createAdminColumnHelper<Campaign>();

function emptyDraft(): CampaignWrite {
  return { ...EMPTY, audience: {}, target: { ...EMPTY.target } };
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function campaignToDraft(campaign: Campaign): CampaignWrite {
  return {
    audience: campaign.audience ?? {},
    body: campaign.body,
    image_url: campaign.image_url,
    name: campaign.name,
    scheduled_at: campaign.scheduled_at,
    target: campaign.target ?? { screen: "promos" },
    title: campaign.title,
  };
}

function cleanAudience(audience: Audience): Audience {
  const orderedWithin = Number(audience.ordered_within_days);
  const minOrders = Number(audience.min_orders);

  return {
    booked: audience.booked || undefined,
    cities: audience.cities?.length ? audience.cities : undefined,
    min_orders: Number.isFinite(minOrders) && minOrders > 0 ? minOrders : undefined,
    ordered_within_days: Number.isFinite(orderedWithin) && orderedWithin > 0 ? orderedWithin : undefined,
    restaurants: audience.restaurants?.length ? audience.restaurants : undefined,
    tiers: audience.tiers?.length ? audience.tiers : undefined,
  };
}

function cleanTarget(target: CampaignWrite["target"]): CampaignWrite["target"] {
  const screen = target.screen || "promos";
  const current = SCREENS.find((item) => item.value === screen);
  return current?.needsId && target.id ? { screen, id: target.id } : { screen };
}

function cleanDraft(draft: CampaignWrite): CampaignWrite {
  return {
    ...draft,
    audience: cleanAudience(draft.audience),
    body: draft.body.trim(),
    image_url: draft.image_url || null,
    name: draft.name.trim() || draft.title.trim(),
    target: cleanTarget(draft.target),
    title: draft.title.trim(),
  };
}

function statusBadge(campaign: Campaign) {
  const state = STATUS[campaign.status] ?? STATUS.draft;
  return <Badge text={state.label} tone={state.tone} />;
}

function normalizeDateInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (!digits) return "";
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function normalizeTimeInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function toScheduleParts(value: string | null): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  return dateToScheduleParts(date);
}

function dateToScheduleParts(date: Date): { date: string; time: string } {
  const pad = (part: number) => part.toString().padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function defaultScheduleParts(): { date: string; time: string } {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(12, 0, 0, 0);
  return dateToScheduleParts(next);
}

function scheduleIso(mode: ScheduleMode, date: string, time: string): string | null {
  if (mode === "now") return null;
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return null;
  return new Date(`${date}T${time}:00`).toISOString();
}

function scheduleLabel(value: string | null): string {
  return value ? formatDateTime(value) : "сразу после запуска";
}

function audienceSignature(audience: Audience): string {
  const clean = cleanAudience(audience);
  return JSON.stringify({
    booked: clean.booked,
    cities: [...(clean.cities ?? [])].sort(),
    min_orders: clean.min_orders,
    ordered_within_days: clean.ordered_within_days,
    restaurants: [...(clean.restaurants ?? [])].sort(),
    tiers: [...(clean.tiers ?? [])].sort(),
  });
}

function activePreset(audience: Audience): string {
  const signature = audienceSignature(audience);
  return AUDIENCE_PRESETS.find((preset) => audienceSignature(preset.audience) === signature)?.key ?? "manual";
}

function toggleId(values: string[] | undefined, id: string): string[] {
  const current = values ?? [];
  return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
}

function screenLabel(screen: string | undefined): string {
  return SCREENS.find((item) => item.value === screen)?.label ?? "Лента акций";
}

function targetLabel(target: CampaignWrite["target"], promos: Promotion[]): string {
  const label = screenLabel(target.screen);
  if (target.screen !== "promo") return label;
  const promo = promos.find((item) => item.id === target.id);
  return promo ? `${label}: ${promo.title}` : "Конкретная акция";
}

function cityName(id: string, cities: City[]): string {
  return cities.find((city) => city.id === id)?.name ?? "Город";
}

function restaurantName(id: string, restaurants: AdminRestaurant[]): string {
  return restaurants.find((restaurant) => restaurant.id === id)?.name ?? "Ресторан";
}

function tierName(code: string): string {
  return tenant.loyalty.tiers.find((tier) => tier.code === code)?.title ?? code;
}

function audienceLabels(audience: Audience, cities: City[], restaurants: AdminRestaurant[]): string[] {
  const clean = cleanAudience(audience);
  const labels: string[] = [];

  if (clean.min_orders) labels.push(`от ${clean.min_orders} заказов`);
  if (clean.ordered_within_days) labels.push(`за ${clean.ordered_within_days} дней`);
  if (clean.booked) labels.push("бронировали стол");
  if (clean.cities?.length) labels.push(clean.cities.map((id) => cityName(id, cities)).join(", "));
  if (clean.restaurants?.length) labels.push(clean.restaurants.map((id) => restaurantName(id, restaurants)).join(", "));
  if (clean.tiers?.length) labels.push(clean.tiers.map(tierName).join(", "));

  return labels.length ? labels : ["вся push-база"];
}

function reachLevel(count: number | undefined, total: number | undefined): "empty" | "low" | "mid" | "high" | "full" {
  if (!count || !total) return "empty";
  const ratio = count / total;
  if (ratio >= 0.95) return "full";
  if (ratio >= 0.65) return "high";
  if (ratio >= 0.3) return "mid";
  return "low";
}

function openLevel(campaign: Campaign): "empty" | "low" | "mid" | "high" | "full" {
  if (!campaign.sent_count || !campaign.opened_count) return "empty";
  const ratio = campaign.opened_count / campaign.sent_count;
  if (ratio >= 0.75) return "full";
  if (ratio >= 0.5) return "high";
  if (ratio >= 0.25) return "mid";
  return "low";
}

function useDebounced<T>(value: T, delayMs = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
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

function AudienceReach({ reach }: { reach: Reach | undefined }) {
  const level = reachLevel(reach?.count, reach?.agreed);

  return (
    <div className="campaign-reach-card">
      <div className="campaign-reach-head">
        <div>
          <div className="metric-label">Охват</div>
          <div className="campaign-reach-value">{reach?.count ?? "..."}</div>
        </div>
        <Badge text={reach ? "рассчитан" : "считаем"} tone={reach ? "ok" : "muted"} />
      </div>
      <div className="campaign-progress">
        <span data-level={level} />
      </div>
      <div className="campaign-reach-breakdown">
        <span>
          <strong>{reach?.guests ?? "..."}</strong>
          <small>гостей в базе</small>
        </span>
        <span>
          <strong>{reach?.with_push ?? "..."}</strong>
          <small>с push</small>
        </span>
        <span>
          <strong>{reach?.agreed ?? "..."}</strong>
          <small>с согласием</small>
        </span>
      </div>
    </div>
  );
}

function CampaignPhonePreview({
  draft,
  target,
}: {
  draft: CampaignWrite;
  target: string;
}) {
  const image = draft.image_url ? mediaUrl(draft.image_url) : null;

  return (
    <div className="campaign-phone-preview" aria-label="Превью push-уведомления">
      <div className="campaign-phone-top">
        <span>10:24</span>
        <span>5G</span>
      </div>
      <div className="campaign-phone-screen">
        <div className="campaign-phone-app">
          <BellRing size={15} aria-hidden />
          <span>Mama Roma</span>
          <small>сейчас</small>
        </div>
        <div className="campaign-phone-push">
          <div className="campaign-phone-copy">
            <strong>{draft.title.trim() || "Заголовок рассылки"}</strong>
            <span>{draft.body.trim() || "Текст уведомления, который увидит гость в приложении"}</span>
          </div>
          {image ? <img src={image} alt="" /> : null}
        </div>
        <div className="campaign-phone-target">
          <MousePointerClick size={14} aria-hidden />
          <span>{target}</span>
        </div>
      </div>
    </div>
  );
}

function CampaignRuleList({
  audience,
  cities,
  restaurants,
  schedule,
  target,
}: {
  audience: Audience;
  cities: City[];
  restaurants: AdminRestaurant[];
  schedule: string;
  target: string;
}) {
  return (
    <div className="campaign-rule-list">
      <div className="campaign-rule-row">
        <Users size={15} aria-hidden />
        <span>
          <small>Кому уйдёт</small>
          <strong>{audienceLabels(audience, cities, restaurants).join(" · ")}</strong>
        </span>
      </div>
      <div className="campaign-rule-row">
        <Target size={15} aria-hidden />
        <span>
          <small>Куда ведёт</small>
          <strong>{target}</strong>
        </span>
      </div>
      <div className="campaign-rule-row">
        <CalendarClock size={15} aria-hidden />
        <span>
          <small>Время отправки</small>
          <strong>{schedule}</strong>
        </span>
      </div>
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
  const initialDraft = campaign ? campaignToDraft(campaign) : emptyDraft();
  const initialSchedule = toScheduleParts(initialDraft.scheduled_at);
  const [draft, setDraft] = useState<CampaignWrite>(initialDraft);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(initialDraft.scheduled_at ? "later" : "now");
  const [scheduleDate, setScheduleDate] = useState(initialSchedule.date);
  const [scheduleTime, setScheduleTime] = useState(initialSchedule.time);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const next = campaign ? campaignToDraft(campaign) : emptyDraft();
    const parts = toScheduleParts(next.scheduled_at);
    setDraft(next);
    setScheduleMode(next.scheduled_at ? "later" : "now");
    setScheduleDate(parts.date);
    setScheduleTime(parts.time);
  }, [campaign]);

  const set = <K extends keyof CampaignWrite>(key: K, value: CampaignWrite[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const audience = (patch: Partial<Audience>) =>
    setDraft((current) => ({ ...current, audience: { ...current.audience, ...patch } }));
  const applyAudience = (preset: AudiencePreset) =>
    setDraft((current) => ({ ...current, audience: { ...preset.audience } }));

  const normalizedAudience = useMemo(() => cleanAudience(draft.audience), [draft.audience]);
  const debouncedAudience = useDebounced(normalizedAudience);
  const reach = useQuery({
    queryKey: ["campaign-audience", debouncedAudience],
    queryFn: () => api.campaignAudience(debouncedAudience),
  });

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

  const selectedScreen = SCREENS.find((item) => item.value === draft.target.screen) ?? SCREENS[0];
  const currentPreset = activePreset(draft.audience);
  const filteredRestaurants = draft.audience.cities?.length
    ? restaurants.filter((restaurant) => draft.audience.cities?.includes(restaurant.city_id))
    : restaurants;
  const scheduledAt = scheduleIso(scheduleMode, scheduleDate, scheduleTime);
  const scheduleInvalid = scheduleMode === "later" && (!DATE_RE.test(scheduleDate) || !TIME_RE.test(scheduleTime));
  const targetInvalid = Boolean(selectedScreen.needsId && !draft.target.id);
  const canSubmit = draft.title.trim().length >= 2 && draft.body.trim().length >= 2 && !scheduleInvalid && !targetInvalid;
  const target = targetLabel(draft.target, promos);
  const schedulePreview = scheduleMode === "later" && scheduleInvalid ? "заполните дату и время" : scheduleLabel(scheduledAt);
  const preparedDraft = () => cleanDraft({ ...draft, scheduled_at: scheduledAt });
  const chooseLater = () => {
    const next = defaultScheduleParts();
    setScheduleMode("later");
    setScheduleDate((current) => current || next.date);
    setScheduleTime((current) => current || next.time);
  };

  return (
    <>
      <div className="drawer-overlay campaign-editor-overlay" onClick={onClose} />
      <aside className="campaign-drawer-shell" aria-label="Редактор рассылки">
        <header className="campaign-drawer-head">
          <div className="campaign-title-block">
            <span className="metric-label">Рассылка</span>
            <h2>{campaign?.name || draft.name || "Новая рассылка"}</h2>
            <div className="campaign-drawer-subline">
              {campaign ? statusBadge(campaign) : <Badge text="новая" tone="accent" />}
              <span>{target}</span>
              <span>{schedulePreview}</span>
            </div>
          </div>
          <IconButton label="Закрыть редактор" size="sm" variant="quiet" onClick={onClose}>
            <X size={17} aria-hidden />
          </IconButton>
        </header>

        <div className="campaign-drawer-body">
          <aside className="campaign-preview-panel">
            <CampaignPhonePreview draft={draft} target={target} />
            <AudienceReach reach={reach.data} />
            <CampaignRuleList
              audience={draft.audience}
              cities={cities}
              restaurants={restaurants}
              schedule={schedulePreview}
              target={target}
            />
            {campaign ? (
              <div className="campaign-result-panel">
                <div className="campaign-result-row">
                  <span>
                    <small>Запланировано</small>
                    <strong>{campaign.planned_count}</strong>
                  </span>
                  <span>
                    <small>Отправлено</small>
                    <strong>{campaign.sent_count}</strong>
                  </span>
                  <span>
                    <small>Открыли</small>
                    <strong>{campaign.opened_count}</strong>
                  </span>
                </div>
                <div className="campaign-progress">
                  <span data-level={openLevel(campaign)} />
                </div>
              </div>
            ) : null}
          </aside>

          <main className="campaign-form-panel">
            {forceNote ? (
              <div className="campaign-form-section">
                <div className="alert-band">
                  <span>{forceNote}</span>
                  <span className="toolbar-spacer" />
                  <Button size="xs" variant="ghost" onClick={onForce}>
                    Отправить всё равно
                  </Button>
                </div>
              </div>
            ) : null}

            <section className="campaign-form-section">
              <div className="campaign-section-head">
                <h3>Сообщение</h3>
              </div>
              <div className="campaign-form-grid">
                <label className="field">
                  <span className="field-label">Название в админке</span>
                  <input
                    className="input"
                    maxLength={160}
                    placeholder="Сентябрьская рассылка"
                    value={draft.name}
                    onChange={(event) => set("name", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Заголовок push</span>
                  <input
                    className="input"
                    maxLength={120}
                    placeholder="Пицца к ужину"
                    value={draft.title}
                    onChange={(event) => set("title", event.target.value)}
                  />
                </label>
                <label className="field campaign-field-wide">
                  <span className="field-label">Текст уведомления</span>
                  <textarea
                    className="textarea campaign-message-input"
                    maxLength={240}
                    placeholder="Короткое сообщение без лишнего шума"
                    value={draft.body}
                    onChange={(event) => set("body", event.target.value)}
                  />
                </label>
              </div>
            </section>

            <section className="campaign-form-section">
              <div className="campaign-section-head">
                <h3>Переход и время</h3>
              </div>
              <div className="campaign-form-grid">
                <div className="field">
                  <span className="field-label">Экран после нажатия</span>
                  <Select
                    value={draft.target.screen ?? "promos"}
                    options={SCREENS.map((item) => ({
                      description: item.description,
                      label: item.label,
                      value: item.value,
                    }))}
                    onChange={(value) => set("target", { screen: value })}
                  />
                </div>
                {selectedScreen.needsId ? (
                  <div className="field">
                    <span className="field-label">Акция</span>
                    <Select
                      value={draft.target.id ?? ""}
                      options={[
                        { label: "Выберите акцию", value: "" },
                        ...promos.map((promo) => ({ label: promo.title, value: promo.id })),
                      ]}
                      onChange={(value) => set("target", { ...draft.target, id: value || undefined })}
                    />
                    {targetInvalid ? <span className="form-warning">Выберите акцию для перехода.</span> : null}
                  </div>
                ) : null}
              </div>

              <div className="campaign-schedule-grid">
                <button
                  className="campaign-schedule-card"
                  data-active={scheduleMode === "now"}
                  type="button"
                  onClick={() => setScheduleMode("now")}
                >
                  <Send size={16} aria-hidden />
                  <span>
                    <strong>Отправить сейчас</strong>
                    <small>Сохранит и запустит рассылку</small>
                  </span>
                  {scheduleMode === "now" ? <Check size={15} aria-hidden /> : null}
                </button>
                <button
                  className="campaign-schedule-card"
                  data-active={scheduleMode === "later"}
                  type="button"
                  onClick={chooseLater}
                >
                  <CalendarClock size={16} aria-hidden />
                  <span>
                    <strong>Запланировать</strong>
                    <small>Рассылка останется в плане до выбранного времени</small>
                  </span>
                  {scheduleMode === "later" ? <Check size={15} aria-hidden /> : null}
                </button>
              </div>

              {scheduleMode === "later" ? (
                <div className="campaign-form-grid">
                  <label className="field">
                    <span className="field-label">Дата</span>
                    <input
                      className="input mono"
                      inputMode="numeric"
                      placeholder="2026-09-01"
                      value={scheduleDate}
                      onChange={(event) => setScheduleDate(normalizeDateInput(event.target.value))}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Время</span>
                    <input
                      className="input mono"
                      inputMode="numeric"
                      placeholder="12:30"
                      value={scheduleTime}
                      onChange={(event) => setScheduleTime(normalizeTimeInput(event.target.value))}
                    />
                  </label>
                  {scheduleInvalid ? (
                    <div className="form-warning campaign-field-wide">Заполните дату и время в формате 2026-09-01 и 12:30.</div>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="campaign-form-section">
              <div className="campaign-section-head">
                <h3>Изображение</h3>
                {draft.image_url ? (
                  <Button size="xs" variant="ghost" onClick={() => set("image_url", null)}>
                    Убрать
                  </Button>
                ) : null}
              </div>
              <div className="campaign-upload-panel">
                <label className="upload-button">
                  <ImageUp size={15} aria-hidden />
                  {uploading ? "Загружаем..." : "Загрузить изображение"}
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
                <span className="row-sub">Картинка появится в раскрытом push и в истории сообщений приложения.</span>
                {draft.image_url ? <img src={mediaUrl(draft.image_url) ?? undefined} alt="" /> : null}
              </div>
            </section>

            <section className="campaign-form-section">
              <div className="campaign-section-head">
                <h3>Аудитория</h3>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    audience({
                      booked: undefined,
                      cities: [],
                      min_orders: undefined,
                      ordered_within_days: undefined,
                      restaurants: [],
                      tiers: [],
                    })
                  }
                >
                  Сбросить
                </Button>
              </div>

              <div className="campaign-audience-presets">
                {AUDIENCE_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    className="campaign-audience-card"
                    data-active={currentPreset === preset.key}
                    type="button"
                    onClick={() => applyAudience(preset)}
                  >
                    <span className="campaign-audience-icon">{preset.icon}</span>
                    <span>
                      <strong>{preset.label}</strong>
                      <small>{preset.note}</small>
                    </span>
                    {currentPreset === preset.key ? <Check size={15} aria-hidden /> : null}
                  </button>
                ))}
              </div>

              <div className="campaign-form-grid">
                <label className="field">
                  <span className="field-label">Заказывал за последние, дней</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder="например 30"
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
                    placeholder="например 3"
                    value={draft.audience.min_orders ?? ""}
                    onChange={(event) =>
                      audience({
                        min_orders: event.target.value ? Number(event.target.value.replace(/\D/g, "")) : undefined,
                      })
                    }
                  />
                </label>
                <label className="campaign-toggle-card campaign-field-wide" data-active={Boolean(draft.audience.booked)}>
                  <input
                    checked={Boolean(draft.audience.booked)}
                    type="checkbox"
                    onChange={(event) => audience({ booked: event.target.checked || undefined })}
                  />
                  <CalendarClock size={16} aria-hidden />
                  <span>
                    <small>Брони</small>
                    <strong>Только гости, которые бронировали стол</strong>
                  </span>
                </label>
              </div>

              <div className="campaign-scope-block">
                <div className="campaign-section-head">
                  <h4>География заказов</h4>
                  <span className="toolbar-note">Гость попадает по городу или ресторану, где он уже делал заказ.</span>
                </div>
                <div className="campaign-place-grid">
                  <button
                    className="campaign-place-chip"
                    data-active={!draft.audience.cities?.length}
                    type="button"
                    onClick={() => audience({ cities: [] })}
                  >
                    Все города
                  </button>
                  {cities.map((city) => (
                    <button
                      key={city.id}
                      className="campaign-place-chip"
                      data-active={draft.audience.cities?.includes(city.id)}
                      type="button"
                      onClick={() => audience({ cities: toggleId(draft.audience.cities, city.id), restaurants: [] })}
                    >
                      <MapPin size={14} aria-hidden />
                      {city.name}
                    </button>
                  ))}
                </div>
                <div className="campaign-place-grid campaign-restaurant-grid">
                  <button
                    className="campaign-place-chip"
                    data-active={!draft.audience.restaurants?.length}
                    type="button"
                    onClick={() => audience({ restaurants: [] })}
                  >
                    Любой ресторан
                  </button>
                  {filteredRestaurants.map((restaurant) => (
                    <button
                      key={restaurant.id}
                      className="campaign-place-chip"
                      data-active={draft.audience.restaurants?.includes(restaurant.id)}
                      type="button"
                      onClick={() => audience({ restaurants: toggleId(draft.audience.restaurants, restaurant.id) })}
                    >
                      <Store size={14} aria-hidden />
                      {restaurant.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="campaign-scope-block">
                <div className="campaign-section-head">
                  <h4>Уровень лояльности</h4>
                </div>
                <div className="campaign-tier-grid">
                  <button
                    className="campaign-place-chip"
                    data-active={!draft.audience.tiers?.length}
                    type="button"
                    onClick={() => audience({ tiers: [] })}
                  >
                    Все уровни
                  </button>
                  {tenant.loyalty.tiers.map((tier) => (
                    <button
                      key={tier.code}
                      className="campaign-place-chip"
                      data-active={draft.audience.tiers?.includes(tier.code)}
                      type="button"
                      onClick={() => audience({ tiers: toggleId(draft.audience.tiers, tier.code) })}
                    >
                      <Crown size={14} aria-hidden />
                      {tier.title}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </main>
        </div>

        <footer className="campaign-drawer-foot">
          <Button disabled={pending || uploading} variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={pending || uploading || !canSubmit} variant="ghost" onClick={() => onSubmit(preparedDraft(), false)}>
            Сохранить
          </Button>
          <Button
            disabled={pending || uploading || !canSubmit}
            onClick={() => onSubmit(preparedDraft(), scheduleMode === "now")}
          >
            {pending ? "Сохраняем..." : scheduleMode === "later" ? "Запланировать" : "Отправить сейчас"}
          </Button>
        </footer>
      </aside>
    </>
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
      id,
      send,
    }: {
      draft: CampaignWrite;
      id: string | null;
      send: boolean;
    }) => {
      const saved = id ? await api.updateCampaign(id, draft) : await api.createCampaign(draft);
      if (!send) return { campaign: saved, message: null };
      const sent = await api.sendCampaign(saved.id);
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
      const labels = audienceLabels(campaign.audience, cities.data ?? [], restaurants.data ?? []);
      const text = [
        campaign.name,
        campaign.title,
        campaign.body,
        targetLabel(campaign.target, promos.data ?? []),
        ...labels,
      ]
        .join(" ")
        .toLocaleLowerCase("ru-RU");
      const matchesFilter =
        filter === "all" ||
        campaign.status === filter ||
        (filter === "sent" && campaign.sent_count > 0);
      return text.includes(needle) && matchesFilter;
    });
  }, [campaigns.data, cities.data, filter, promos.data, restaurants.data, search]);

  const selected = selectedId
    ? (campaigns.data ?? []).find((campaign) => campaign.id === selectedId) ?? null
    : null;

  const stats = useMemo(() => {
    const list = campaigns.data ?? [];
    const sent = list.filter((campaign) => campaign.sent_count > 0).length;
    const scheduled = list.filter((campaign) => campaign.status === "scheduled").length;
    const planned = list.reduce((sum, campaign) => sum + campaign.planned_count, 0);
    const opened = list.reduce((sum, campaign) => sum + campaign.opened_count, 0);
    return {
      opened,
      planned,
      scheduled,
      sent,
      total: list.length,
    };
  }, [campaigns.data]);

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("name", {
          header: "Рассылка",
          cell: (info) => {
            const campaign = info.row.original;
            return (
              <div className="campaign-table-title">
                <span className="campaign-table-icon">
                  <MessageSquareText size={15} aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="row-main">{info.getValue() || campaign.title}</div>
                  <div className="row-sub">{campaign.body}</div>
                </div>
              </div>
            );
          },
        }),
        column.display({
          id: "audience",
          header: "Аудитория",
          cell: (info) => {
            const campaign = info.row.original;
            return (
              <div className="campaign-audience-cell">
                <div className="row-main mono">{campaign.planned_count}</div>
                <div className="chips-line">
                  {audienceLabels(campaign.audience, cities.data ?? [], restaurants.data ?? []).slice(0, 3).map((label) => (
                    <span key={label} className="mini-chip">
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            );
          },
        }),
        column.display({
          id: "target",
          header: "Переход и время",
          cell: (info) => {
            const campaign = info.row.original;
            return (
              <div className="campaign-target-cell">
                <div className="row-main">{targetLabel(campaign.target, promos.data ?? [])}</div>
                <div className="row-sub">{campaign.scheduled_at ? formatDateTime(campaign.scheduled_at) : "без расписания"}</div>
              </div>
            );
          },
        }),
        column.display({
          id: "result",
          header: "Результат",
          meta: { align: "right" },
          cell: (info) => {
            const campaign = info.row.original;
            return (
              <div className="campaign-result-cell">
                <div className="mono row-main">{campaign.sent_count}</div>
                <div className="campaign-progress">
                  <span data-level={openLevel(campaign)} />
                </div>
                <div className="row-sub">{campaign.opened_count > 0 ? `открыли ${campaign.opened_count}` : "открытий нет"}</div>
              </div>
            );
          },
        }),
        column.accessor("status", {
          header: "Статус",
          cell: (info) => statusBadge(info.row.original),
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
                  label="Править"
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
                  label="Дублировать"
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
    [cities.data, copy, promos.data, restaurants.data, send],
  );

  return (
    <div className="page-stack campaigns-layout page-layout-with-drawer" data-drawer-open={creating || Boolean(selected)}>
      <div className="metric-strip">
        <Metric icon={<BellRing size={17} aria-hidden />} label="Всего" note="созданных рассылок" value={String(stats.total)} />
        <Metric icon={<CalendarClock size={17} aria-hidden />} label="В плане" note="ждут отправки" tone="warn" value={String(stats.scheduled)} />
        <Metric icon={<Send size={17} aria-hidden />} label="Отправлены" note="кампаний с доставкой" tone="ok" value={String(stats.sent)} />
        <Metric icon={<Eye size={17} aria-hidden />} label="Открытия" note={`аудитория в плане ${stats.planned}`} value={String(stats.opened)} />
      </div>

      <div className="surface-toolbar">
        <label className="field toolbar-field">
          <span className="field-label">Поиск</span>
          <span className="search-control">
            <Search className="search-icon" size={15} aria-hidden />
            <input
              className="input"
              placeholder="Название, текст или аудитория"
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
            Запланированы
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
