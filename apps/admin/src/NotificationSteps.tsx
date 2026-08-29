import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Clock3, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api, ApiError, type NotificationRule, type QuietHours } from "./api";
import { Badge, Button } from "./ui";

const STEPS: Record<string, string> = {
  accepted: "Ресторан принял заказ",
  cooking: "Заказ готовится",
  ready: "Заказ готов",
  delivering: "Курьер выехал",
  completed: "Заказ доставлен",
  cancelled: "Заказ отменён",
  items_changed: "Ресторан изменил состав заказа",
};

const HINT = "Доступные подстановки: {number}, {restaurant}, {time}";

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function previewText(rule: NotificationRule) {
  const values = {
    number: "1024",
    restaurant: "Невский, 63",
    time: "19:40",
  };

  const replace = (text: string) =>
    text
      .replaceAll("{number}", values.number)
      .replaceAll("{restaurant}", values.restaurant)
      .replaceAll("{time}", values.time);

  return {
    body: replace(rule.body || "Текст уведомления"),
    title: replace(rule.title || "Заголовок"),
  };
}

function PushPreview({ body, title }: { body: string; title: string }) {
  return (
    <div className="push-preview">
      <div className="push-icon">
        <Bell size={16} aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="row-main">{title}</div>
        <div className="row-sub">{body}</div>
      </div>
    </div>
  );
}

function StepCard({ rule }: { rule: NotificationRule }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(rule);

  useEffect(() => {
    setDraft(rule);
  }, [rule]);

  const save = useMutation({
    mutationFn: api.saveNotificationRule,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notification-rules"] });
      toast.success("Шаг сохранён");
    },
  });

  const dirty =
    draft.body !== rule.body ||
    draft.is_enabled !== rule.is_enabled ||
    draft.title !== rule.title;
  const preview = previewText(draft);

  return (
    <section className="notification-card" data-enabled={draft.is_enabled}>
      <div className="notification-card-head">
        <label className="inline-check">
          <input
            checked={draft.is_enabled}
            type="checkbox"
            onChange={(event) => setDraft({ ...draft, is_enabled: event.target.checked })}
          />
          <span className="row-main">{STEPS[draft.event] ?? draft.event}</span>
        </label>
        <span className="toolbar-spacer" />
        {draft.is_enabled ? <Badge text="уходит" tone="ok" /> : <Badge text="молчим" tone="muted" />}
      </div>

      <div className="notification-form-grid">
        <label className="field">
          <span className="field-label">Заголовок</span>
          <input
            className="input"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>

        <label className="field">
          <span className="field-label">Текст</span>
          <input
            className="input"
            value={draft.body}
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          />
        </label>
      </div>

      <PushPreview body={preview.body} title={preview.title} />

      <div className="notification-card-foot">
        <span className="toolbar-note">{HINT}</span>
        <span className="toolbar-spacer" />
        <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
          <Save size={15} aria-hidden />
          {save.isPending ? "Сохраняем..." : "Сохранить"}
        </Button>
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
    <section className="notification-card">
      <div className="notification-card-head">
        <div className="push-icon">
          <Clock3 size={16} aria-hidden />
        </div>
        <div>
          <div className="row-main">Тихие часы для акций</div>
          <div className="row-sub">Рекламные рассылки ждут утра, транзакционные шаги уходят всегда.</div>
        </div>
      </div>

      <div className="notification-form-grid compact">
        <label className="field">
          <span className="field-label">С</span>
          <input
            className="input"
            type="time"
            value={draft.quiet_from.slice(0, 5)}
            onChange={(event) => setDraft({ ...draft, quiet_from: `${event.target.value}:00` })}
          />
        </label>
        <label className="field">
          <span className="field-label">До</span>
          <input
            className="input"
            type="time"
            value={draft.quiet_to.slice(0, 5)}
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
      </div>

      <div className="notification-card-foot">
        <span className="toolbar-spacer" />
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

  return (
    <div className="page-stack">
      <div className="info-band">
        Уведомления о заказе приходят гостям, которые разрешили push. Отключённый шаг означает,
        что на этом статусе заказ не создаёт сообщение.
      </div>

      {rules.error ? (
        <div className="error-state">
          <h2>Не удалось загрузить правила</h2>
          <p>{errorMessage(rules.error)}</p>
        </div>
      ) : rules.isPending ? (
        <div className="notification-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : (
        <div className="notification-grid">
          {(rules.data ?? []).map((rule) => (
            <StepCard key={`${rule.restaurant_id ?? "all"}-${rule.event}`} rule={rule} />
          ))}
        </div>
      )}

      {hours.data ? <QuietHoursCard hours={hours.data} /> : null}
    </div>
  );
}
