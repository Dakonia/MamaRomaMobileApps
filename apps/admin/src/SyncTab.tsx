import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgePercent,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Save,
  Trash2,
  Utensils,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api, ApiError, formatDateTime, type SyncChange, type SyncRun } from "./api";
import { Badge, Button, IconButton, Section } from "./ui";

type Kind = SyncRun["kind"];

const CARDS: { hint: string; icon: typeof Utensils; kind: Kind; title: string }[] = [
  {
    kind: "menu",
    icon: Utensils,
    title: "Меню",
    hint: "Разделы, блюда, описания, цены и фотографии.",
  },
  {
    kind: "restaurants",
    icon: Building2,
    title: "Рестораны",
    hint: "Адреса, метро, телефоны, координаты и часы работы.",
  },
  {
    kind: "promos",
    icon: BadgePercent,
    title: "Акции",
    hint: "События, офферы, афиши и список ресторанов.",
  },
];

const ACTIONS: Record<SyncChange["action"], { label: string; tone: "ok" | "warn" | "muted" }> = {
  create: { label: "новое", tone: "ok" },
  delete: { label: "удалить", tone: "muted" },
  update: { label: "изменилось", tone: "warn" },
};

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function statusBadge(run: SyncRun | undefined) {
  if (!run) return <Badge text="не сверяли" tone="muted" />;
  if (run.status === "checking") return <Badge text="читаем сайт" tone="warn" />;
  if (run.status === "applying") return <Badge text="записываем" tone="warn" />;
  if (run.status === "failed") return <Badge text="ошибка" tone="bad" />;
  if (run.changes.length > 0) return <Badge text={`${run.changes.length} изменений`} tone="accent" />;
  return <Badge text="всё совпадает" tone="ok" />;
}

function StatusText({ run }: { run: SyncRun | undefined }) {
  if (!run) {
    return <div className="row-sub">Ещё ни разу не сверяли с сайтом.</div>;
  }

  if (run.status === "failed") {
    return <div className="form-error">{run.message ?? "Сверка завершилась ошибкой"}</div>;
  }

  const changes = [
    run.created > 0 ? `добавлено ${run.created}` : null,
    run.updated > 0 ? `обновлено ${run.updated}` : null,
    run.removed > 0 ? `удалено ${run.removed}` : null,
  ].filter(Boolean);

  return (
    <div className="sync-status-text">
      <span>Сверили {run.finished_at ? formatDateTime(run.finished_at) : "..."}</span>
      <span>Совпало {run.unchanged}</span>
      {run.applied_at ? (
        <span>
          Записано {formatDateTime(run.applied_at)} · {changes.join(", ") || "изменений нет"}
        </span>
      ) : null}
      {run.message ? <span>{run.message}</span> : null}
    </div>
  );
}

function Changes({ run }: { run: SyncRun }) {
  const queryClient = useQueryClient();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["sync"] });

  const apply = useMutation({
    mutationFn: (ids: string[]) => api.applySync(run.id, ids),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      refresh();
      toast.success("Изменения применены");
    },
  });

  const drop = useMutation({
    mutationFn: (changeId: string) => api.dropSyncChange(run.id, changeId),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      refresh();
      toast.success("Изменение убрано из сверки");
    },
  });

  const groups = new Map<string, SyncChange[]>();
  for (const change of run.changes) {
    const key = change.group ?? "Прочее";
    groups.set(key, [...(groups.get(key) ?? []), change]);
  }

  const picked = run.changes.filter((change) => !skipped.has(change.id) && !change.applied);
  const toggle = (id: string) =>
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="sync-changes">
      <div className="sync-action-bar">
        <Button
          disabled={picked.length === 0 || apply.isPending || run.status === "applying"}
          onClick={() => apply.mutate(picked.map((change) => change.id))}
        >
          <Save size={15} aria-hidden />
          {run.status === "applying" ? "Сохраняем..." : `Сохранить (${picked.length})`}
        </Button>
        <Button variant="ghost" onClick={() => setSkipped(new Set())}>
          Отметить все
        </Button>
        <Button variant="ghost" onClick={() => setSkipped(new Set(run.changes.map((change) => change.id)))}>
          Снять все
        </Button>
        <span className="toolbar-note">Пока не нажать сохранить, база не меняется.</span>
      </div>

      <div className="sync-groups">
        {[...groups.entries()].map(([group, changes]) => (
          <section key={group} className="sync-group">
            <div className="sync-group-title">
              {group} · {changes.length}
            </div>
            {changes.map((change) => {
              const off = skipped.has(change.id);
              return (
                <div key={change.id} className="sync-change-row" data-skipped={off}>
                  <label className="inline-check">
                    <input
                      checked={!off}
                      disabled={change.applied}
                      type="checkbox"
                      onChange={() => toggle(change.id)}
                    />
                    <Badge text={ACTIONS[change.action].label} tone={ACTIONS[change.action].tone} />
                  </label>
                  <div className="min-w-0">
                    <div className="row-main">{change.title}</div>
                    <div className="row-sub">{change.summary}</div>
                  </div>
                  <span className="toolbar-spacer" />
                  {change.applied ? (
                    <Badge text="записано" tone="ok" />
                  ) : (
                    <IconButton
                      label="Убрать изменение"
                      size="xs"
                      variant="danger"
                      onClick={() => drop.mutate(change.id)}
                    >
                      <Trash2 size={14} aria-hidden />
                    </IconButton>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

export function SyncTab() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Kind | null>(null);

  const runs = useQuery({
    queryKey: ["sync"],
    queryFn: api.syncRuns,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((run) => run.status === "checking" || run.status === "applying")
        ? 3000
        : false,
  });

  const start = useMutation({
    mutationFn: (kind: Kind) => api.startSync(kind),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (run) => {
      setOpen(run.kind);
      void queryClient.invalidateQueries({ queryKey: ["sync"] });
      toast.success("Сверка запущена");
    },
  });

  const byKind = new Map((runs.data ?? []).map((run) => [run.kind, run]));
  const totalChanges = (runs.data ?? []).reduce((sum, run) => sum + run.changes.length, 0);
  const running = (runs.data ?? []).filter((run) => run.status === "checking" || run.status === "applying").length;
  const applied = (runs.data ?? []).filter((run) => run.applied_at !== null).length;

  return (
    <Section
      title="Обновление с сайта"
      description="Сверка mamaroma.ru с нашей базой: сначала смотрим изменения, потом применяем выбранное."
    >
      <div className="metric-strip">
        <div className="metric-card">
          <div className="metric-label">Источники</div>
          <div className="metric-value">{CARDS.length}</div>
          <div className="metric-note">меню, рестораны, акции</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Изменений</div>
          <div className="metric-value">{totalChanges}</div>
          <div className="metric-note">в последней сверке</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">В работе</div>
          <div className="metric-value">{running}</div>
          <div className="metric-note">проверяется или пишется</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Применено</div>
          <div className="metric-value">{applied}</div>
          <div className="metric-note">разделов уже записано</div>
        </div>
      </div>

      <div className="info-band">
        Сверка только читает сайт. В базу попадут только отмеченные изменения после отдельного сохранения.
      </div>

      {runs.error ? (
        <div className="error-state">
          <h2>Не удалось загрузить историю сверок</h2>
          <p>{errorMessage(runs.error)}</p>
        </div>
      ) : null}

      <div className="sync-card-grid">
        {CARDS.map((card) => {
          const run = byKind.get(card.kind);
          const Icon = card.icon;
          const busy = run?.status === "checking" || run?.status === "applying";
          const expanded = open === card.kind && run !== undefined && run.changes.length > 0;

          return (
            <section key={card.kind} className="sync-card">
              <div className="sync-card-head">
                <div className="sync-card-icon">
                  <Icon size={18} aria-hidden />
                </div>
                <div className="min-w-0">
                  <div className="section-title">{card.title}</div>
                  <div className="section-copy">{card.hint}</div>
                </div>
                <span className="toolbar-spacer" />
                {statusBadge(run)}
              </div>

              <StatusText run={run} />

              <div className="drawer-actions">
                {run && run.changes.length > 0 ? (
                  <Button variant="ghost" onClick={() => setOpen(expanded ? null : card.kind)}>
                    {expanded ? <ChevronUp size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
                    {expanded ? "Свернуть" : `Показать (${run.changes.length})`}
                  </Button>
                ) : null}
                <Button disabled={busy || start.isPending} onClick={() => start.mutate(card.kind)}>
                  {busy ? <CheckCircle2 size={15} aria-hidden /> : <RefreshCw size={15} aria-hidden />}
                  {busy ? "Проверяем..." : "Проверить сайт"}
                </Button>
              </div>

              {expanded && run ? <Changes run={run} /> : null}
            </section>
          );
        })}
      </div>
    </Section>
  );
}
