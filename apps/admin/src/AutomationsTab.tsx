import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api, ApiError, type Automation } from "./api";
import { Badge, Button } from "./ui";

const KINDS: {
  body: string;
  label: string;
  note: string;
  param: { fallback: number; hint: string; key: string; label: string };
  title: string;
  trigger: string;
}[] = [
  {
    trigger: "birthday",
    label: "День рождения",
    note: "Пишем гостю заранее, чтобы он успел позвать друзей.",
    param: { key: "days_before", label: "За сколько дней", hint: "0 — в сам день", fallback: 3 },
    title: "С днём рождения, {name}!",
    body: "Дарим подарок к вашему заказу — загляните в приложение",
  },
  {
    trigger: "inactive",
    label: "Давно не заказывал",
    note: "Тем, кто заказывал раньше, но перестал возвращаться.",
    param: { key: "days", label: "Дней молчания", hint: "Обычно 30-45", fallback: 30 },
    title: "Скучаем, {name}",
    body: "Ваша любимая пицца на месте — и мы придумали пару новинок",
  },
  {
    trigger: "abandoned_cart",
    label: "Забытая корзина",
    note: "Гость собрал корзину, но не оформил заказ.",
    param: { key: "hours", label: "Через часов", hint: "Обычно 2-4", fallback: 2 },
    title: "Корзина ждёт",
    body: "Ваш заказ собран — осталось оформить",
  },
  {
    trigger: "points_expiring",
    label: "Сгорают баллы",
    note: "Напоминание, пока баллами ещё можно воспользоваться.",
    param: { key: "days_before", label: "За сколько дней", hint: "Обычно 7", fallback: 7 },
    title: "Баллы скоро сгорят",
    body: "Успейте потратить их на любимое блюдо",
  },
];

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function emptyAutomation(kind: (typeof KINDS)[number]): Automation {
  return {
    body: kind.body,
    is_enabled: false,
    params: { [kind.param.key]: kind.param.fallback },
    target: { screen: "promos" },
    title: kind.title,
    trigger: kind.trigger,
  };
}

function PushPreview({ automation }: { automation: Automation }) {
  return (
    <div className="push-preview">
      <div className="push-icon">
        <Sparkles size={16} aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="row-main">{automation.title.replaceAll("{name}", "Владислав")}</div>
        <div className="row-sub">{automation.body.replaceAll("{name}", "Владислав")}</div>
      </div>
    </div>
  );
}

function AutomationCard({
  kind,
  saved,
}: {
  kind: (typeof KINDS)[number];
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

  return (
    <section className="notification-card" data-enabled={draft.is_enabled}>
      <div className="notification-card-head">
        <label className="inline-check">
          <input
            checked={draft.is_enabled}
            type="checkbox"
            onChange={(event) => setDraft({ ...draft, is_enabled: event.target.checked })}
          />
          <span className="row-main">{kind.label}</span>
        </label>
        <span className="toolbar-spacer" />
        {saved?.sent_count ? <Badge text={`отправлено ${saved.sent_count}`} tone="accent" /> : null}
        {draft.is_enabled ? <Badge text="активен" tone="ok" /> : <Badge text="выключен" tone="muted" />}
      </div>

      <p className="section-copy">{kind.note}</p>

      <div className="notification-form-grid compact">
        <label className="field">
          <span className="field-label">{kind.param.label}</span>
          <input
            className="input"
            inputMode="numeric"
            value={value}
            onChange={(event) =>
              setDraft({
                ...draft,
                params: { [kind.param.key]: Number(event.target.value.replace(/\D/g, "")) || 0 },
              })
            }
          />
          <span className="field-label">{kind.param.hint}</span>
        </label>

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

      <PushPreview automation={draft} />

      <div className="notification-card-foot">
        <span className="toolbar-note">Один сценарий пишет одному гостю не чаще раза в месяц.</span>
        <span className="toolbar-spacer" />
        <Button disabled={save.isPending || draft.title.trim().length < 2} onClick={() => save.mutate(draft)}>
          <Save size={15} aria-hidden />
          {save.isPending ? "Сохраняем..." : "Сохранить"}
        </Button>
      </div>
    </section>
  );
}

export function AutomationsTab() {
  const automations = useQuery({ queryKey: ["automations"], queryFn: api.automations });

  return (
    <div className="page-stack">
      <div className="info-band">
        Сценарии срабатывают автоматически, когда наступает повод. Рекламные сообщения учитывают
        тихие часы и лимит частоты.
      </div>

      {automations.error ? (
        <div className="error-state">
          <h2>Не удалось загрузить сценарии</h2>
          <p>{errorMessage(automations.error)}</p>
        </div>
      ) : automations.isPending ? (
        <div className="notification-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : (
        <div className="notification-grid">
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
