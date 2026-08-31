import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BadgePercent,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Eye,
  FileDiff,
  RefreshCw,
  Save,
  Trash2,
  Utensils,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api, ApiError, formatDateTime, formatPrice, type SyncChange, type SyncRun } from "./api";
import { Badge, Button, IconButton, Section } from "./ui";

type Kind = SyncRun["kind"];
type Action = SyncChange["action"];

type Fact = {
  label: string;
  value: string;
};

const CARDS: { hint: string; icon: typeof Utensils; kind: Kind; title: string }[] = [
  {
    kind: "menu",
    icon: Utensils,
    title: "Меню",
    hint: "Блюда, разделы, цены, описания, вес и фотографии.",
  },
  {
    kind: "restaurants",
    icon: Building2,
    title: "Рестораны",
    hint: "Адреса, города, телефоны, метро, координаты и часы.",
  },
  {
    kind: "promos",
    icon: BadgePercent,
    title: "Акции",
    hint: "Новые офферы, сроки, рестораны, фотографии и показ в меню.",
  },
];

const ACTIONS: Record<Action, { label: string; section: string; tone: "ok" | "warn" | "bad" }> = {
  create: { label: "добавится", section: "Новое с сайта", tone: "ok" },
  delete: { label: "пропало с сайта", section: "Убрать из базы", tone: "bad" },
  update: { label: "изменится", section: "Изменения", tone: "warn" },
};

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function statusBadge(run: SyncRun | undefined) {
  if (!run) return <Badge text="не сверяли" tone="muted" />;
  if (run.status === "checking") return <Badge text="читаем сайт" tone="warn" />;
  if (run.status === "applying") return <Badge text="записываем" tone="warn" />;
  if (run.status === "failed") return <Badge text="ошибка" tone="bad" />;

  const pending = run.changes.filter((change) => !change.applied).length;
  if (pending > 0) return <Badge text={`${pending} к проверке`} tone="accent" />;
  if (run.changes.length > 0) return <Badge text="записано" tone="ok" />;
  return <Badge text="всё совпадает" tone="ok" />;
}

function actionCounts(run: SyncRun | undefined) {
  const changes = run?.changes ?? [];
  return {
    applied: changes.filter((change) => change.applied).length,
    create: changes.filter((change) => change.action === "create" && !change.applied).length,
    delete: changes.filter((change) => change.action === "delete" && !change.applied).length,
    pending: changes.filter((change) => !change.applied).length,
    update: changes.filter((change) => change.action === "update" && !change.applied).length,
  };
}

function payloadText(change: SyncChange, key: string): string | null {
  const value = change.payload[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function payloadNumber(change: SyncChange, key: string): number | null {
  const value = change.payload[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function payloadBool(change: SyncChange, key: string): boolean | null {
  const value = change.payload[key];
  return typeof value === "boolean" ? value : null;
}

function payloadArrayLength(change: SyncChange, key: string): number | null {
  const value = change.payload[key];
  return Array.isArray(value) ? value.length : null;
}

function shortDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function shortTime(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.slice(0, 5);
}

function promoState(change: SyncChange): string | null {
  if (change.action === "delete") return "На сайте больше нет";

  const startsAt = payloadText(change, "starts_at");
  const endsAt = payloadText(change, "ends_at");
  const now = Date.now();
  const start = startsAt ? new Date(startsAt).getTime() : null;
  const end = endsAt ? new Date(endsAt).getTime() : null;

  if (end !== null && !Number.isNaN(end) && end < now) return "Акция уже прошла";
  if (start !== null && !Number.isNaN(start) && start > now) return "Запланирована";
  if (start !== null || end !== null) return "Активна по датам";
  return null;
}

function summaryParts(change: SyncChange): string[] {
  const parts = change.summary
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 0) return parts;
  if (change.action === "create") return ["Новая позиция с сайта"];
  if (change.action === "delete") return ["На сайте больше нет"];
  return ["Изменились данные"];
}

function factsFor(change: SyncChange, kind: Kind): Fact[] {
  const facts: Fact[] = [];
  const add = (label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return;
    facts.push({ label, value: String(value) });
  };

  if (kind === "menu") {
    const price = payloadNumber(change, "price_kopecks");
    const weight = payloadNumber(change, "weight_grams");
    const volume = payloadNumber(change, "volume_ml");
    const extras = payloadArrayLength(change, "extras");
    add("Цена на сайте", price !== null && price > 0 ? formatPrice(price) : null);
    add("Раздел", payloadText(change, "category_title"));
    add("Вес", weight !== null ? `${weight} г` : null);
    add("Объём", volume !== null ? `${volume} мл` : null);
    add("Добавки", extras !== null ? extras : null);
    add("Фото", payloadText(change, "photo_id") ? "есть на сайте" : null);
  }

  if (kind === "restaurants") {
    const opens = shortTime(change.payload.opens_at);
    const closes = shortTime(change.payload.closes_at);
    const lat = payloadNumber(change, "latitude");
    const lon = payloadNumber(change, "longitude");
    const gallery = payloadArrayLength(change, "gallery");
    add("Город", payloadText(change, "city_title"));
    add("Адрес", payloadText(change, "address"));
    add("Часы", opens && closes ? `${opens}-${closes}` : null);
    add("Телефон", payloadText(change, "phone"));
    add("Метро", payloadText(change, "metro"));
    add("Координаты", lat !== null && lon !== null ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : null);
    add("Галерея", gallery !== null && gallery > 0 ? `${gallery} фото` : null);
  }

  if (kind === "promos") {
    const starts = shortDate(change.payload.starts_at);
    const ends = shortDate(change.payload.ends_at);
    const restaurants = payloadArrayLength(change, "restaurant_ids");
    const showInMenu = payloadBool(change, "show_in_menu");
    add("Состояние", promoState(change));
    add("Срок", starts || ends ? `${starts ?? "сразу"} - ${ends ?? "без окончания"}` : null);
    add("Рестораны", restaurants !== null && restaurants > 0 ? restaurants : "все");
    add("Плашка", payloadText(change, "label"));
    add("В меню", showInMenu === null ? null : showInMenu ? "показывать" : "не показывать");
    add("Фото", payloadText(change, "photo_path") ? "есть на сайте" : null);
  }

  return facts.slice(0, 7);
}

function StatusText({ run }: { run: SyncRun | undefined }) {
  if (!run) {
    return <div className="sync-run-note">Сайт ещё не сверяли. Запустите проверку, чтобы увидеть разницу перед записью.</div>;
  }

  if (run.status === "failed") {
    return <div className="form-error">{run.message ?? "Сверка завершилась ошибкой"}</div>;
  }

  const counts = actionCounts(run);

  return (
    <div className="sync-status-text">
      <span>
        <Clock3 size={14} aria-hidden />
        {run.finished_at ? `Сверили ${formatDateTime(run.finished_at)}` : "Сверяем сайт"}
      </span>
      <span>
        <CheckCircle2 size={14} aria-hidden />
        Совпало без изменений: {run.unchanged}
      </span>
      {counts.pending > 0 ? (
        <span>
          <FileDiff size={14} aria-hidden />
          Нужно разобрать: {counts.pending}
        </span>
      ) : null}
      {run.applied_at ? (
        <span>
          <Save size={14} aria-hidden />
          Записано {formatDateTime(run.applied_at)}
        </span>
      ) : null}
      {run.message ? <span>{run.message}</span> : null}
    </div>
  );
}

function ChangeCard({
  change,
  dropPending,
  kind,
  onDrop,
  onToggle,
  selected,
}: {
  change: SyncChange;
  dropPending: boolean;
  kind: Kind;
  onDrop: (changeId: string) => void;
  onToggle: (changeId: string) => void;
  selected: boolean;
}) {
  const facts = factsFor(change, kind);
  const parts = summaryParts(change);

  return (
    <article className="sync-change-card" data-action={change.action} data-applied={change.applied} data-selected={selected}>
      <div className="sync-change-main">
        <div className="sync-change-title-row">
          <div className="min-w-0">
            <h3>{change.title}</h3>
            <div className="sync-change-meta">
              {change.group ? <span>{change.group}</span> : null}
              <span>{change.external_id}</span>
            </div>
          </div>
          <Badge text={change.applied ? "уже записано" : ACTIONS[change.action].label} tone={change.applied ? "ok" : ACTIONS[change.action].tone} />
        </div>

        <div className="sync-diff-list">
          {parts.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </div>

        {facts.length > 0 ? (
          <div className="sync-facts">
            {facts.map((fact) => (
              <span key={`${fact.label}-${fact.value}`}>
                <small>{fact.label}</small>
                <strong>{fact.value}</strong>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="sync-change-actions">
        {change.applied ? (
          <Badge text="готово" tone="ok" />
        ) : (
          <>
            <Button size="xs" variant={selected ? "ghost" : "primary"} onClick={() => onToggle(change.id)}>
              {selected ? "Не применять" : "Вернуть"}
            </Button>
            <IconButton
              disabled={dropPending}
              label="Убрать из списка сверки"
              size="xs"
              variant="danger"
              onClick={() => onDrop(change.id)}
            >
              <Trash2 size={14} aria-hidden />
            </IconButton>
          </>
        )}
      </div>
    </article>
  );
}

function ChangeSection({
  changes,
  dropPending,
  kind,
  onDrop,
  onToggle,
  selectedIds,
  title,
}: {
  changes: SyncChange[];
  dropPending: boolean;
  kind: Kind;
  onDrop: (changeId: string) => void;
  onToggle: (changeId: string) => void;
  selectedIds: Set<string>;
  title: string;
}) {
  if (changes.length === 0) return null;

  return (
    <section className="sync-review-section">
      <div className="sync-review-section-head">
        <strong>{title}</strong>
        <span>{changes.length}</span>
      </div>
      <div className="sync-review-list">
        {changes.map((change) => (
          <ChangeCard
            key={change.id}
            change={change}
            dropPending={dropPending}
            kind={kind}
            selected={selectedIds.has(change.id)}
            onDrop={onDrop}
            onToggle={onToggle}
          />
        ))}
      </div>
    </section>
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

  const pending = run.changes.filter((change) => !change.applied);
  const selected = pending.filter((change) => !skipped.has(change.id));
  const selectedIds = new Set(selected.map((change) => change.id));
  const applied = run.changes.filter((change) => change.applied);
  const create = pending.filter((change) => change.action === "create");
  const update = pending.filter((change) => change.action === "update");
  const remove = pending.filter((change) => change.action === "delete");

  const toggle = (id: string) =>
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onlyAction = (action: Action) =>
    setSkipped(new Set(pending.filter((change) => change.action !== action).map((change) => change.id)));

  return (
    <div className="sync-changes">
      <div className="sync-review-summary">
        <span data-tone="ok">
          <strong>{create.length}</strong>
          <small>новое</small>
        </span>
        <span data-tone="warn">
          <strong>{update.length}</strong>
          <small>изменится</small>
        </span>
        <span data-tone="bad">
          <strong>{remove.length}</strong>
          <small>пропало</small>
        </span>
        <span data-tone="muted">
          <strong>{applied.length}</strong>
          <small>записано</small>
        </span>
      </div>

      <div className="sync-action-bar">
        <Button
          disabled={selected.length === 0 || apply.isPending || run.status === "applying"}
          onClick={() => apply.mutate(selected.map((change) => change.id))}
        >
          <Save size={15} aria-hidden />
          {run.status === "applying" ? "Записываем..." : `Применить выбранное (${selected.length})`}
        </Button>
        <Button variant="ghost" onClick={() => setSkipped(new Set())}>
          Выбрать всё
        </Button>
        <Button variant="ghost" onClick={() => onlyAction("create")}>
          Только новое
        </Button>
        <Button variant="ghost" onClick={() => onlyAction("update")}>
          Только изменения
        </Button>
        <Button variant="ghost" onClick={() => setSkipped(new Set(pending.map((change) => change.id)))}>
          Снять выбор
        </Button>
        <span className="toolbar-note">Пока не нажали применить, база не меняется.</span>
      </div>

      <div className="sync-review-grid">
        <ChangeSection
          changes={create}
          dropPending={drop.isPending}
          kind={run.kind}
          selectedIds={selectedIds}
          title={ACTIONS.create.section}
          onDrop={(id) => drop.mutate(id)}
          onToggle={toggle}
        />
        <ChangeSection
          changes={update}
          dropPending={drop.isPending}
          kind={run.kind}
          selectedIds={selectedIds}
          title={ACTIONS.update.section}
          onDrop={(id) => drop.mutate(id)}
          onToggle={toggle}
        />
        <ChangeSection
          changes={remove}
          dropPending={drop.isPending}
          kind={run.kind}
          selectedIds={selectedIds}
          title={ACTIONS.delete.section}
          onDrop={(id) => drop.mutate(id)}
          onToggle={toggle}
        />
        <ChangeSection
          changes={applied}
          dropPending={drop.isPending}
          kind={run.kind}
          selectedIds={selectedIds}
          title="Уже записано"
          onDrop={(id) => drop.mutate(id)}
          onToggle={toggle}
        />
      </div>
    </div>
  );
}

function SyncKindCard({
  busy,
  card,
  expanded,
  onCheck,
  onToggle,
  run,
}: {
  busy: boolean;
  card: (typeof CARDS)[number];
  expanded: boolean;
  onCheck: () => void;
  onToggle: () => void;
  run: SyncRun | undefined;
}) {
  const Icon = card.icon;
  const counts = actionCounts(run);
  const canExpand = run !== undefined && run.changes.length > 0;

  return (
    <section className="sync-card" data-expanded={expanded} data-kind={card.kind}>
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

      <div className="sync-kind-stats">
        <span data-tone="ok">
          <strong>{counts.create}</strong>
          <small>новых</small>
        </span>
        <span data-tone="warn">
          <strong>{counts.update}</strong>
          <small>изменений</small>
        </span>
        <span data-tone="bad">
          <strong>{counts.delete}</strong>
          <small>пропало</small>
        </span>
        <span>
          <strong>{run?.unchanged ?? 0}</strong>
          <small>без изменений</small>
        </span>
      </div>

      <div className="sync-card-actions">
        {canExpand ? (
          <Button variant="ghost" onClick={onToggle}>
            {expanded ? <ChevronUp size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
            {expanded ? "Свернуть ревизию" : `Разобрать изменения (${run.changes.length})`}
          </Button>
        ) : null}
        <Button disabled={busy} onClick={onCheck}>
          {busy ? <CheckCircle2 size={15} aria-hidden /> : <RefreshCw size={15} aria-hidden />}
          {busy ? "Проверяем..." : "Проверить сайт"}
        </Button>
      </div>

      {expanded && run ? <Changes run={run} /> : null}
    </section>
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
  const totalChanges = (runs.data ?? []).reduce((sum, run) => sum + run.changes.filter((change) => !change.applied).length, 0);
  const appliedChanges = (runs.data ?? []).reduce((sum, run) => sum + run.changes.filter((change) => change.applied).length, 0);
  const running = (runs.data ?? []).filter((run) => run.status === "checking" || run.status === "applying").length;
  const checked = (runs.data ?? []).filter((run) => run.finished_at !== null).length;

  return (
    <Section
      className="sync-page"
      title="Обновление с сайта"
      description="Сначала сверяем сайт с базой, потом разбираем список и применяем только нужное."
    >
      <div className="sync-overview">
        <div className="sync-overview-card">
          <Eye size={18} aria-hidden />
          <span>
            <strong>{checked}/{CARDS.length}</strong>
            <small>сверено</small>
          </span>
        </div>
        <div className="sync-overview-card" data-tone="accent">
          <FileDiff size={18} aria-hidden />
          <span>
            <strong>{totalChanges}</strong>
            <small>разобрать</small>
          </span>
        </div>
        <div className="sync-overview-card" data-tone="ok">
          <Save size={18} aria-hidden />
          <span>
            <strong>{appliedChanges}</strong>
            <small>записано</small>
          </span>
        </div>
        <div className="sync-overview-card" data-tone={running > 0 ? "warn" : "muted"}>
          <RefreshCw size={18} aria-hidden />
          <span>
            <strong>{running}</strong>
            <small>в работе</small>
          </span>
        </div>
      </div>

      <div className="sync-note-band">
        <AlertTriangle size={16} aria-hidden />
        <span>Проверка только читает сайт. В базу попадут только выбранные строки после кнопки «Применить выбранное».</span>
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
          const busy = run?.status === "checking" || run?.status === "applying" || start.isPending;
          const expanded = open === card.kind && run !== undefined && run.changes.length > 0;

          return (
            <SyncKindCard
              key={card.kind}
              busy={busy}
              card={card}
              expanded={expanded}
              run={run}
              onCheck={() => start.mutate(card.kind)}
              onToggle={() => setOpen(expanded ? null : card.kind)}
            />
          );
        })}
      </div>
    </Section>
  );
}
