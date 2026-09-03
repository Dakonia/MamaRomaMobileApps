import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellOff,
  BellRing,
  CheckCircle2,
  Clock3,
  Edit3,
  PackageCheck,
  Save,
  ShieldAlert,
  Truck,
  Utensils,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { api, ApiError, type NotificationRule, type QuietHours } from "./api";
import { Badge, Button } from "./ui";

type StepTone = "ok" | "warn" | "muted" | "bad" | "accent";

type StepMeta = {
  icon: LucideIcon;
  label: string;
  phase: string;
  role: string;
  tone: StepTone;
};

const STEP_META: Record<string, StepMeta> = {
  accepted: {
    icon: PackageCheck,
    label: "Заказ принят",
    phase: "Старт кухни",
    role: "Гость понимает, что ресторан взял заказ в работу",
    tone: "accent",
  },
  cooking: {
    icon: Utensils,
    label: "Готовится",
    phase: "Кухня",
    role: "На доставке тихий шаг, на самовывозе — сигнал выезжать",
    tone: "warn",
  },
  ready: {
    icon: BellRing,
    label: "Заказ готов",
    phase: "Ждёт действия",
    role: "Нужно забрать, выдать или передать курьеру",
    tone: "accent",
  },
  delivering: {
    icon: Truck,
    label: "Курьер в пути",
    phase: "Доставка",
    role: "Гость ждёт заказ и видит движение",
    tone: "warn",
  },
  completed: {
    icon: CheckCircle2,
    label: "Доставлен",
    phase: "Финал",
    role: "Заказ закрыт, можно просить оценку",
    tone: "ok",
  },
  cancelled: {
    icon: XCircle,
    label: "Отменён",
    phase: "Исключение",
    role: "Гость должен сразу понять, что заказ не будет выполнен",
    tone: "bad",
  },
  items_changed: {
    icon: Edit3,
    label: "Состав изменён",
    phase: "Правка кассы",
    role: "Ресторан поменял позиции или количество",
    tone: "bad",
  },
};

const FALLBACK_META: StepMeta = {
  icon: Bell,
  label: "Событие заказа",
  phase: "Системный шаг",
  role: "Сообщение по событию заказа",
  tone: "muted",
};

const TOKEN_PREVIEW = {
  number: "1024",
  restaurant: "Невский, 63",
  time: "19:40",
};

const TOKENS = [
  { label: "Номер", token: "{number}", value: TOKEN_PREVIEW.number },
  { label: "Ресторан", token: "{restaurant}", value: TOKEN_PREVIEW.restaurant },
  { label: "Время", token: "{time}", value: TOKEN_PREVIEW.time },
];

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function metaFor(event: string) {
  return STEP_META[event] ?? { ...FALLBACK_META, label: event };
}

function previewText(rule: NotificationRule) {
  const replace = (text: string) =>
    text
      .replaceAll("{number}", TOKEN_PREVIEW.number)
      .replaceAll("{restaurant}", TOKEN_PREVIEW.restaurant)
      .replaceAll("{time}", TOKEN_PREVIEW.time);

  return {
    body: replace(rule.body || "Текст уведомления"),
    title: replace(rule.title || "Заголовок"),
  };
}

function timeShort(value: string) {
  return value.slice(0, 5);
}

function PushPreview({ body, enabled, title }: { body: string; enabled: boolean; title: string }) {
  return (
    <div className="order-status-preview" data-enabled={enabled}>
      <div className="order-status-preview-top">
        <span>
          {enabled ? <BellRing size={14} aria-hidden /> : <BellOff size={14} aria-hidden />}
          Push гостю
        </span>
        <small>{enabled ? "отправляется" : "не отправляется"}</small>
      </div>
      <div className="order-status-push">
        <div className="push-icon">
          <Bell size={16} aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="row-main">{title}</div>
          <div className="row-sub">{body}</div>
        </div>
      </div>
    </div>
  );
}

function StatusSwitch({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className="order-status-switch" aria-label="Отправка push">
      <button data-active={enabled} type="button" onClick={() => onChange(true)}>
        <BellRing size={14} aria-hidden />
        Отправлять
      </button>
      <button data-active={!enabled} type="button" onClick={() => onChange(false)}>
        <BellOff size={14} aria-hidden />
        Не слать
      </button>
    </div>
  );
}

function StepCard({ index, rule }: { index: number; rule: NotificationRule }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(rule);
  const meta = metaFor(draft.event);
  const Icon = meta.icon;

  useEffect(() => {
    setDraft(rule);
  }, [rule]);

  const save = useMutation({
    mutationFn: api.saveNotificationRule,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notification-rules"] });
      toast.success("Статус заказа сохранён");
    },
  });

  const dirty =
    draft.body !== rule.body ||
    draft.is_enabled !== rule.is_enabled ||
    draft.title !== rule.title;
  const preview = previewText(draft);

  return (
    <section className="order-status-card" data-enabled={draft.is_enabled} data-tone={meta.tone}>
      <div className="order-status-stage">
        <span className="order-status-icon">
          <Icon size={18} aria-hidden />
        </span>
        <span className="order-status-index">{String(index + 1).padStart(2, "0")}</span>
      </div>

      <div className="order-status-main">
        <div className="order-status-head">
          <div className="min-w-0">
            <span className="metric-label">{meta.phase}</span>
            <h3>{meta.label}</h3>
            <p>{meta.role}</p>
          </div>
          <Badge text={draft.is_enabled ? "push включён" : "тихий шаг"} tone={draft.is_enabled ? meta.tone : "muted"} />
        </div>

        <StatusSwitch enabled={draft.is_enabled} onChange={(is_enabled) => setDraft({ ...draft, is_enabled })} />

        <div className="order-status-compose">
          <label className="field">
            <span className="field-label">Заголовок</span>
            <input
              className="input"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>

          <label className="field">
            <span className="field-label">Текст уведомления</span>
            <textarea
              className="textarea order-status-message"
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
          </label>
        </div>

        <div className="order-status-foot">
          <div className="order-status-tokens">
            {TOKENS.map((token) => (
              <span key={token.token}>
                <small>{token.label}</small>
                <strong>{token.token}</strong>
                <em>{token.value}</em>
              </span>
            ))}
          </div>
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
            <Save size={15} aria-hidden />
            {save.isPending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </div>
      </div>

      <PushPreview body={preview.body} enabled={draft.is_enabled} title={preview.title} />
    </section>
  );
}

function NotificationFlow({ rules }: { rules: NotificationRule[] }) {
  return (
    <div className="order-status-flow" aria-label="Цепочка статусов заказа">
      {rules.map((rule, index) => {
        const meta = metaFor(rule.event);
        const Icon = meta.icon;
        return (
          <div key={rule.event} className="order-status-flow-step" data-enabled={rule.is_enabled} data-tone={meta.tone}>
            <span className="order-status-flow-dot">
              <Icon size={14} aria-hidden />
            </span>
            <span className="order-status-flow-copy">
              <strong>{meta.label}</strong>
              <small>
                {String(index + 1).padStart(2, "0")} · {rule.is_enabled ? "push" : "тихо"}
              </small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function NotificationOverview({
  hours,
  rules,
}: {
  hours: QuietHours | undefined;
  rules: NotificationRule[];
}) {
  const enabled = rules.filter((rule) => rule.is_enabled).length;
  const muted = rules.length - enabled;

  return (
    <section className="order-status-hero">
      <div className="order-status-hero-copy">
        <span className="metric-label">Статусы заказа</span>
        <h2>Транзакционные сообщения</h2>
        <p>Важные этапы заказа, тексты push и шаги, где лучше не шуметь.</p>
      </div>
      <div className="order-status-summary">
        <span>
          <small>Отправляются</small>
          <strong>{enabled}</strong>
        </span>
        <span>
          <small>Тихие</small>
          <strong>{muted}</strong>
        </span>
        <span>
          <small>Тихие часы акций</small>
          <strong>{hours ? `${timeShort(hours.quiet_from)}-${timeShort(hours.quiet_to)}` : "—"}</strong>
        </span>
      </div>
    </section>
  );
}

function QuietHoursCard({ hours }: { hours: QuietHours }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(hours);

  useEffect(() => {
    setDraft(hours);
  }, [hours]);

  const save = useMutation({
    mutationFn: api.saveNotificationHours,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notification-hours"] });
      toast.success("Тихие часы сохранены");
    },
  });

  const dirty =
    draft.quiet_from !== hours.quiet_from ||
    draft.quiet_to !== hours.quiet_to ||
    draft.weekly_limit !== hours.weekly_limit;

  return (
    <section className="notification-hours-panel">
      <div className="notification-hours-head">
        <span className="order-status-icon">
          <Clock3 size={18} aria-hidden />
        </span>
        <div className="min-w-0">
          <span className="metric-label">Маркетинговые рассылки</span>
          <h3>Тихие часы и частота</h3>
          <p>Заказные push остаются срочными, рекламные кампании ждут спокойного времени.</p>
        </div>
      </div>

      <div className="notification-hours-grid">
        <label className="field">
          <span className="field-label">С</span>
          <input
            className="input"
            type="time"
            value={timeShort(draft.quiet_from)}
            onChange={(event) => setDraft({ ...draft, quiet_from: `${event.target.value}:00` })}
          />
        </label>
        <label className="field">
          <span className="field-label">До</span>
          <input
            className="input"
            type="time"
            value={timeShort(draft.quiet_to)}
            onChange={(event) => setDraft({ ...draft, quiet_to: `${event.target.value}:00` })}
          />
        </label>
        <label className="field">
          <span className="field-label">Рассылок в неделю</span>
          <input
            className="input"
            inputMode="numeric"
            value={draft.weekly_limit}
            onChange={(event) =>
              setDraft({ ...draft, weekly_limit: Number(event.target.value.replace(/\D/g, "")) })
            }
          />
        </label>
        <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
          <Save size={15} aria-hidden />
          {save.isPending ? "Сохраняем..." : "Сохранить"}
        </Button>
      </div>
    </section>
  );
}

export function NotificationSteps() {
  const rules = useQuery({ queryKey: ["notification-rules"], queryFn: api.notificationRules });
  const hours = useQuery({ queryKey: ["notification-hours"], queryFn: api.notificationHours });

  const { exceptionRules, statusRules } = useMemo(() => {
    const list = rules.data ?? [];
    return {
      exceptionRules: list.filter((rule) => rule.event === "items_changed"),
      statusRules: list.filter((rule) => rule.event !== "items_changed"),
    };
  }, [rules.data]);

  if (rules.error) {
    return (
      <div className="error-state">
        <h2>Не удалось загрузить правила</h2>
        <p>{errorMessage(rules.error)}</p>
      </div>
    );
  }

  if (rules.isPending) {
    return (
      <div className="page-stack">
        <div className="skeleton skeleton-card" />
        <div className="notification-status-list">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="skeleton skeleton-card" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <NotificationOverview hours={hours.data} rules={rules.data ?? []} />
      <NotificationFlow rules={statusRules} />

      <div className="notification-status-list">
        {statusRules.map((rule, index) => (
          <StepCard key={`${rule.restaurant_id ?? "all"}-${rule.event}`} index={index} rule={rule} />
        ))}
      </div>

      {exceptionRules.length > 0 ? (
        <section className="notification-exception-section">
          <div className="notification-exception-head">
            <ShieldAlert size={18} aria-hidden />
            <div>
              <span className="metric-label">Исключения</span>
              <h3>Правки заказа</h3>
            </div>
          </div>
          <div className="notification-status-list">
            {exceptionRules.map((rule, index) => (
              <StepCard
                key={`${rule.restaurant_id ?? "all"}-${rule.event}`}
                index={statusRules.length + index}
                rule={rule}
              />
            ))}
          </div>
        </section>
      ) : null}

      {hours.data ? <QuietHoursCard hours={hours.data} /> : null}
    </div>
  );
}
