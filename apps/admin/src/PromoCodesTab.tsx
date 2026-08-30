import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  Copy,
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  Percent,
  Plus,
  Power,
  Search,
  ShieldCheck,
  Trash2,
  Truck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { api, ApiError, formatDate, formatPrice, type PromoCode, type PromoCodeDraft } from "./api";
import { ConfirmDialog } from "./components/patterns/ConfirmDialog";
import { DataTable, DensityToggle, createAdminColumnHelper, useTableDensity } from "./components/patterns/DataTable";
import { Badge, Button, IconButton, Section } from "./ui";

type PromoFilter = "all" | "active" | "scheduled" | "limited" | "inactive" | "expired";

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const KINDS: {
  description: string;
  icon: ReactNode;
  label: string;
  value: PromoCode["kind"];
}[] = [
  {
    description: "От суммы блюд",
    icon: <Percent size={16} aria-hidden />,
    label: "Процент",
    value: "percent",
  },
  {
    description: "Сумма в рублях",
    icon: <KeyRound size={16} aria-hidden />,
    label: "Сумма",
    value: "fixed",
  },
  {
    description: "Стоимость доставки",
    icon: <Truck size={16} aria-hidden />,
    label: "Доставка",
    value: "free_delivery",
  },
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

function normalizeCode(value: string): string {
  return value.trim().toLocaleUpperCase("ru-RU").replace(/\s/g, "").slice(0, 32);
}

function normalizeDateInput(value: string): string | null {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (!digits) return null;
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function normalizeDraft(draft: PromoCodeDraft): PromoCodeDraft {
  return {
    ...draft,
    code: normalizeCode(draft.code),
    ends_at: draft.ends_at ? `${draft.ends_at}T23:59:00Z` : null,
    max_discount_kopecks: draft.kind === "percent" ? draft.max_discount_kopecks : null,
    starts_at: draft.starts_at ? `${draft.starts_at}T00:00:00Z` : null,
    title: draft.title.trim(),
    value: draft.kind === "free_delivery" ? 0 : draft.value,
  };
}

function describe(promo: PromoCode | PromoCodeDraft): string {
  if (promo.kind === "free_delivery") return "Бесплатная доставка";
  if (promo.kind === "percent") return `-${promo.value}%`;
  return `-${formatPrice(promo.value)}`;
}

function defaultTitle(kind: PromoCode["kind"]): string {
  if (kind === "free_delivery") return "Бесплатная доставка";
  if (kind === "fixed") return "Скидка на заказ";
  return "Скидка по промокоду";
}

function kindLabel(kind: PromoCode["kind"]): string {
  if (kind === "free_delivery") return "Бесплатная доставка";
  if (kind === "fixed") return "Фиксированная скидка";
  return "Процентная скидка";
}

function kindTone(kind: PromoCode["kind"]): "accent" | "ok" | "warn" {
  if (kind === "free_delivery") return "ok";
  if (kind === "fixed") return "warn";
  return "accent";
}

function appliesToLabel(kind: PromoCode["kind"]): string {
  if (kind === "free_delivery") return "Доставка";
  return "Сумма блюд";
}

function appliesToDetail(promo: Pick<PromoCode | PromoCodeDraft, "kind" | "max_discount_kopecks">): string {
  if (promo.kind === "free_delivery") return "Списывает только стоимость доставки";
  if (promo.kind === "fixed") return "Вычитается из суммы блюд";
  if (promo.max_discount_kopecks) return `От блюд, максимум ${formatPrice(promo.max_discount_kopecks)}`;
  return "Процент от суммы блюд";
}

function periodLabel(promo: Pick<PromoCode | PromoCodeDraft, "starts_at" | "ends_at">): string {
  const start = promo.starts_at && (promo.starts_at.includes("T") || DATE_RE.test(promo.starts_at)) ? formatDate(promo.starts_at) : null;
  const end = promo.ends_at && (promo.ends_at.includes("T") || DATE_RE.test(promo.ends_at)) ? formatDate(promo.ends_at) : null;
  if (start && end) return `${start} - ${end}`;
  if (start) return `с ${start}`;
  if (end) return `до ${end}`;
  if (promo.starts_at || promo.ends_at) return "дата не заполнена";
  return "без срока";
}

function minOrderLabel(promo: Pick<PromoCode | PromoCodeDraft, "min_order_kopecks">): string {
  return promo.min_order_kopecks > 0 ? `от ${formatPrice(promo.min_order_kopecks)}` : "без порога";
}

function triggerLabel(promo: Pick<PromoCode | PromoCodeDraft, "min_order_kopecks" | "starts_at" | "ends_at">): string {
  return `${minOrderLabel(promo)}, ${periodLabel(promo)}`;
}

function maxDiscountLabel(promo: Pick<PromoCode | PromoCodeDraft, "kind" | "max_discount_kopecks">): string {
  if (promo.kind === "free_delivery" || promo.kind === "fixed") return "не нужен";
  return promo.max_discount_kopecks ? `до ${formatPrice(promo.max_discount_kopecks)}` : "без ограничения";
}

function perGuestLabel(promo: Pick<PromoCode | PromoCodeDraft, "per_guest_limit">): string {
  if (promo.per_guest_limit === 0) return "без лимита на гостя";
  if (promo.per_guest_limit === 1) return "1 раз на гостя";
  return `${promo.per_guest_limit} на гостя`;
}

function dateBoundaryTime(value: string, edge: "start" | "end"): number {
  if (value.length !== 10) return value.includes("T") ? new Date(value).getTime() : Number.NaN;
  return new Date(`${value}T${edge === "start" ? "00:00:00" : "23:59:59"}`).getTime();
}

function isExpired(promo: Pick<PromoCode | PromoCodeDraft, "ends_at">): boolean {
  const time = promo.ends_at ? dateBoundaryTime(promo.ends_at, "end") : Number.NaN;
  return Number.isFinite(time) && time < Date.now();
}

function isScheduled(promo: Pick<PromoCode | PromoCodeDraft, "starts_at">): boolean {
  const time = promo.starts_at ? dateBoundaryTime(promo.starts_at, "start") : Number.NaN;
  return Number.isFinite(time) && time > Date.now();
}

function isLimitReached(promo: PromoCode): boolean {
  return promo.usage_limit !== null && promo.used_count >= promo.usage_limit;
}

function isUsable(promo: PromoCode): boolean {
  return promo.is_active && !isExpired(promo) && !isScheduled(promo) && !isLimitReached(promo);
}

function statusBadge(promo: PromoCode) {
  if (!promo.is_active) return <Badge text="выключен" tone="muted" />;
  if (isExpired(promo)) return <Badge text="истёк" tone="bad" />;
  if (isScheduled(promo)) return <Badge text="запланирован" tone="accent" />;
  if (isLimitReached(promo)) return <Badge text="лимит исчерпан" tone="warn" />;
  return <Badge text="активен" tone="ok" />;
}

function draftStatusBadge(draft: PromoCodeDraft, usedCount: number) {
  if (!draft.is_active) return <Badge text="выключен" tone="muted" />;
  if (isExpired(draft)) return <Badge text="истёк" tone="bad" />;
  if (isScheduled(draft)) return <Badge text="запланирован" tone="accent" />;
  if (draft.usage_limit !== null && usedCount >= draft.usage_limit) return <Badge text="лимит исчерпан" tone="warn" />;
  return <Badge text="активен" tone="ok" />;
}

function usageLabel(promo: PromoCode | PromoCodeDraft, usedCount = 0): string {
  if (promo.usage_limit === null) return "без лимита";
  return `${usedCount} / ${promo.usage_limit}`;
}

function usageLevel(promo: PromoCode | PromoCodeDraft, usedCount = 0): "empty" | "low" | "mid" | "high" | "full" {
  if (promo.usage_limit === null || usedCount === 0) return "empty";
  const percent = usedCount / promo.usage_limit;
  if (percent >= 1) return "full";
  if (percent >= 0.75) return "high";
  if (percent >= 0.4) return "mid";
  return "low";
}

function sortRank(promo: PromoCode): number {
  if (isExpired(promo)) return 5;
  if (!promo.is_active) return 4;
  if (isLimitReached(promo)) return 3;
  if (isScheduled(promo)) return 2;
  return 1;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function rubToKopecks(value: string): number {
  return Number(value.replace(/\D/g, "") || 0) * 100;
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

  const usedCount = promo?.used_count ?? 0;
  const code = normalizeCode(draft.code);
  const title = draft.title.trim() || defaultTitle(draft.kind);
  const startDateInvalid = Boolean(draft.starts_at && !DATE_RE.test(draft.starts_at));
  const endDateInvalid = Boolean(draft.ends_at && !DATE_RE.test(draft.ends_at));
  const periodInvalid = Boolean(!startDateInvalid && !endDateInvalid && draft.starts_at && draft.ends_at && draft.starts_at > draft.ends_at);
  const percentInvalid = draft.kind === "percent" && draft.value > 100;
  const valueInvalid = draft.kind !== "free_delivery" && draft.value <= 0;
  const canSave = code.length >= 3 && !startDateInvalid && !endDateInvalid && !periodInvalid && !percentInvalid && !valueInvalid;

  const chooseKind = (kind: PromoCode["kind"]) => {
    setDraft((current) => ({
      ...current,
      kind,
      max_discount_kopecks: kind === "percent" ? current.max_discount_kopecks : null,
      value: kind === "free_delivery" ? 0 : kind === "percent" ? 10 : 50000,
    }));
  };

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Промокод скопирован");
    } catch {
      toast.error("Не удалось скопировать код");
    }
  };

  return (
    <>
      <div className="drawer-overlay promo-code-editor-overlay" onClick={onClose} />
      <aside className="promo-code-drawer-shell" aria-label="Редактор промокода">
        <header className="promo-code-drawer-head">
          <div className="promo-code-title-block">
            <span className="metric-label">Промокоды</span>
            <h2>{promo ? promo.code : "Новый промокод"}</h2>
            <div className="promo-code-subline">
              {draftStatusBadge(draft, usedCount)}
              <span>{kindLabel(draft.kind)}</span>
              <span>{periodLabel(draft)}</span>
            </div>
          </div>
          <IconButton label="Закрыть редактор" size="sm" variant="quiet" onClick={onClose}>
            <X size={17} aria-hidden />
          </IconButton>
        </header>

        <div className="promo-code-drawer-body">
          <aside className="promo-code-preview-panel">
            <div className="promo-code-card" data-active={draft.is_active} data-kind={draft.kind}>
              <div className="promo-code-card-head">
                <div>
                  <div className="metric-label">Код для корзины</div>
                  <div className="promo-code-token">{code || "ROMA10"}</div>
                </div>
                <IconButton disabled={!code} label="Скопировать код" size="sm" variant="quiet" onClick={copyCode}>
                  <Copy size={16} aria-hidden />
                </IconButton>
              </div>
              <div className="promo-code-card-main">
                <h3>{title}</h3>
                <div className="promo-code-discount-value">{describe(draft)}</div>
              </div>
            </div>

            <div className="promo-code-rule-list">
              <div className="promo-code-rule-row">
                <Users size={15} aria-hidden />
                <span>
                  <small>Для кого</small>
                  <strong>Все гости приложения</strong>
                  <em>{perGuestLabel(draft)}</em>
                </span>
              </div>
              <div className="promo-code-rule-row">
                {draft.kind === "free_delivery" ? <Truck size={15} aria-hidden /> : <Percent size={15} aria-hidden />}
                <span>
                  <small>На что действует</small>
                  <strong>{appliesToLabel(draft.kind)}</strong>
                  <em>{appliesToDetail(draft)}</em>
                </span>
              </div>
              <div className="promo-code-rule-row">
                <ShieldCheck size={15} aria-hidden />
                <span>
                  <small>Порог заказа</small>
                  <strong>{minOrderLabel(draft)}</strong>
                </span>
              </div>
              <div className="promo-code-rule-row">
                <Percent size={15} aria-hidden />
                <span>
                  <small>Максимальная скидка</small>
                  <strong>{maxDiscountLabel(draft)}</strong>
                </span>
              </div>
              <div className="promo-code-rule-row">
                <Users size={15} aria-hidden />
                <span>
                  <small>Один гость</small>
                  <strong>{perGuestLabel(draft)}</strong>
                </span>
              </div>
              <div className="promo-code-rule-row">
                <CalendarDays size={15} aria-hidden />
                <span>
                  <small>Период</small>
                  <strong>{periodLabel(draft)}</strong>
                </span>
              </div>
            </div>

            <div className="promo-code-usage-card">
              <div className="promo-code-usage-head">
                <span>
                  <small>Использований</small>
                  <strong>{usageLabel(draft, usedCount)}</strong>
                </span>
                {draft.usage_limit === null ? <Badge text="без лимита" tone="muted" /> : null}
              </div>
              <div className="promo-code-progress">
                <span data-level={usageLevel(draft, usedCount)} />
              </div>
              <div className="row-sub">{perGuestLabel(draft)}</div>
            </div>
          </aside>

          <main className="promo-code-form-panel">
            <section className="promo-code-form-section">
              <div className="promo-code-section-head">
                <h3>Основное</h3>
              </div>
              <div className="promo-code-form-grid">
                <label className="field">
                  <span className="field-label">Код</span>
                  <input
                    className="input mono"
                    maxLength={32}
                    placeholder="ROMA10"
                    value={draft.code}
                    onChange={(event) => set("code", normalizeCode(event.target.value))}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Название</span>
                  <input
                    className="input"
                    maxLength={120}
                    placeholder="Скидка 10%"
                    value={draft.title}
                    onChange={(event) => set("title", event.target.value)}
                  />
                </label>
                <label className="promo-code-toggle-card promo-code-field-wide" data-active={draft.is_active}>
                  <input
                    checked={draft.is_active}
                    type="checkbox"
                    onChange={(event) => set("is_active", event.target.checked)}
                  />
                  <span className="promo-code-toggle-icon">
                    {draft.is_active ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
                  </span>
                  <span>
                    <small>Публикация</small>
                    <strong>{draft.is_active ? "Код можно применить" : "Код выключен"}</strong>
                  </span>
                </label>
              </div>
            </section>

            <section className="promo-code-form-section">
              <div className="promo-code-section-head">
                <h3>Тип скидки</h3>
              </div>
              <div className="promo-code-kind-grid">
                {KINDS.map((item) => (
                  <button
                    key={item.value}
                    className="promo-code-kind-card"
                    data-active={draft.kind === item.value}
                    type="button"
                    onClick={() => chooseKind(item.value)}
                  >
                    <span className="promo-code-kind-icon">{item.icon}</span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                    {draft.kind === item.value ? <Check size={15} aria-hidden /> : null}
                  </button>
                ))}
              </div>

              {draft.kind !== "free_delivery" ? (
                <div className="promo-code-form-grid">
                  <label className="field">
                    <span className="field-label">{draft.kind === "percent" ? "Процент" : "Скидка, ₽"}</span>
                    <input
                      className="input"
                      inputMode="numeric"
                      value={draft.kind === "percent" ? draft.value : Math.round(draft.value / 100)}
                      onChange={(event) =>
                        set(
                          "value",
                          draft.kind === "percent"
                            ? Number(event.target.value.replace(/\D/g, "") || 0)
                            : rubToKopecks(event.target.value),
                        )
                      }
                    />
                  </label>
                  {draft.kind === "percent" ? (
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
                  ) : null}
                  {percentInvalid ? (
                    <div className="form-warning promo-code-field-wide">Процент не должен быть больше 100.</div>
                  ) : null}
                  {valueInvalid ? (
                    <div className="form-warning promo-code-field-wide">Укажите значение скидки.</div>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="promo-code-form-section">
              <div className="promo-code-section-head">
                <h3>Распространение</h3>
              </div>
              <div className="promo-code-apply-grid">
                <div className="promo-code-apply-card">
                  <Users size={16} aria-hidden />
                  <span>
                    <small>Кому</small>
                    <strong>Все гости</strong>
                    <em>{perGuestLabel(draft)}</em>
                  </span>
                </div>
                <div className="promo-code-apply-card">
                  {draft.kind === "free_delivery" ? <Truck size={16} aria-hidden /> : <Percent size={16} aria-hidden />}
                  <span>
                    <small>На что</small>
                    <strong>{appliesToLabel(draft.kind)}</strong>
                    <em>{appliesToDetail(draft)}</em>
                  </span>
                </div>
                <div className="promo-code-apply-card">
                  <ShieldCheck size={16} aria-hidden />
                  <span>
                    <small>Когда сработает</small>
                    <strong>{triggerLabel(draft)}</strong>
                    <em>Промокод считается до списания баллов</em>
                  </span>
                </div>
              </div>
            </section>

            <section className="promo-code-form-section">
              <div className="promo-code-section-head">
                <h3>Условия и лимиты</h3>
              </div>
              <div className="promo-code-form-grid">
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
                  <span className="field-label">Всего применений</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder="без ограничения"
                    value={draft.usage_limit ?? ""}
                    onChange={(event) => {
                      const value = event.target.value.replace(/\D/g, "");
                      set("usage_limit", value === "" ? null : Number(value));
                    }}
                  />
                </label>
                <label className="field">
                  <span className="field-label">На одного гостя</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={draft.per_guest_limit}
                    onChange={(event) => set("per_guest_limit", Number(event.target.value.replace(/\D/g, "") || 0))}
                  />
                </label>
                <div className="promo-code-limit-actions">
                  <Button size="xs" variant="ghost" onClick={() => set("usage_limit", null)}>
                    Без общего лимита
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => set("per_guest_limit", 0)}>
                    Без лимита на гостя
                  </Button>
                </div>
              </div>
            </section>

            <section className="promo-code-form-section">
              <div className="promo-code-section-head">
                <h3>Срок действия</h3>
              </div>
              <div className="promo-code-form-grid">
                <label className="field">
                  <span className="field-label">Старт</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder="2026-09-01"
                    type="text"
                    value={draft.starts_at ?? ""}
                    onChange={(event) => set("starts_at", normalizeDateInput(event.target.value))}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Конец</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder="2026-09-30"
                    type="text"
                    value={draft.ends_at ?? ""}
                    onChange={(event) => set("ends_at", normalizeDateInput(event.target.value))}
                  />
                </label>
                <div className="promo-code-limit-actions promo-code-field-wide">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      set("starts_at", null);
                      set("ends_at", null);
                    }}
                  >
                    Без срока
                  </Button>
                </div>
                {periodInvalid ? (
                  <div className="form-warning promo-code-field-wide">Дата старта не может быть позже даты окончания.</div>
                ) : null}
                {startDateInvalid || endDateInvalid ? (
                  <div className="form-warning promo-code-field-wide">Заполните дату в формате 2026-09-01.</div>
                ) : null}
              </div>
            </section>
          </main>
        </div>

        <footer className="promo-code-drawer-foot">
          <Button disabled={pending} variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={pending || !canSave} onClick={() => onSubmit(normalizeDraft(draft))}>
            {pending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </footer>
      </aside>
    </>
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
    return [...(codes.data ?? [])]
      .filter((promo) => {
        const text = [
          promo.code,
          promo.title,
          describe(promo),
          kindLabel(promo.kind),
          periodLabel(promo),
          minOrderLabel(promo),
          appliesToLabel(promo.kind),
          appliesToDetail(promo),
          usageLabel(promo, promo.used_count),
          perGuestLabel(promo),
        ]
          .join(" ")
          .toLocaleLowerCase("ru-RU");
        const matchesFilter =
          filter === "all" ||
          (filter === "active" && isUsable(promo)) ||
          (filter === "scheduled" && promo.is_active && isScheduled(promo)) ||
          (filter === "limited" && isLimitReached(promo)) ||
          (filter === "inactive" && !promo.is_active) ||
          (filter === "expired" && isExpired(promo));

        return text.includes(needle) && matchesFilter;
      })
      .sort((a, b) => sortRank(a) - sortRank(b) || a.code.localeCompare(b.code, "ru"));
  }, [codes.data, filter, search]);

  const selected = selectedId ? (codes.data ?? []).find((promo) => promo.id === selectedId) ?? null : null;

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("code", {
          header: "Код",
          cell: (info) => {
            const promo = info.row.original;
            return (
              <div className="promo-code-table-code">
                <span className="promo-code-table-icon">
                  <KeyRound size={15} aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="row-main mono">{info.getValue()}</div>
                  <div className="row-sub promo-code-row-title">{promo.title || defaultTitle(promo.kind)}</div>
                </div>
              </div>
            );
          },
        }),
        column.display({
          id: "discount",
          header: "Скидка и применение",
          cell: (info) => {
            const promo = info.row.original;
            return (
              <div className="promo-code-discount-cell">
                <div className="row-main">{describe(promo)}</div>
                <div className="chips-line">
                  <Badge text={kindLabel(promo.kind)} tone={kindTone(promo.kind)} />
                  <span className="mini-chip">Все гости</span>
                  <span className="mini-chip">{appliesToLabel(promo.kind)}</span>
                  <span className="mini-chip">{minOrderLabel(promo)}</span>
                  {promo.kind === "percent" && promo.max_discount_kopecks ? (
                    <span className="mini-chip">{maxDiscountLabel(promo)}</span>
                  ) : null}
                </div>
              </div>
            );
          },
        }),
        column.display({
          id: "period",
          header: "Период",
          cell: (info) => {
            const promo = info.row.original;
            return (
              <div>
                <div className="row-main">{periodLabel(promo)}</div>
                <div className="row-sub">
                  {isScheduled(promo)
                    ? "ещё не начался"
                    : isExpired(promo)
                      ? "срок закончился"
                      : promo.starts_at || promo.ends_at
                        ? "действует по датам"
                        : "без ограничения по датам"}
                </div>
              </div>
            );
          },
        }),
        column.accessor("used_count", {
          header: "Лимит",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => {
            const promo = info.row.original;
            return (
              <div className="promo-code-usage-cell">
                <div className="mono">{usageLabel(promo, info.getValue())}</div>
                <div className="promo-code-progress">
                  <span data-level={usageLevel(promo, info.getValue())} />
                </div>
                <div className="row-sub">{perGuestLabel(promo)}</div>
              </div>
            );
          },
        }),
        column.display({
          id: "status",
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
                <IconButton
                  label={promo.is_active ? "Выключить" : "Включить"}
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(promo);
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
      active: list.filter(isUsable).length,
      expired: list.filter(isExpired).length,
      limited: list.filter(isLimitReached).length,
      scheduled: list.filter((promo) => promo.is_active && isScheduled(promo)).length,
      total: list.length,
      used: list.reduce((sum, promo) => sum + promo.used_count, 0),
    };
  }, [codes.data]);

  return (
    <div className="page-layout-with-drawer promo-codes-layout" data-drawer-open={creating || Boolean(selected)}>
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
            <Metric icon={<KeyRound size={18} aria-hidden />} label="Промокоды" note="в базе" value={String(stats.total)} />
            <Metric
              icon={<Eye size={18} aria-hidden />}
              label="Активные"
              note={`${stats.scheduled} запланировано`}
              tone="ok"
              value={String(stats.active)}
            />
            <Metric
              icon={<ShieldCheck size={18} aria-hidden />}
              label="Лимиты"
              note={`${stats.expired} истекло`}
              tone={stats.limited > 0 ? "warn" : "accent"}
              value={String(stats.limited)}
            />
            <Metric icon={<Users size={18} aria-hidden />} label="Применения" note="за всё время" value={String(stats.used)} />
          </div>

          <div className="surface-toolbar">
            <label className="field toolbar-field">
              <span className="field-label">Поиск</span>
              <span className="search-control">
                <Search className="search-icon" size={15} aria-hidden />
                <input
                  className="input"
                  placeholder="Код, название, условие"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </span>
            </label>

            <div className="filter-chips" aria-label="Фильтр промокодов">
              {[
                ["all", "Все"],
                ["active", "Активные"],
                ["scheduled", "Запланированные"],
                ["limited", "Лимит исчерпан"],
                ["expired", "Истекшие"],
                ["inactive", "Выключены"],
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
          promo={creating ? null : selected}
          onClose={() => {
            setCreating(false);
            setSelectedId(null);
          }}
          onSubmit={(draft) => save.mutate({ draft, id: creating ? null : selected?.id ?? null })}
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
