import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CalendarDays, CheckCircle2, Clock3, Eye, History, Phone, Search, UserRound, Users } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  type Reservation,
  type ReservationStatus,
} from "../../api";
import { ConfirmDialog } from "../../components/patterns/ConfirmDialog";
import { DataTable, DensityToggle, createAdminColumnHelper, useTableDensity } from "../../components/patterns/DataTable";
import { DetailDrawer } from "../../components/patterns/DetailDrawer";
import { formatDate, formatDateTime, formatTime } from "../../lib/format";
import { Badge, Button, Section } from "../../ui";

type Scope = "active" | "all";
type StatusFilter = "all" | ReservationStatus;

const column = createAdminColumnHelper<Reservation>();
const FINAL_STATUSES = new Set<ReservationStatus>(["cancelled", "completed", "no_show"]);

const STATUS_META: Record<ReservationStatus, { label: string; tone: "accent" | "bad" | "muted" | "ok" | "warn" }> = {
  requested: { label: "ожидает", tone: "warn" },
  confirmed: { label: "подтверждена", tone: "accent" },
  seated: { label: "за столом", tone: "ok" },
  completed: { label: "завершена", tone: "muted" },
  cancelled: { label: "отменена", tone: "bad" },
  no_show: { label: "не пришёл", tone: "bad" },
};

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "requested", label: "Ожидают" },
  { key: "confirmed", label: "Подтверждены" },
  { key: "seated", label: "За столом" },
  { key: "completed", label: "Завершены" },
  { key: "cancelled", label: "Отменены" },
  { key: "no_show", label: "Не пришли" },
];

const TRANSITIONS: Record<ReservationStatus, { label: string; status: ReservationStatus; variant?: "danger" | "ghost" }[]> = {
  requested: [
    { label: "Подтвердить", status: "confirmed" },
    { label: "Отменить", status: "cancelled", variant: "danger" },
  ],
  confirmed: [
    { label: "Посадить", status: "seated", variant: "ghost" },
    { label: "Отменить", status: "cancelled", variant: "danger" },
    { label: "Не пришёл", status: "no_show", variant: "danger" },
  ],
  seated: [{ label: "Завершить", status: "completed" }],
  completed: [],
  cancelled: [],
  no_show: [],
};

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function phoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function isToday(iso: string): boolean {
  return formatDate(iso) === formatDate(new Date().toISOString());
}

function ReservationBadge({ status }: { status: ReservationStatus }) {
  const meta = STATUS_META[status];
  return <Badge text={meta.label} tone={meta.tone} />;
}

function ActionIcon({ status }: { status: ReservationStatus }) {
  if (status === "cancelled" || status === "no_show") return <Ban size={14} aria-hidden />;
  if (status === "seated") return <UserRound size={14} aria-hidden />;
  if (status === "completed") return <CheckCircle2 size={14} aria-hidden />;
  return <CheckCircle2 size={14} aria-hidden />;
}

function Metric({
  icon,
  label,
  note,
  tone = "neutral",
  value,
}: {
  icon: ReactNode;
  label: string;
  note: string;
  tone?: "neutral" | "ok" | "warn";
  value: string;
}) {
  return (
    <div className="metric-card metric-card-rich" data-tone={tone}>
      <div className="metric-icon">{icon}</div>
      <div>
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
        <div className="metric-note">{note}</div>
      </div>
    </div>
  );
}

export function ReservationsPage() {
  const queryClient = useQueryClient();
  const [density, setDensity] = useTableDensity();
  const [scope, setScope] = useState<Scope>("active");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ reservation: Reservation; status: ReservationStatus } | null>(null);

  const activeReservations = useQuery({
    queryKey: ["reservations", "active"],
    queryFn: () => api.reservations(true),
    refetchInterval: 30_000,
  });
  const allReservations = useQuery({
    queryKey: ["reservations", "all"],
    queryFn: () => api.reservations(false),
    refetchInterval: 45_000,
  });

  const reservations = scope === "active" ? activeReservations : allReservations;

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return [...(reservations.data ?? [])]
      .sort((a, b) => new Date(a.reserved_at).getTime() - new Date(b.reserved_at).getTime())
      .filter((reservation) => {
        const haystack = [
          reservation.contact_name,
          reservation.contact_phone,
          reservation.restaurant_name,
          reservation.comment,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("ru-RU");

        return haystack.includes(needle) && (status === "all" || reservation.status === status);
      });
  }, [reservations.data, search, status]);

  const allRows = reservations.data ?? [];
  const allKnownRows = allReservations.data ?? allRows;
  const selected = selectedId ? allRows.find((reservation) => reservation.id === selectedId) ?? null : null;
  const requested = allRows.filter((reservation) => reservation.status === "requested").length;
  const today = allRows.filter((reservation) => isToday(reservation.reserved_at)).length;
  const guests = allRows.reduce((sum, reservation) => sum + reservation.guests_count, 0);
  const isLoading = reservations.isPending;
  const activeCount = (activeReservations.data ?? []).length;
  const historyCount = allKnownRows.filter((reservation) => FINAL_STATUSES.has(reservation.status)).length;

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ReservationStatus }) => api.setReservationStatus(id, status),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (reservation) => {
      setConfirmTarget(null);
      setSelectedId(scope === "active" && FINAL_STATUSES.has(reservation.status) ? null : reservation.id);
      void queryClient.invalidateQueries({ queryKey: ["reservations"] });
      toast.success("Статус брони обновлён");
    },
  });

  const requestStatusChange = (reservation: Reservation, nextStatus: ReservationStatus) => {
    if (nextStatus === "cancelled" || nextStatus === "no_show") {
      setConfirmTarget({ reservation, status: nextStatus });
      return;
    }
    statusMutation.mutate({ id: reservation.id, status: nextStatus });
  };

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("reserved_at", {
          header: "Когда",
          sortFn: "datetime",
          cell: (info) => {
            const row = info.row.original;
            return (
              <div>
                <div className="row-main">{formatDateTime(info.getValue())}</div>
                <div className="row-sub">
                  {row.duration_minutes} мин · заявка {formatDateTime(row.created_at)}
                </div>
              </div>
            );
          },
        }),
        column.display({
          id: "guest",
          header: "Гость",
          cell: (info) => {
            const row = info.row.original;
            return (
              <div>
                <div className="row-main">{row.contact_name ?? "Без имени"}</div>
                <div className="row-sub">{row.contact_phone}</div>
                {row.comment ? <div className="row-sub">{row.comment}</div> : null}
              </div>
            );
          },
        }),
        column.accessor("restaurant_name", {
          header: "Ресторан",
          cell: (info) => info.getValue(),
        }),
        column.accessor("guests_count", {
          header: "Гостей",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => <span className="mono">{info.getValue()}</span>,
        }),
        column.accessor("status", {
          header: "Статус",
          cell: (info) => <ReservationBadge status={info.getValue()} />,
        }),
        column.display({
          id: "actions",
          header: "",
          meta: { align: "right" },
          cell: (info) => {
            const row = info.row.original;
            const next = TRANSITIONS[row.status][0];
            return (
              <div className="cell-actions">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedId(row.id);
                  }}
                >
                  <Eye size={14} aria-hidden />
                  Детали
                </Button>
                {next ? (
                  <Button
                    disabled={statusMutation.isPending}
                    size="xs"
                    variant={next.variant ?? "ghost"}
                    onClick={(event) => {
                      event.stopPropagation();
                      requestStatusChange(row, next.status);
                    }}
                  >
                    <ActionIcon status={next.status} />
                    {next.label}
                  </Button>
                ) : null}
                {!FINAL_STATUSES.has(row.status) ? (
                  <Button
                    disabled={statusMutation.isPending}
                    size="xs"
                    variant="danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      requestStatusChange(row, "cancelled");
                    }}
                  >
                    <Ban size={14} aria-hidden />
                    Отменить
                  </Button>
                ) : null}
              </div>
            );
          },
        }),
      ]),
    [statusMutation.isPending],
  );

  return (
    <Section
      title="Бронирования"
      description="Заявки гостей на столы, подтверждение, посадка и история отмен."
    >
      <div className="metric-strip">
        <Metric icon={<CalendarDays size={18} aria-hidden />} label="Броней" note={scope === "active" ? "активный список" : "в истории"} value={isLoading ? "..." : String(allRows.length)} />
        <Metric icon={<CheckCircle2 size={18} aria-hidden />} label="Ожидают" note="нужно подтвердить" tone={requested > 0 ? "warn" : "ok"} value={isLoading ? "..." : String(requested)} />
        <Metric icon={<Clock3 size={18} aria-hidden />} label="Сегодня" note="по времени брони" value={isLoading ? "..." : String(today)} />
        <Metric icon={<Users size={18} aria-hidden />} label="Гостей" note="суммарно" value={isLoading ? "..." : String(guests)} />
      </div>

      <div className="reservation-mode-grid">
        <button
          className="reservation-mode-card"
          data-active={scope === "active"}
          type="button"
          onClick={() => setScope("active")}
        >
          <span className="metric-icon">
            <CalendarDays size={18} aria-hidden />
          </span>
          <span className="reservation-mode-copy">
            <span className="row-main">Активные</span>
            <span className="row-sub">ожидают подтверждения, посадки или завершения</span>
          </span>
          <span className="reservation-mode-count">{activeReservations.isPending ? "..." : activeCount}</span>
        </button>
        <button
          className="reservation-mode-card"
          data-active={scope === "all"}
          type="button"
          onClick={() => setScope("all")}
        >
          <span className="metric-icon">
            <History size={18} aria-hidden />
          </span>
          <span className="reservation-mode-copy">
            <span className="row-main">История</span>
            <span className="row-sub">завершённые, отменённые и неявки</span>
          </span>
          <span className="reservation-mode-count">{allReservations.isPending ? "..." : historyCount}</span>
        </button>
      </div>

      <div className="surface-toolbar">
        <label className="field toolbar-field">
          <span className="field-label">Поиск</span>
          <span className="search-control">
            <Search className="search-icon" size={15} aria-hidden />
            <input
              className="input"
              placeholder="Поиск по брони"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </span>
        </label>
        <div className="filter-chips" aria-label="Статус брони">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.key}
              className="filter-chip"
              data-active={status === option.key}
              type="button"
              onClick={() => setStatus(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="toolbar-spacer" />
        <DensityToggle density={density} onChange={setDensity} />
      </div>

      {reservations.error ? (
        <div className="error-state">
          <h2>Не удалось загрузить бронирования</h2>
          <p>{errorMessage(reservations.error)}</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          density={density}
          getRowId={(row) => row.id}
          isLoading={isLoading}
          onRowClick={(reservation) => setSelectedId(reservation.id)}
          pageSize={20}
          selectedId={selectedId}
          empty={
            <div className="empty-state">
              <h2>{allRows.length === 0 ? "Броней нет" : "Нет броней в этом срезе"}</h2>
              <p>Проверьте фильтры или переключите список на историю.</p>
            </div>
          }
        />
      )}

      {selected ? (
        <DetailDrawer
          badge={<ReservationBadge status={selected.status} />}
          className="reservation-drawer"
          footer={
            <>
              <Button variant="ghost" onClick={() => setSelectedId(null)}>
                Закрыть
              </Button>
              {TRANSITIONS[selected.status].map((transition) => (
                <Button
                  key={transition.status}
                  disabled={statusMutation.isPending}
                  variant={transition.variant ?? "primary"}
                  onClick={() => requestStatusChange(selected, transition.status)}
                >
                  <ActionIcon status={transition.status} />
                  {transition.label}
                </Button>
              ))}
            </>
          }
          subtitle={`${selected.restaurant_name} · ${formatDateTime(selected.reserved_at)}`}
          title={selected.contact_name ?? "Гость без имени"}
          onClose={() => setSelectedId(null)}
        >
          <div className="drawer-metrics">
            <div className="drawer-metric">
              <div className="metric-label">Время</div>
              <div className="drawer-metric-value">{formatTime(selected.reserved_at)}</div>
            </div>
            <div className="drawer-metric">
              <div className="metric-label">Гостей</div>
              <div className="drawer-metric-value">{selected.guests_count}</div>
            </div>
          </div>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Контакт</h3>
            <div className="detail-list">
              <div className="detail-row">
                <span className="detail-label">Телефон</span>
                <a className="inline-link" href={phoneHref(selected.contact_phone)}>
                  <Phone size={14} aria-hidden />
                  {selected.contact_phone}
                </a>
              </div>
              <div className="detail-row">
                <span className="detail-label">Комментарий</span>
                <span>{selected.comment ?? "—"}</span>
              </div>
            </div>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Детали брони</h3>
            <div className="timeline-list">
              <div className="timeline-row">
                <div className="row-main">
                  <CalendarDays size={14} aria-hidden /> {formatDate(selected.reserved_at)}
                </div>
                <div className="row-sub">{selected.restaurant_name}</div>
              </div>
              <div className="timeline-row">
                <div className="row-main">
                  <Clock3 size={14} aria-hidden /> {selected.duration_minutes} минут
                </div>
                <div className="row-sub">создано {formatDateTime(selected.created_at)}</div>
              </div>
              <div className="timeline-row">
                <div className="row-main">
                  <Users size={14} aria-hidden /> {selected.guests_count} гост.
                </div>
                <div className="row-sub">статус: {STATUS_META[selected.status].label}</div>
              </div>
            </div>
          </section>
        </DetailDrawer>
      ) : null}

      {confirmTarget ? (
        <ConfirmDialog
          busy={statusMutation.isPending}
          message={`Бронь гостя «${confirmTarget.reservation.contact_name ?? confirmTarget.reservation.contact_phone}» будет переведена в статус «${STATUS_META[confirmTarget.status].label}».`}
          title={confirmTarget.status === "no_show" ? "Отметить неявку" : "Отменить бронь"}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={() => statusMutation.mutate({ id: confirmTarget.reservation.id, status: confirmTarget.status })}
        />
      ) : null}
    </Section>
  );
}
