import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BellRing,
  CalendarClock,
  Clock3,
  Coins,
  Gift,
  Power,
  Save,
  Send,
  ShoppingCart,
  Sparkles,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { api, ApiError, formatDateTime, type Automation } from "./api";
import { Badge, Button, Select } from "./ui";

type AutomationKind = {
  audience: string;
  body: string;
  icon: ReactNode;
  label: string;
  note: string;
  param: { fallback: number; hint: string; key: string; label: string; unit: string };
  target: string;
  title: string;
  trigger: string;
  when: string;
};

const TARGETS = [
  { value: "promos", label: "Лента акций", description: "Для подарков, скидок и сезонных поводов" },
  { value: "menu", label: "Меню", description: "Когда нужно вернуть гостя к выбору блюд" },
  { value: "cart", label: "Корзина", description: "Для напоминания о незавершённом заказе" },
  { value: "loyalty", label: "Карта лояльности", description: "Для баллов, уровней и персональных бонусов" },
  { value: "booking", label: "Бронь стола", description: "Для ресторанных поводов и визитов" },
];

const KINDS: AutomationKind[] = [
  {
    trigger: "birthday",
    label: "День рождения",
    note: "Поздравление уходит перед праздником или в сам день.",
    audience: "Гости с заполненной датой рождения",
    when: "по дате рождения",
    param: { key: "days_before", label: "За сколько дней", hint: "0 — в сам день", fallback: 3, unit: "дн." },
    target: "loyalty",
    title: "С днём рождения, {name}!",
    body: "Дарим подарок к вашему заказу — загляните в приложение",
    icon: <Gift size={17} aria-hidden />,
  },
  {
    trigger: "inactive",
    label: "Давно не заказывал",
    note: "Возвращает гостей, которые раньше покупали, но перестали заходить.",
    audience: "Были заказы, но нет новых заказов",
    when: "после паузы в заказах",
    param: { key: "days", label: "Дней без заказа", hint: "Обычно 30-45", fallback: 30, unit: "дн." },
    target: "menu",
    title: "Скучаем, {name}",
    body: "Ваша любимая пицца на месте — и мы придумали пару новинок",
    icon: <Clock3 size={17} aria-hidden />,
  },
  {
    trigger: "abandoned_cart",
    label: "Забытая корзина",
    note: "Напоминает только тем, кто собрал корзину и не оформил заказ.",
    audience: "Есть незавершённая корзина",
    when: "после тишины в корзине",
    param: { key: "hours", label: "Через сколько часов", hint: "Обычно 2-4", fallback: 2, unit: "ч." },
    target: "cart",
    title: "Корзина ждёт",
    body: "Ваш заказ собран — осталось оформить",
    icon: <ShoppingCart size={17} aria-hidden />,
  },
  {
    trigger: "points_expiring",
    label: "Сгорают баллы",
    note: "Пишет гостям, пока баллами ещё можно воспользоваться.",
    audience: "Есть баллы со сроком действия",
    when: "перед сгоранием баллов",
    param: { key: "days_before", label: "За сколько дней", hint: "Обычно 7", fallback: 7, unit: "дн." },
    target: "loyalty",
    title: "Баллы скоро сгорят",
    body: "Успейте потратить их на любимое блюдо",
    icon: <Coins size={17} aria-hidden />,
  },
];

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function emptyAutomation(kind: AutomationKind): Automation {
  return {
    body: kind.body,
    is_enabled: false,
    params: { [kind.param.key]: kind.param.fallback },
    target: { screen: kind.target },
    title: kind.title,
    trigger: kind.trigger,
  };
}

function targetLabel(screen: string | undefined): string {
  return TARGETS.find((target) => target.value === screen)?.label ?? "Лента акций";
}

function normalizeAutomation(draft: Automation, kind: AutomationKind): Automation {
  const value = Number(draft.params?.[kind.param.key] ?? kind.param.fallback);

  return {
    ...draft,
    body: draft.body.trim(),
    params: { [kind.param.key]: Number.isFinite(value) ? value : kind.param.fallback },
    target: { screen: draft.target.screen || kind.target },
    title: draft.title.trim(),
  };
}

function formatLastRun(value: string | null | undefined): string {
  return value ? formatDateTime(value) : "ещё не запускался";
}

function AutomationMetric({
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

function AutomationPreview({ automation }: { automation: Automation }) {
  return (
    <div className="automation-mini-phone" aria-label="Превью сценария">
      <div className="automation-mini-top">
        <BellRing size={14} aria-hidden />
        <span>Mama Roma</span>
        <small>авто</small>
      </div>
      <div className="automation-mini-push">
        <strong>{automation.title.replaceAll("{name}", "Владислав") || "Заголовок"}</strong>
        <span>{automation.body.replaceAll("{name}", "Владислав") || "Текст уведомления"}</span>
      </div>
      <div className="automation-mini-target">
        <Target size={13} aria-hidden />
        <span>{targetLabel(automation.target.screen)}</span>
      </div>
    </div>
  );
}

function AutomationCard({
  kind,
  saved,
}: {
  kind: AutomationKind;
  saved: Automation | undefined;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Automation>(() => saved ?? emptyAutomation(kind));

  useEffect(() => {
    setDraft(saved ?? emptyAutomation(kind));
  }, [kind, saved]);

  const save = useMutation({
    mutationFn: api.saveAutomation,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["automations"] });
      toast.success("Сценарий сохранён");
    },
  });

  const value = draft.params?.[kind.param.key] ?? kind.param.fallback;
  const canSave = draft.title.trim().length >= 2 && draft.body.trim().length >= 2;

  const setParam = (raw: string) =>
    setDraft({
      ...draft,
      params: { [kind.param.key]: Number(raw.replace(/\D/g, "")) || 0 },
    });

  return (
    <section className="automation-card-modern" data-enabled={draft.is_enabled}>
      <div className="automation-card-side">
        <div className="automation-title-line">
          <span className="automation-icon">{kind.icon}</span>
          <div className="min-w-0">
            <h3>{kind.label}</h3>
            <p>{kind.note}</p>
          </div>
        </div>
        <div className="automation-meta-list">
          <span>
            <small>Кому</small>
            <strong>{kind.audience}</strong>
          </span>
          <span>
            <small>Когда</small>
            <strong>{kind.when}</strong>
          </span>
          <span>
            <small>Лимит</small>
            <strong>1 раз за 30 дней</strong>
          </span>
        </div>
      </div>

      <div className="automation-card-form">
        <div className="automation-control-row">
          <button
            className="automation-status-toggle"
            aria-pressed={draft.is_enabled}
            data-active={draft.is_enabled}
            type="button"
            onClick={() => setDraft({ ...draft, is_enabled: !draft.is_enabled })}
          >
            <Power size={15} aria-hidden />
            <span>{draft.is_enabled ? "Сценарий включён" : "Сценарий выключен"}</span>
          </button>
          <span className="toolbar-spacer" />
          {saved?.sent_count ? <Badge text={`отправлено ${saved.sent_count}`} tone="accent" /> : null}
          {draft.is_enabled ? <Badge text="активен" tone="ok" /> : <Badge text="выключен" tone="muted" />}
        </div>

        <div className="automation-fields-grid">
          <label className="field">
            <span className="field-label">{kind.param.label}</span>
            <div className="automation-number-field">
              <input
                className="input mono"
                inputMode="numeric"
                value={value}
                onChange={(event) => setParam(event.target.value)}
              />
              <span>{kind.param.unit}</span>
            </div>
            <span className="field-label">{kind.param.hint}</span>
          </label>

          <div className="field">
            <span className="field-label">Куда ведёт нажатие</span>
            <Select
              value={draft.target.screen ?? kind.target}
              options={TARGETS}
              onChange={(screen) => setDraft({ ...draft, target: { screen } })}
            />
          </div>
        </div>

        <label className="field">
          <span className="field-label">Заголовок push</span>
          <input
            className="input"
            maxLength={120}
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>

        <label className="field">
          <span className="field-label">Текст уведомления</span>
          <textarea
            className="textarea automation-message-input"
            maxLength={240}
            value={draft.body}
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          />
        </label>

        <div className="automation-card-actions">
          <span className="toolbar-note">Переменная {`{name}`} заменится именем гостя.</span>
          <Button disabled={save.isPending || !canSave} onClick={() => save.mutate(normalizeAutomation(draft, kind))}>
            <Save size={15} aria-hidden />
            {save.isPending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </div>
      </div>

      <aside className="automation-preview-column">
        <AutomationPreview automation={draft} />
        <div className="automation-result-strip">
          <span>
            <small>Последний запуск</small>
            <strong>{formatLastRun(saved?.last_run_at)}</strong>
          </span>
          <span>
            <small>Всего отправлено</small>
            <strong>{saved?.sent_count ?? 0}</strong>
          </span>
        </div>
      </aside>
    </section>
  );
}

export function AutomationsTab() {
  const automations = useQuery({ queryKey: ["automations"], queryFn: api.automations });

  const stats = useMemo(() => {
    const list = automations.data ?? [];
    const active = list.filter((automation) => automation.is_enabled).length;
    const sent = list.reduce((sum, automation) => sum + (automation.sent_count ?? 0), 0);
    const latest = list
      .map((automation) => automation.last_run_at)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

    return {
      active,
      latest,
      sent,
      total: KINDS.length,
    };
  }, [automations.data]);

  return (
    <div className="page-stack">
      <div className="metric-strip">
        <AutomationMetric icon={<Sparkles size={17} aria-hidden />} label="Сценарии" note="доступно в системе" value={String(stats.total)} />
        <AutomationMetric icon={<Activity size={17} aria-hidden />} label="Активны" note="работают автоматически" tone="ok" value={String(stats.active)} />
        <AutomationMetric icon={<Send size={17} aria-hidden />} label="Отправлено" note="за всё время" value={String(stats.sent)} />
        <AutomationMetric icon={<CalendarClock size={17} aria-hidden />} label="Последний запуск" note={stats.latest ? formatDateTime(stats.latest) : "ещё не было"} tone="warn" value={stats.latest ? "есть" : "нет"} />
      </div>

      {automations.error ? (
        <div className="error-state">
          <h2>Не удалось загрузить сценарии</h2>
          <p>{errorMessage(automations.error)}</p>
        </div>
      ) : automations.isPending ? (
        <div className="automation-board">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : (
        <div className="automation-board">
          {KINDS.map((kind) => (
            <AutomationCard
              key={kind.trigger}
              kind={kind}
              saved={(automations.data ?? []).find((row) => row.trigger === kind.trigger)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
