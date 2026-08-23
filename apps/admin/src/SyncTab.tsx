import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, type ApiError, type SyncChange, type SyncRun } from "./api";
import { Badge, Button, c, Section, spacing, styles, typography } from "./ui";

type Kind = SyncRun["kind"];

const CARDS: { kind: Kind; title: string; hint: string }[] = [
  {
    kind: "menu",
    title: "Меню",
    hint: "Разделы, блюда, описания, цены и фотографии.",
  },
  {
    kind: "restaurants",
    title: "Рестораны",
    hint: "Адреса, метро, телефоны, координаты и часы работы.",
  },
  {
    kind: "promos",
    title: "Акции",
    hint: "События и предложения вместе с текстом, афишей и списком ресторанов.",
  },
];

const ACTIONS: Record<SyncChange["action"], { label: string; tone: "ok" | "warn" | "muted" }> = {
  create: { label: "новое", tone: "ok" },
  update: { label: "изменилось", tone: "warn" },
  delete: { label: "удалить", tone: "muted" },
};

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Changes({ run }: { run: SyncRun }) {
  const queryClient = useQueryClient();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["sync"] });

  const apply = useMutation({
    mutationFn: (ids: string[]) => api.applySync(run.id, ids),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (exc: ApiError) => setError(exc.message),
  });

  const drop = useMutation({
    mutationFn: (changeId: string) => api.dropSyncChange(run.id, changeId),
    onSuccess: refresh,
    onError: (exc: ApiError) => setError(exc.message),
  });

  const picked = run.changes.filter((change) => !skipped.has(change.id));
  const groups = new Map<string, SyncChange[]>();
  for (const change of run.changes) {
    const key = change.group ?? "Прочее";
    groups.set(key, [...(groups.get(key) ?? []), change]);
  }

  const toggle = (id: string) =>
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div style={{ display: "grid", gap: spacing.md }}>
      {error ? <span style={{ color: c.danger }}>{error}</span> : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing.md,
          position: "sticky",
          top: 0,
          background: c.background,
          paddingBottom: spacing.sm,
          zIndex: 1,
        }}
      >
        <Button
          disabled={picked.length === 0 || apply.isPending || run.status === "applying"}
          onClick={() => apply.mutate(picked.map((change) => change.id))}
        >
          {run.status === "applying" ? "Сохраняем…" : `Сохранить (${picked.length})`}
        </Button>

        <Button tone="quiet" onClick={() => setSkipped(new Set())}>
          Отметить все
        </Button>
        <Button
          tone="quiet"
          onClick={() => setSkipped(new Set(run.changes.map((change) => change.id)))}
        >
          Снять все
        </Button>

        <span style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
          Пока не нажмёте «Сохранить», в базе ничего не меняется
        </span>
      </div>

      {[...groups.entries()].map(([group, changes]) => (
        <div key={group} style={{ display: "grid", gap: 6 }}>
          <span
            style={{
              fontSize: typography.caption.fontSize,
              color: c.textTertiary,
              textTransform: "uppercase",
              letterSpacing: 0.6,
            }}
          >
            {group} · {changes.length}
          </span>

          {changes.map((change) => {
            const off = skipped.has(change.id);

            return (
              <label
                key={change.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: spacing.sm,
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  borderRadius: 10,
                  border: `1px solid ${c.border}`,
                  background: off ? "transparent" : c.surface,
                  opacity: off ? 0.5 : 1,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={!off}
                  disabled={change.applied}
                  onChange={() => toggle(change.id)}
                />

                <Badge text={ACTIONS[change.action].label} tone={ACTIONS[change.action].tone} />

                <span style={{ flex: 1 }}>
                  {change.title}
                  <span
                    style={{
                      color: c.textSecondary,
                      fontSize: typography.caption.fontSize,
                      marginLeft: spacing.sm,
                    }}
                  >
                    {change.summary}
                  </span>
                </span>

                {change.applied ? (
                  <Badge text="записано" tone="ok" />
                ) : (
                  <Button tone="danger" onClick={() => drop.mutate(change.id)}>
                    Убрать
                  </Button>
                )}
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Status({ run }: { run: SyncRun }) {
  if (run.status === "checking") {
    return <Badge text="читаем сайт…" tone="warn" />;
  }

  if (run.status === "failed") {
    return (
      <div style={{ display: "grid", gap: 4 }}>
        <Badge text="не получилось" tone="warn" />
        <span style={{ color: c.danger, fontSize: typography.caption.fontSize }}>
          {run.message}
        </span>
      </div>
    );
  }

  const numbers = [
    run.created > 0 ? `добавлено ${run.created}` : null,
    run.updated > 0 ? `обновлено ${run.updated}` : null,
    run.removed > 0 ? `удалено ${run.removed}` : null,
  ].filter(Boolean);

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <span style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
        Сверили {when(run.finished_at)} · совпало {run.unchanged}
        {run.changes.length > 0 ? ` · расхождений ${run.changes.length}` : " · расхождений нет"}
      </span>

      {run.applied_at ? (
        <span style={{ color: c.success, fontSize: typography.caption.fontSize }}>
          Записано {when(run.applied_at)} · {numbers.join(", ") || "изменений нет"}
        </span>
      ) : null}

      {run.message ? (
        <span style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
          {run.message}
        </span>
      ) : null}
    </div>
  );
}

export function SyncTab() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Kind | null>(null);

  const runs = useQuery({
    queryKey: ["sync"],
    queryFn: api.syncRuns,
    // Сверка идёт минутами, поэтому пока она не закончилась — спрашиваем чаще
    refetchInterval: (query) =>
      (query.state.data ?? []).some(
        (run) => run.status === "checking" || run.status === "applying",
      )
        ? 3000
        : false,
  });

  const start = useMutation({
    mutationFn: (kind: Kind) => api.startSync(kind),
    onSuccess: (run) => {
      setError(null);
      setOpen(run.kind);
      void queryClient.invalidateQueries({ queryKey: ["sync"] });
    },
    onError: (exc: ApiError) => setError(exc.message),
  });

  const byKind = new Map((runs.data ?? []).map((run) => [run.kind, run]));

  return (
    <Section title="Обновление с сайта">
      <p style={{ margin: 0, color: c.textSecondary, maxWidth: 760 }}>
        Сначала мы читаем mamaroma.ru и показываем, что нового появилось и что разошлось с
        нашей базой. Ничего не записывается, пока вы не нажмёте «Сохранить», а лишнее из
        списка можно убрать.
      </p>

      {error ? <div style={{ color: c.danger }}>{error}</div> : null}

      <div style={{ display: "grid", gap: spacing.md }}>
        {CARDS.map((card) => {
          const run = byKind.get(card.kind);
          const busy = run?.status === "checking" || run?.status === "applying";
          const expanded = open === card.kind && run !== undefined && run.changes.length > 0;

          return (
            <div
              key={card.kind}
              style={{ ...styles.card, padding: spacing.lg, display: "grid", gap: spacing.md }}
            >
              <div style={{ display: "flex", gap: spacing.lg, alignItems: "flex-start" }}>
                <div style={{ flex: 1, display: "grid", gap: 6 }}>
                  <strong style={{ fontFamily: "'Comfortaa', sans-serif" }}>{card.title}</strong>
                  <span style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                    {card.hint}
                  </span>

                  {run ? (
                    <Status run={run} />
                  ) : (
                    <span style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                      Ещё ни разу не сверяли
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", gap: spacing.sm }}>
                  {run && run.changes.length > 0 ? (
                    <Button
                      tone="quiet"
                      onClick={() => setOpen(expanded ? null : card.kind)}
                    >
                      {expanded ? "Свернуть" : `Показать (${run.changes.length})`}
                    </Button>
                  ) : null}

                  <Button disabled={busy || start.isPending} onClick={() => start.mutate(card.kind)}>
                    {busy ? "Проверяем…" : "Проверить сайт"}
                  </Button>
                </div>
              </div>

              {expanded && run ? <Changes run={run} /> : null}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
