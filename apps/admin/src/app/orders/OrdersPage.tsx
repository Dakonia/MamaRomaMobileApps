import {
  DndContext,
  DragOverlay,
  closestCorners,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Bike,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  ChefHat,
  CircleDot,
  ClipboardCheck,
  Clock3,
  Columns3,
  Download,
  GripVertical,
  Minus,
  MoreHorizontal,
  PackageCheck,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Store,
  Table2,
  Trash2,
  Truck,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  api,
  tenant,
  type OrderCard,
  type OrderGroup,
  type OrderListRow,
  type OrderPage,
  type RestaurantDish,
} from "../../api";
import { formatDateTime, formatPrice, formatTime } from "../../lib/format";
import { Button, IconButton, cn } from "../../ui";

type OrderStatus =
  | "created"
  | "paid"
  | "accepted"
  | "cooking"
  | "ready"
  | "delivering"
  | "completed"
  | "cancelled";

type BadgeTone = "ok" | "warn" | "muted" | "bad" | "accent";
type OrdersView = "board" | "table";
type OrderFilter = "all" | "delivery" | "pickup";
type TableDensity = "compact" | "regular";
type OrderPeriod = "all" | "today" | "yesterday" | "week" | "month" | "custom";
type OrderTransition = {
  description: string;
  icon: LucideIcon;
  label: string;
  status: OrderStatus;
  tone: BadgeTone;
};
type SetOrderStatusInput = {
  id: string;
  number: string;
  status: OrderStatus;
};

const DENSITY_KEY = "mr.admin.table-density";

const STATUS_META: Record<
  OrderStatus,
  {
    description: string;
    icon: LucideIcon;
    label: string;
    shortLabel: string;
    tone: BadgeTone;
  }
> = {
  created: {
    description: "Заказ попал в админку и ждёт подтверждения рестораном.",
    icon: CircleDot,
    label: "Оформлен",
    shortLabel: "Новый",
    tone: "muted",
  },
  paid: {
    description: "Оплата прошла, заказ можно брать в работу.",
    icon: CircleDot,
    label: "Оплачен",
    shortLabel: "Оплачен",
    tone: "muted",
  },
  accepted: {
    description: "Ресторан подтвердил заказ и отвечает за следующий шаг.",
    icon: ClipboardCheck,
    label: "Принят",
    shortLabel: "Принят",
    tone: "accent",
  },
  cooking: {
    description: "Кухня готовит. Этот этап должен двигаться без лишних пауз.",
    icon: ChefHat,
    label: "Готовится",
    shortLabel: "Кухня",
    tone: "warn",
  },
  ready: {
    description: "Заказ готов и ждёт курьера или выдачи гостю.",
    icon: PackageCheck,
    label: "Готов",
    shortLabel: "Готов",
    tone: "accent",
  },
  delivering: {
    description: "Курьер забрал заказ, теперь контролируем доставку.",
    icon: Truck,
    label: "В пути",
    shortLabel: "В пути",
    tone: "warn",
  },
  completed: {
    description: "Заказ успешно закрыт.",
    icon: CheckCircle2,
    label: "Выполнен",
    shortLabel: "Готово",
    tone: "ok",
  },
  cancelled: {
    description: "Заказ закрыт отменой. История остаётся в списке.",
    icon: XCircle,
    label: "Отменён",
    shortLabel: "Отмена",
    tone: "bad",
  },
};

const STATUS_PIPELINE: OrderStatus[] = ["created", "accepted", "cooking", "ready", "delivering", "completed"];

const ORDER_FLOW: Record<OrderStatus, { next: OrderStatus[] }> = {
  created: { next: ["accepted"] },
  paid: { next: ["accepted"] },
  accepted: { next: ["cooking"] },
  cooking: { next: ["ready"] },
  ready: { next: ["delivering", "completed"] },
  delivering: { next: ["completed"] },
  completed: { next: [] },
  cancelled: { next: [] },
};

const ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  accepted: "Принять в работу",
  cooking: "Начать готовить",
  ready: "Отметить готовым",
  delivering: "Передать курьеру",
  completed: "Закрыть заказ",
};

const BOARD_COLUMNS: {
  id: OrderStatus;
  label: string;
  statuses: OrderStatus[];
  tone: BadgeTone;
}[] = [
  { id: "created", label: "Новые", statuses: ["created", "paid"], tone: "muted" },
  { id: "accepted", label: "Приняты", statuses: ["accepted"], tone: "accent" },
  { id: "cooking", label: "Готовятся", statuses: ["cooking"], tone: "warn" },
  { id: "ready", label: "Готовы", statuses: ["ready"], tone: "accent" },
  { id: "delivering", label: "В пути", statuses: ["delivering"], tone: "warn" },
];

const CLOSED_STATUSES = new Set<OrderStatus>(["completed", "cancelled"]);

/** Чего хватает, чтобы перевести заказ на следующий шаг. */
type StatusTarget = { id: string; number: string; status: string; type: string };

/** Сколько строк в странице списка: экран вмещает меньше, остальное — прокрутка. */
const PAGE_SIZE = 50;
/**
 * Доска — это смена целиком, её не листают: столько заказов за раз отдаёт
 * сервер, а сколько их всего, столбец скажет по счётчику.
 */
const BOARD_LIMIT = 200;

/** Вкладки списка и их подписи. */
const PERIOD_OPTIONS: { key: OrderPeriod; label: string }[] = [
  { key: "all", label: "За всё время" },
  { key: "today", label: "Сегодня" },
  { key: "yesterday", label: "Вчера" },
  { key: "week", label: "Последние 7 дней" },
  { key: "month", label: "Последние 30 дней" },
  { key: "custom", label: "Свой период" },
];

const GROUP_TABS: { key: OrderGroup; label: string }[] = [
  { key: "active", label: "Активные" },
  { key: "done", label: "Завершённые" },
  { key: "cancelled", label: "Отменённые" },
  { key: "all", label: "Все" },
];

function isoDay(shiftDays = 0): string {
  const day = new Date();
  day.setDate(day.getDate() + shiftDays);
  return day.toISOString().slice(0, 10);
}

/** Границы отбора по датам. Считаем по дню ресторана, а не по часам. */
function periodRange(period: OrderPeriod, from: string, to: string) {
  switch (period) {
    case "today":
      return { from: isoDay(), to: isoDay() };
    case "yesterday":
      return { from: isoDay(-1), to: isoDay(-1) };
    case "week":
      return { from: isoDay(-6), to: isoDay() };
    case "month":
      return { from: isoDay(-29), to: isoDay() };
    case "custom":
      return { from, to };
    default:
      return { from: "", to: "" };
  }
}

/**
 * Тянет блок до низа окна и держит его там.
 *
 * Доске нужна своя высота, чтобы столбцы прокручивались внутри себя, а не
 * растягивали страницу. Считать её в стилях нечем: над доской и вкладки, и
 * плитки, и полоса тревоги, которая то появляется, то нет.
 */
function useFillHeight<T extends HTMLElement>(bottomGap = 20) {
  const ref = useRef<T | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const fit = () => {
      const top = node.getBoundingClientRect().top;
      node.style.setProperty("--board-height", `${Math.max(320, window.innerHeight - top - bottomGap)}px`);
    };

    fit();
    window.addEventListener("resize", fit);
    const observer = new ResizeObserver(fit);
    observer.observe(document.body);

    return () => {
      window.removeEventListener("resize", fit);
      observer.disconnect();
    };
  }, [bottomGap]);

  return ref;
}

/**
 * Значение, отстающее от набора. Поиск уходит на сервер, и без паузы каждый
 * символ превращался бы в запрос — при тысячах заказов это заметно.
 */
function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}

function asOrderStatus(status: string): OrderStatus {
  return status in STATUS_META ? (status as OrderStatus) : "created";
}

function statusLabel(status: string): string {
  return STATUS_META[asOrderStatus(status)]?.label ?? status;
}

const PAYMENT_LABELS: Record<string, string> = {
  online_card: "картой онлайн",
  online_sbp: "СБП",
  cash_on_delivery: "наличными курьеру",
  card_on_delivery: "картой курьеру",
};

function paymentLabel(method: string): string {
  return PAYMENT_LABELS[method] ?? method;
}

function orderTypeLabel(type: string): string {
  if (type === "delivery") return "Доставка";
  if (type === "pickup") return "Самовывоз";
  return type;
}

function minutesBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function transitionFor(status: OrderStatus, label = ACTION_LABELS[status] ?? statusLabel(status)): OrderTransition {
  const meta = STATUS_META[status];
  return {
    description: meta.description,
    icon: meta.icon,
    label,
    status,
    tone: meta.tone,
  };
}

function nextTransitions(order: StatusTarget): OrderTransition[] {
  const status = asOrderStatus(order.status);

  if (status === "ready") {
    if (order.type === "delivery") return [transitionFor("delivering", "Передать курьеру")];
    return [transitionFor("completed", "Выдать гостю")];
  }

  if (status === "delivering") return [transitionFor("completed", "Доставлен")];

  return ORDER_FLOW[status].next.map((next) => transitionFor(next));
}

function statusPathForOrder(order: Pick<StatusTarget, "status" | "type">): OrderStatus[] {
  const status = asOrderStatus(order.status);
  if (order.type === "delivery" || status === "delivering") return STATUS_PIPELINE;
  return STATUS_PIPELINE.filter((step) => step !== "delivering");
}

function statusIndexForOrder(order: Pick<StatusTarget, "status" | "type">): number {
  const status = asOrderStatus(order.status);
  if (status === "paid") return 0;
  const index = statusPathForOrder(order).findIndex((step) => step === status);
  return index >= 0 ? index : 0;
}

function displayStatusForStep(order: Pick<StatusTarget, "status">, step: OrderStatus): OrderStatus {
  const status = asOrderStatus(order.status);
  return step === "created" && status === "paid" ? "paid" : step;
}

function boardColumnForStatus(status: OrderStatus) {
  return BOARD_COLUMNS.find((column) => column.statuses.includes(status)) ?? null;
}

function boardColumnFromId(id: string): (typeof BOARD_COLUMNS)[number] | null {
  return BOARD_COLUMNS.find((column) => column.id === id) ?? null;
}

function isTransitionAllowed(order: StatusTarget, targetStatus: OrderStatus): boolean {
  const currentStatus = asOrderStatus(order.status);
  if (CLOSED_STATUSES.has(currentStatus)) return false;
  if (targetStatus === currentStatus) return true;
  if (targetStatus === "cancelled") return true;

  const targetColumn = boardColumnForStatus(targetStatus);
  if (targetColumn?.statuses.includes(currentStatus)) return true;

  return nextTransitions(order).some((transition) => transition.status === targetStatus);
}

function readView(): OrdersView {
  return new URLSearchParams(window.location.search).get("view") === "table" ? "table" : "board";
}

function useOrdersView() {
  const [view, setViewState] = useState<OrdersView>(readView);

  useEffect(() => {
    const onPopState = () => setViewState(readView());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const setView = (next: OrdersView) => {
    setViewState(next);
    const url = new URL(window.location.href);
    if (next === "board") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
  };

  return [view, setView] as const;
}

function useTableDensity() {
  const [density, setDensity] = useState<TableDensity>(() =>
    localStorage.getItem(DENSITY_KEY) === "regular" ? "regular" : "compact",
  );

  useEffect(() => {
    localStorage.setItem(DENSITY_KEY, density);
  }, [density]);

  return [density, setDensity] as const;
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function exportOrders(orders: OrderListRow[]) {
  const header = [
    "Номер",
    "Дата",
    "Гость",
    "Телефон",
    "Ресторан",
    "Тип",
    "Адрес",
    "Позиций",
    "Сумма",
    "Статус",
  ];
  const rows = orders.map((order) => [
    order.number,
    formatDateTime(order.created_at),
    order.guest_name ?? "",
    order.guest_phone,
    order.restaurant_name,
    orderTypeLabel(order.type),
    order.address_text ?? "",
    `${order.positions}`,
    formatPrice(order.total_kopecks),
    statusLabel(order.status),
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function OrdersSkeleton() {
  return (
    <div className="page-stack">
      <div className="metric-strip">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="skeleton skeleton-metric" />
        ))}
      </div>
      <div className="orders-board">
        {BOARD_COLUMNS.map((column) => (
          <div key={column.id} className="board-column">
            <div className="skeleton skeleton-row" />
            <div className="skeleton skeleton-card" />
            <div className="skeleton skeleton-card" />
          </div>
        ))}
      </div>
    </div>
  );
}

function OrderStatusBadge({ className, status }: { className?: string; status: string }) {
  const meta = STATUS_META[asOrderStatus(status)];
  const Icon = meta.icon;

  return (
    <span className={cn("order-status-badge", className)} data-tone={meta.tone}>
      <Icon size={13} aria-hidden />
      {meta.label}
    </span>
  );
}

function OrderProgress({ compact = false, order }: { compact?: boolean; order: Pick<StatusTarget, "status" | "type"> }) {
  const status = asOrderStatus(order.status);

  if (status === "cancelled") {
    const Icon = STATUS_META.cancelled.icon;
    return (
      <div className={cn("order-progress", compact && "order-progress-compact")} data-cancelled="true">
        <span className="order-progress-step" data-state="current" data-tone="bad">
          <span className="order-progress-dot">
            <Icon size={compact ? 11 : 13} aria-hidden />
          </span>
          <span className="order-progress-label">Отменён</span>
        </span>
      </div>
    );
  }

  const currentIndex = statusIndexForOrder(order);

  return (
    <div className={cn("order-progress", compact && "order-progress-compact")} aria-label="Этапы заказа">
      {statusPathForOrder(order).map((step, index) => {
        const displayedStatus = displayStatusForStep(order, step);
        const meta = STATUS_META[displayedStatus];
        const Icon = meta.icon;
        const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "next";

        return (
          <span key={step} className="order-progress-step" data-state={state} data-tone={meta.tone}>
            <span className="order-progress-dot">
              <Icon size={compact ? 10 : 13} aria-hidden />
            </span>
            <span className="order-progress-label">{meta.shortLabel}</span>
          </span>
        );
      })}
    </div>
  );
}

function OrderQuickAction({
  busy = false,
  order,
  onSetStatus,
}: {
  busy?: boolean;
  order: OrderListRow;
  onSetStatus?: (order: StatusTarget, status: OrderStatus) => void;
}) {
  if (!onSetStatus) return null;

  const [action] = nextTransitions(order);
  if (!action) {
    const closed = asOrderStatus(order.status) === "cancelled" ? "Заказ отменён" : "Заказ закрыт";
    return <span className="order-card-closed">{closed}</span>;
  }

  const Icon = action.icon;

  return (
    <Button
      className="order-card-action"
      data-tone={action.tone}
      disabled={busy}
      size="xs"
      variant={action.status === "completed" ? "ghost" : "primary"}
      onClick={(event) => {
        event.stopPropagation();
        onSetStatus(order, action.status);
      }}
    >
      <Icon size={14} aria-hidden />
      <span>{action.label}</span>
      <ArrowRight size={13} aria-hidden />
    </Button>
  );
}

function DraggableOrderCard({
  busy,
  order,
  selected,
  onSelect,
  onSetStatus,
}: {
  busy: boolean;
  order: OrderListRow;
  selected: boolean;
  onSelect: () => void;
  onSetStatus: (order: StatusTarget, status: OrderStatus) => void;
}) {
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    id: order.id,
  });

  return (
    <article
      ref={setNodeRef}
      className="order-card"
      data-dragging={isDragging}
      data-selected={selected}
      onClick={onSelect}
    >
      <button
        className="order-card-drag"
        title="Перетащить заказ"
        type="button"
        onClick={(event) => event.stopPropagation()}
        {...listeners}
        {...attributes}
      >
        <GripVertical size={15} aria-hidden />
      </button>
      <OrderCardContent busy={busy} order={order} onSetStatus={onSetStatus} />
    </article>
  );
}

function OrderCardContent({
  busy = false,
  order,
  onSetStatus,
}: {
  busy?: boolean;
  order: OrderListRow;
  onSetStatus?: (order: StatusTarget, status: OrderStatus) => void;
}) {
  const age = minutesSince(order.created_at);

  return (
    <>
      <div className="order-card-top">
        <div className="order-card-title">
          <span className="order-number">№ {order.number}</span>
          <OrderStatusBadge status={order.status} />
        </div>
      </div>

      <div className="order-card-meta">
        {order.type === "delivery" ? <Bike size={14} aria-hidden /> : <Store size={14} aria-hidden />}
        <span>{orderTypeLabel(order.type)}</span>
        <span>·</span>
        <span>{formatTime(order.created_at)}</span>
      </div>

      {/* Состав в списке не тянем: на доске важнее кто и сколько позиций */}
      <div className="order-card-items">
        <span>{order.guest_name ?? order.guest_phone}</span>
        <span>{order.positions} поз.</span>
        {order.items_changed ? <span>состав правил ресторан</span> : null}
      </div>

      <div className="order-card-foot">
        <Clock3 size={14} aria-hidden />
        <span>{minutesLabel(age)}</span>
        <span className="toolbar-spacer" />
        <strong className="mono">{formatPrice(order.total_kopecks)}</strong>
      </div>

      <OrderQuickAction busy={busy} order={order} onSetStatus={onSetStatus} />
    </>
  );
}

function BoardColumn({
  activeId,
  activeOrder,
  column,
  busy,
  orders,
  selectedId,
  total,
  onSelect,
  onSetStatus,
}: {
  activeId: string | null;
  activeOrder: OrderListRow | null;
  column: (typeof BOARD_COLUMNS)[number];
  busy: boolean;
  orders: OrderListRow[];
  selectedId: string | null;
  total: number;
  onSelect: (order: OrderListRow) => void;
  onSetStatus: (order: StatusTarget, status: OrderStatus) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: column.id });
  const Icon = STATUS_META[column.id].icon;
  const canDrop = !activeOrder || isTransitionAllowed(activeOrder, column.id);
  const currentColumn = activeOrder ? column.statuses.includes(asOrderStatus(activeOrder.status)) : false;
  const statusNames = column.statuses.map((status) => STATUS_META[status].label).join(" / ");

  return (
    <section className="board-column" data-can-drop={canDrop} data-tone={column.tone}>
      <div className="board-column-head" data-over={isOver} data-can-drop={canDrop}>
        <div className="board-column-title">
          <span className={cn("board-column-icon", `status-stripe-${column.tone}`)}>
            <Icon size={15} aria-hidden />
          </span>
          <span className="board-column-copy">
            <h3>{column.label}</h3>
            <small>{statusNames}</small>
          </span>
          <span className="board-count">{Math.max(total, orders.length)}</span>
        </div>
        {activeOrder ? (
          <div className="board-column-drop-hint">
            {canDrop ? (currentColumn ? "Текущий этап" : "Можно перенести") : "Недоступный переход"}
          </div>
        ) : null}
      </div>

      <div
        ref={setNodeRef}
        className="board-lane"
        data-can-drop={canDrop}
        data-over={isOver}
      >
        {orders.length === 0 ? <div className="board-empty">Пока пусто</div> : null}
        {orders.map((order) => (
          <DraggableOrderCard
            key={order.id}
            busy={busy}
            order={order}
            selected={selectedId === order.id || activeId === order.id}
            onSelect={() => onSelect(order)}
            onSetStatus={onSetStatus}
          />
        ))}
        {total > orders.length ? (
          <div className="board-more">
            Ещё {total - orders.length} — смотрите в таблице
          </div>
        ) : null}
      </div>
    </section>
  );
}

function OrdersBoard({
  activeId,
  busy,
  counts,
  orders,
  selectedId,
  onDragEnd,
  onDragStart,
  onSelect,
  onSetStatus,
}: {
  activeId: string | null;
  busy: boolean;
  counts: Record<string, number> | undefined;
  orders: OrderListRow[];
  selectedId: string | null;
  onDragEnd: (event: DragEndEvent) => void;
  onDragStart: (event: DragStartEvent) => void;
  onSelect: (order: OrderListRow) => void;
  onSetStatus: (order: StatusTarget, status: OrderStatus) => void;
}) {
  const byColumn = useMemo(
    () =>
      BOARD_COLUMNS.map((column) => ({
        column,
        orders: orders.filter((order) => column.statuses.includes(asOrderStatus(order.status))),
      })),
    [orders],
  );
  const activeOrder = orders.find((order) => order.id === activeId) ?? null;
  const board = useFillHeight<HTMLDivElement>();

  return (
    <DndContext collisionDetection={closestCorners} onDragEnd={onDragEnd} onDragStart={onDragStart}>
      <div ref={board} className="orders-board">
        {byColumn.map(({ column, orders: columnOrders }) => (
          <BoardColumn
            key={column.id}
            activeId={activeId}
            activeOrder={activeOrder}
            busy={busy}
            column={column}
            orders={columnOrders}
            total={column.statuses.reduce((sum, status) => sum + (counts?.[status] ?? 0), 0)}
            selectedId={selectedId}
            onSelect={onSelect}
            onSetStatus={onSetStatus}
          />
        ))}
      </div>
      <DragOverlay>
        {activeOrder ? (
          <div className="order-card order-overlay">
            <OrderCardContent order={activeOrder} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function OrdersTable({
  density,
  orders,
  selectedId,
  onSelect,
  onSetStatus,
}: {
  density: TableDensity;
  orders: OrderListRow[];
  selectedId: string | null;
  onSelect: (order: OrderListRow) => void;
  onSetStatus: (order: StatusTarget, status: OrderStatus) => void;
}) {
  return (
    <div className="table-shell" data-density={density}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Номер</th>
            <th>Когда</th>
            <th>Гость</th>
            <th>Ресторан</th>
            <th>Получение</th>
            <th>Состав</th>
            <th>Сумма</th>
            <th>Статус</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const [primaryAction] = nextTransitions(order);
            const PrimaryActionIcon = primaryAction?.icon;
            const closed = CLOSED_STATUSES.has(asOrderStatus(order.status));

            return (
              <tr key={order.id} data-selected={selectedId === order.id} onClick={() => onSelect(order)}>
                <td>
                  <span className="mono">№ {order.number}</span>
                </td>
                <td>
                  <div className="row-main">{formatDateTime(order.created_at)}</div>
                  <div className="row-sub">
                    {/* У закрытого заказа важно, сколько он занял, а не сколько
                        прошло с тех пор */}
                    {closed
                      ? order.completed_at
                        ? `собран за ${minutesLabel(minutesBetween(order.created_at, order.completed_at))}`
                        : ""
                      : minutesLabel(minutesSince(order.created_at))}
                  </div>
                </td>
                <td>
                  <div className="row-main">{order.guest_name ?? "Без имени"}</div>
                  <div className="row-sub mono">{order.guest_phone}</div>
                </td>
                <td>{order.restaurant_name}</td>
                <td>
                  <div className="row-main">{orderTypeLabel(order.type)}</div>
                  <div className="row-sub">{order.address_text ?? "в ресторане"}</div>
                </td>
                <td>
                  <div className="row-sub">
                    {order.positions} поз.
                    {order.items_changed ? " · состав правил ресторан" : ""}
                  </div>
                </td>
                <td className="numeric">{formatPrice(order.total_kopecks)}</td>
                <td>
                  <div className="order-table-status">
                    <OrderStatusBadge status={order.status} />
                    {closed ? (
                      order.cancel_reason ? (
                        <span className="row-sub">{order.cancel_reason}</span>
                      ) : null
                    ) : (
                      <OrderProgress compact order={order} />
                    )}
                  </div>
                </td>
                <td>
                  <div className="cell-actions">
                    {primaryAction ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSetStatus(order, primaryAction.status);
                        }}
                      >
                        {PrimaryActionIcon ? <PrimaryActionIcon size={14} aria-hidden /> : null}
                        {primaryAction.label}
                      </Button>
                    ) : null}
                    <IconButton
                      label="Другие действия"
                      size="xs"
                      variant="quiet"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(order);
                      }}
                    >
                      <MoreHorizontal size={14} aria-hidden />
                    </IconButton>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OrderWorkflowPanel({
  busy,
  order,
  onSetStatus,
}: {
  busy: boolean;
  order: StatusTarget;
  onSetStatus: (order: StatusTarget, status: OrderStatus) => void;
}) {
  const status = asOrderStatus(order.status);
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const actions = nextTransitions(order);
  const closed = CLOSED_STATUSES.has(status);

  return (
    <section className="order-workflow-panel" data-tone={meta.tone}>
      <div className="order-workflow-current">
        <span className="order-workflow-icon">
          <Icon size={20} aria-hidden />
        </span>
        <div className="min-w-0">
          <span className="metric-label">Текущий статус</span>
          <h3>{meta.label}</h3>
          <p>{meta.description}</p>
        </div>
      </div>

      <OrderProgress order={order} />

      {closed ? (
        <div className="order-workflow-final" data-tone={meta.tone}>
          <Icon size={15} aria-hidden />
          <span>{status === "cancelled" ? "Заказ отменён и остался в истории." : "Заказ выполнен и больше не требует действий."}</span>
        </div>
      ) : (
        <div className="order-workflow-actions">
          {actions.map((action) => {
            const ActionIcon = action.icon;
            return (
              <Button
                key={action.status}
                className="order-workflow-action"
                data-tone={action.tone}
                disabled={busy}
                size="sm"
                variant={action.status === "completed" ? "ghost" : "primary"}
                onClick={() => onSetStatus(order, action.status)}
              >
                <ActionIcon size={16} aria-hidden />
                <span>
                  <strong>{action.label}</strong>
                  <small>{action.description}</small>
                </span>
              </Button>
            );
          })}
          <Button
            className="order-workflow-cancel"
            disabled={busy}
            size="sm"
            variant="danger"
            onClick={() => onSetStatus(order, "cancelled")}
          >
            <XCircle size={16} aria-hidden />
            Отменить заказ
          </Button>
        </div>
      )}
    </section>
  );
}

/** Позиция в черновике правки: количество, которое оператор хочет сохранить. */
type DraftItem = {
  dish_id: string;
  name: string;
  unit_price_kopecks: number;
  quantity: number;
};

function draftFromOrder(order: OrderCard): DraftItem[] {
  return order.items
    .filter((item) => item.dish_id !== null)
    .map((item) => ({
      dish_id: item.dish_id as string,
      name: item.name,
      unit_price_kopecks: item.unit_price_kopecks,
      quantity: item.quantity,
    }));
}

function sameComposition(order: OrderCard, draft: DraftItem[]): boolean {
  const before = draftFromOrder(order);
  if (before.length !== draft.length) return false;
  const counts = new Map(draft.map((item) => [item.dish_id, item.quantity]));
  return before.every((item) => counts.get(item.dish_id) === item.quantity);
}

/**
 * Счёт по черновику — теми же правилами, что считает сервер.
 *
 * Нужен, чтобы оператор называл гостю сумму до сохранения, а не после. Итог
 * всё равно приходит с сервера: цены он берёт из базы, и разойтись они могут,
 * если прямо сейчас в другой вкладке правят меню.
 */
function previewTotals(order: OrderCard, draft: DraftItem[]) {
  const subtotal = draft.reduce((sum, item) => sum + item.unit_price_kopecks * item.quantity, 0);
  const promo = Math.min(order.promo_discount_kopecks, subtotal);
  const payable = Math.max(0, subtotal + order.delivery_kopecks + order.cutlery_kopecks - promo);

  const rate = tenant.loyalty.pointToRubleRate;
  const base = subtotal + (tenant.loyalty.pointsCoverDelivery ? order.delivery_kopecks : 0);
  const cap =
    rate > 0 ? Math.floor((base * tenant.loyalty.maxRedeemShareOfCheck) / 100 / rate) : 0;
  const spent = Math.min(order.points_spent, Math.max(0, cap));
  const discount = Math.round(spent * rate * 100);
  const total = Math.max(0, payable - discount);

  return {
    subtotal,
    promo,
    spent,
    discount,
    total,
    // Сколько баллов вернётся гостю, если списание пришлось урезать
    returned: order.points_spent - spent,
  };
}

function DishPicker({
  restaurantId,
  taken,
  onPick,
}: {
  restaurantId: string;
  taken: Set<string>;
  onPick: (dish: RestaurantDish) => void;
}) {
  const [query, setQuery] = useState("");

  const menu = useQuery({
    queryKey: ["restaurant-menu", restaurantId],
    queryFn: () => api.restaurantMenu(restaurantId),
    staleTime: 5 * 60_000,
  });

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = (menu.data ?? []).filter((dish) => !taken.has(dish.dish_id));
    if (!needle) return rows.slice(0, 12);
    return rows
      .filter(
        (dish) =>
          dish.name.toLowerCase().includes(needle) ||
          dish.category_name.toLowerCase().includes(needle),
      )
      .slice(0, 30);
  }, [menu.data, query, taken]);

  return (
    <div className="dish-picker">
      <span className="search-control">
        <Search className="search-icon" size={15} aria-hidden />
        <input
          autoFocus
          className="input"
          placeholder="Блюдо из меню ресторана"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </span>

      {menu.isPending ? (
        <p className="row-sub">Загружаем меню ресторана…</p>
      ) : found.length === 0 ? (
        <p className="row-sub">Ничего не нашлось — проверьте название.</p>
      ) : (
        <div className="dish-picker-list">
          {found.map((dish) => (
            <button
              key={dish.dish_id}
              className="dish-picker-row"
              disabled={dish.in_stop_list || !dish.is_available}
              type="button"
              onClick={() => onPick(dish)}
            >
              <span className="min-w-0">
                <span className="row-main">{dish.name}</span>
                <span className="row-sub">
                  {dish.category_name}
                  {dish.in_stop_list ? " · в стоп-листе" : ""}
                  {!dish.is_available && !dish.in_stop_list ? " · выключено" : ""}
                </span>
              </span>
              <strong className="mono">{formatPrice(dish.price_kopecks)}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderComposition({
  order,
  saving,
  onSave,
}: {
  order: OrderCard;
  saving: boolean;
  onSave: (items: { dish_id: string; quantity: number }[]) => void;
}) {
  const [draft, setDraft] = useState<DraftItem[]>(() => draftFromOrder(order));
  const [adding, setAdding] = useState(false);

  // Заказ поменялся (открыли другой или пришёл ответ сервера) — черновик заново
  useEffect(() => {
    setDraft(draftFromOrder(order));
    setAdding(false);
  }, [order]);

  // Позиция из кассы без блюда в нашем меню: сохранить её обратно нечем
  const orphan = order.items.some((item) => item.dish_id === null);
  const editable = order.editable && !orphan;
  const dirty = !sameComposition(order, draft);
  const preview = previewTotals(order, draft);

  const setQuantity = (dishId: string, quantity: number) => {
    setDraft((current) =>
      quantity <= 0
        ? current.filter((item) => item.dish_id !== dishId)
        : current.map((item) => (item.dish_id === dishId ? { ...item, quantity } : item)),
    );
  };

  const addDish = (dish: RestaurantDish) => {
    setDraft((current) => [
      ...current,
      {
        dish_id: dish.dish_id,
        name: dish.name,
        unit_price_kopecks: dish.price_kopecks,
        quantity: 1,
      },
    ]);
    setAdding(false);
  };

  const rows = editable ? draft : draftFromOrder(order);
  const removed = editable
    ? draftFromOrder(order).filter(
        (before) => !draft.some((item) => item.dish_id === before.dish_id),
      )
    : [];

  return (
    <section className="drawer-section">
      <div className="drawer-section-head">
        <h3 className="drawer-section-title">Состав</h3>
        <span className="row-sub">{rows.length} поз.</span>
      </div>

      <div className="item-list">
        {rows.map((item) => (
          <div key={item.dish_id} className="item-row">
            <div className="min-w-0">
              <div className="row-main">{item.name}</div>
              <div className="row-sub">{formatPrice(item.unit_price_kopecks)} за штуку</div>
            </div>

            {editable ? (
              <div className="stepper" aria-label={`Количество: ${item.name}`}>
                <button
                  disabled={saving}
                  type="button"
                  onClick={() => setQuantity(item.dish_id, item.quantity - 1)}
                >
                  <Minus size={14} aria-hidden />
                </button>
                <span className="mono">{item.quantity}</span>
                <button
                  disabled={saving || item.quantity >= 99}
                  type="button"
                  onClick={() => setQuantity(item.dish_id, item.quantity + 1)}
                >
                  <Plus size={14} aria-hidden />
                </button>
              </div>
            ) : (
              <span className="row-sub">× {item.quantity}</span>
            )}

            <strong className="mono">
              {formatPrice(item.unit_price_kopecks * item.quantity)}
            </strong>

            {editable ? (
              <IconButton
                disabled={saving}
                label={`Снять «${item.name}»`}
                size="sm"
                variant="quiet"
                onClick={() => setQuantity(item.dish_id, 0)}
              >
                <Trash2 size={15} aria-hidden />
              </IconButton>
            ) : null}
          </div>
        ))}

        {removed.map((item) => (
          <div key={item.dish_id} className="item-row" data-removed="true">
            <div className="min-w-0">
              <div className="row-main">{item.name}</div>
              <div className="row-sub">Снимаем из заказа</div>
            </div>
            <span className="row-sub">× {item.quantity}</span>
            <strong className="mono">−{formatPrice(item.unit_price_kopecks * item.quantity)}</strong>
            <IconButton
              disabled={saving}
              label={`Вернуть «${item.name}»`}
              size="sm"
              variant="quiet"
              onClick={() =>
                setDraft((current) => [...current, { ...item, quantity: item.quantity }])
              }
            >
              <RefreshCw size={15} aria-hidden />
            </IconButton>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="row-sub">
          В заказе не осталось блюд. Верните позицию или отмените заказ целиком.
        </p>
      ) : null}

      {!editable ? (
        <p className="row-sub">
          {orphan
            ? "В заказе есть позиция без блюда из меню — правьте её на кассе."
            : "Заказ закрыт: состав уже не меняется."}
        </p>
      ) : adding ? (
        <DishPicker
          restaurantId={order.restaurant_id}
          taken={new Set(draft.map((item) => item.dish_id))}
          onPick={addDish}
        />
      ) : (
        <Button disabled={saving} size="sm" variant="ghost" onClick={() => setAdding(true)}>
          <Plus size={15} aria-hidden />
          Добавить блюдо
        </Button>
      )}

      {editable && dirty ? (
        <div className="composition-bar">
          <div className="composition-sum">
            <span className="metric-label">Станет к оплате</span>
            <strong className="mono">{formatPrice(preview.total)}</strong>
            <span className="row-sub">
              было {formatPrice(order.total_kopecks)}
              {preview.returned > 0 ? ` · вернём ${preview.returned} б.` : ""}
            </span>
          </div>
          <span className="toolbar-spacer" />
          <Button
            disabled={saving}
            size="sm"
            variant="ghost"
            onClick={() => setDraft(draftFromOrder(order))}
          >
            Вернуть как было
          </Button>
          <Button
            disabled={saving || draft.length === 0}
            size="sm"
            onClick={() =>
              onSave(
                draft.map((item) => ({ dish_id: item.dish_id, quantity: item.quantity })),
              )
            }
          >
            Сохранить состав
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function OrderDrawer({
  busy,
  order,
  saving,
  onClose,
  onSaveItems,
  onSetStatus,
}: {
  busy: boolean;
  order: OrderCard;
  saving: boolean;
  onClose: () => void;
  onSaveItems: (items: { dish_id: string; quantity: number }[]) => void;
  onSetStatus: (order: StatusTarget, status: OrderStatus) => void;
}) {
  const status = asOrderStatus(order.status);
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const closed = CLOSED_STATUSES.has(status);
  // Звоним по контактному телефону заказа: гость мог оставить чужой
  const phone = order.contact_phone || (order.guest_phone.startsWith("+") ? order.guest_phone : "");

  return (
    <>
      <div className="drawer-overlay order-drawer-scrim" onClick={onClose} />
      <aside className="order-drawer" aria-label={`Заказ № ${order.number}`}>
        <div className="drawer-head">
          <div className="order-drawer-title-block">
            <span className="order-drawer-status-icon" data-tone={meta.tone}>
              <Icon size={18} aria-hidden />
            </span>
            <div className="min-w-0">
              <span className="metric-label">
                {orderTypeLabel(order.type)} · {order.restaurant_name}
              </span>
              <h2 className="drawer-title">№ {order.number}</h2>
              <OrderStatusBadge status={order.status} />
            </div>
          </div>
          <span className="toolbar-spacer" />
          <IconButton label="Закрыть заказ" size="sm" variant="quiet" onClick={onClose}>
            <X size={16} aria-hidden />
          </IconButton>
        </div>

        <div className="drawer-body">
          <OrderWorkflowPanel busy={busy} order={order} onSetStatus={onSetStatus} />

          {order.cancel_reason ? (
            <div className="alert-band">
              <XCircle size={16} aria-hidden />
              <span>{order.cancel_reason}</span>
            </div>
          ) : null}

          {order.iiko_items_changed_at ? (
            <div className="alert-band" data-tone="warn">
              <AlertTriangle size={16} aria-hidden />
              <span>
                Состав правили на кассе {formatDateTime(order.iiko_items_changed_at)} — счёт
                пересчитан
              </span>
            </div>
          ) : null}

          <section className="drawer-section">
            <div className="guest-card">
              <div className="min-w-0">
                <span className="metric-label">Гость</span>
                <div className="row-main">{order.guest_name ?? "Без имени"}</div>
                <div className="row-sub">
                  {order.guest_points_balance} б. на счету · заказов: {order.guest_orders_count}
                </div>
              </div>
              {phone ? (
                <a className="phone-link" href={`tel:${phone}`}>
                  <Phone size={15} aria-hidden />
                  {phone}
                </a>
              ) : (
                <span className="row-sub">Телефон не указан</span>
              )}
            </div>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Куда и когда</h3>
            <div className="detail-list">
              <div className="detail-row">
                <span className="detail-label">
                  {order.type === "delivery" ? "Адрес" : "Самовывоз"}
                </span>
                <span>{order.address_text ?? order.restaurant_name}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Создан</span>
                <span>
                  {formatDateTime(order.created_at)}
                  {closed ? "" : ` · ${minutesLabel(minutesSince(order.created_at))} в работе`}
                </span>
              </div>
              {order.delivery_at ? (
                <div className="detail-row">
                  <span className="detail-label">К сроку</span>
                  <span>{formatDateTime(order.delivery_at)}</span>
                </div>
              ) : null}
              {order.completed_at ? (
                <div className="detail-row">
                  <span className="detail-label">Завершён</span>
                  <span>{formatDateTime(order.completed_at)}</span>
                </div>
              ) : null}
              {order.iiko_courier_name ? (
                <div className="detail-row">
                  <span className="detail-label">Курьер</span>
                  <span>{order.iiko_courier_name}</span>
                </div>
              ) : null}
              {order.comment ? (
                <div className="detail-row">
                  <span className="detail-label">Комментарий</span>
                  <span>{order.comment}</span>
                </div>
              ) : null}
              {order.persons_count ? (
                <div className="detail-row">
                  <span className="detail-label">Приборы</span>
                  <span>{order.persons_count} комплекта</span>
                </div>
              ) : null}
            </div>
          </section>

          <OrderComposition order={order} saving={saving} onSave={onSaveItems} />

          <section className="drawer-section">
            <h3 className="drawer-section-title">Счёт</h3>
            <div className="bill-list">
              <div className="bill-row">
                <span>Блюда</span>
                <strong className="mono">{formatPrice(order.subtotal_kopecks)}</strong>
              </div>
              {order.delivery_kopecks > 0 ? (
                <div className="bill-row">
                  <span>Доставка</span>
                  <strong className="mono">{formatPrice(order.delivery_kopecks)}</strong>
                </div>
              ) : null}
              {order.cutlery_kopecks > 0 ? (
                <div className="bill-row">
                  <span>Приборы</span>
                  <strong className="mono">{formatPrice(order.cutlery_kopecks)}</strong>
                </div>
              ) : null}
              {order.promo_discount_kopecks > 0 ? (
                <div className="bill-row" data-tone="ok">
                  <span>Промокод {order.promo_code ?? ""}</span>
                  <strong className="mono">−{formatPrice(order.promo_discount_kopecks)}</strong>
                </div>
              ) : null}
              {order.points_spent > 0 ? (
                <div className="bill-row" data-tone="ok">
                  <span>Списано {order.points_spent} б.</span>
                  <strong className="mono">−{formatPrice(order.discount_kopecks)}</strong>
                </div>
              ) : null}
              <div className="bill-row bill-total">
                <span>К оплате · {paymentLabel(order.payment_method)}</span>
                <strong className="mono">{formatPrice(order.total_kopecks)}</strong>
              </div>
              {order.change_from_kopecks ? (
                <div className="bill-row">
                  <span>Сдача с</span>
                  <strong className="mono">{formatPrice(order.change_from_kopecks)}</strong>
                </div>
              ) : null}
              {order.points_earned > 0 ? (
                <div className="bill-row">
                  <span>Начислим баллов</span>
                  <strong className="mono">{order.points_earned}</strong>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}

export function OrdersPage() {
  const queryClient = useQueryClient();
  const [chosenView, setView] = useOrdersView();
  const [density, setDensity] = useTableDensity();
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [period, setPeriod] = useState<OrderPeriod>("all");
  const [customFrom, setCustomFrom] = useState(isoDay(-7));
  const [customTo, setCustomTo] = useState(isoDay());
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<OrderGroup>("active");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Поиск уходит на сервер, поэтому ждём паузу в наборе, а не дёргаем по букве
  const search = useDebounced(query, 350);

  // Доска — про работу смены. В завершённых и отменённых двигать нечего
  const view = group === "active" ? chosenView : "table";

  const range = periodRange(period, customFrom, customTo);
  // Пусто из-за фильтров или потому, что заказов такого рода ещё не было
  const narrowed = Boolean(query) || filter !== "all" || period !== "all";

  // Условия отбора поменялись — страница снова первая, иначе список пустой
  useEffect(() => {
    setPage(0);
  }, [group, filter, search, range.from, range.to]);

  const pageSize = view === "board" ? BOARD_LIMIT : PAGE_SIZE;

  const params = {
    group,
    type: filter === "all" ? ("" as const) : filter,
    search,
    dateFrom: range.from,
    dateTo: range.to,
    limit: pageSize,
    offset: page * pageSize,
  };

  const orders = useQuery({
    queryKey: ["orders", params],
    queryFn: () => api.orders(params),
    refetchInterval: group === "active" ? 15_000 : false,
    placeholderData: (previous) => previous,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: SetOrderStatusInput) => api.setOrderStatus(id, status),
    // Кнопка должна срабатывать мгновенно: правим все страницы списка, что
    // сейчас в памяти, а сервер потом скажет, как есть на самом деле
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["orders"] });
      const previous = queryClient.getQueriesData<OrderPage>({ queryKey: ["orders"] });

      queryClient.setQueriesData<OrderPage>({ queryKey: ["orders"] }, (page) =>
        page
          ? {
              ...page,
              rows: page.rows.map((row) => (row.id === id ? { ...row, status } : row)),
            }
          : page,
      );

      return { previous };
    },
    onError: (error, variables, context) => {
      for (const [key, page] of context?.previous ?? []) queryClient.setQueryData(key, page);
      toast.error(error instanceof Error ? error.message : `Не удалось обновить заказ № ${variables.number}`);
    },
    onSuccess: (card, variables) => {
      queryClient.setQueryData(["order", card.id], card);
      toast.success(`Заказ № ${variables.number}: ${statusLabel(variables.status)}`);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const saveItems = useMutation({
    mutationFn: (items: { dish_id: string; quantity: number }[]) =>
      api.saveOrderItems(selectedId ?? "", items),
    onSuccess: (card) => {
      queryClient.setQueryData(["order", card.id], card);
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success(`Состав заказа № ${card.number} сохранён · ${formatPrice(card.total_kopecks)}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить состав");
    },
  });

  useEffect(() => {
    const focusedOrder = sessionStorage.getItem("mr.admin.focus-order");
    if (!focusedOrder) return;
    sessionStorage.removeItem("mr.admin.focus-order");
    setSelectedId(focusedOrder);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const allOrders = orders.data?.rows ?? [];
  const counts = orders.data?.counts;
  const total = orders.data?.total ?? 0;
  const filteredOrders = allOrders;

  const boardOrders = filteredOrders.filter(
    (order) => !CLOSED_STATUSES.has(asOrderStatus(order.status)),
  );

  // Карточку тянем отдельно: в списке состава нет, а он нужен для правки
  const card = useQuery({
    queryKey: ["order", selectedId],
    queryFn: () => api.orderCard(selectedId ?? ""),
    enabled: selectedId !== null,
  });

  const selectedOrder = card.data ?? null;

  // Считает сервер по всей выборке: на экране полсотни строк, а ресторанов
  // двадцать пять, и «готовых» среди них может не оказаться ни одного
  const metrics = {
    active: counts?.active ?? 0,
    cooking: counts?.cooking ?? 0,
    ready: counts?.ready ?? 0,
    delivering: counts?.delivering ?? 0,
  };

  const setOrderStatus = (order: StatusTarget, status: OrderStatus) => {
    const currentStatus = asOrderStatus(order.status);
    if (currentStatus === status) return;

    if (!isTransitionAllowed(order, status)) {
      toast.error(`Нельзя сразу перевести из «${statusLabel(currentStatus)}» в «${statusLabel(status)}»`);
      return;
    }

    setStatus.mutate({ id: order.id, number: order.number, status });
  };

  const [exporting, setExporting] = useState(false);

  /**
   * Выгрузка берёт весь текущий отбор, а не открытую страницу: оператор
   * фильтрует и жмёт «Экспорт», ожидая получить именно то, что отфильтровал.
   * Больше двухсот строк за раз сервер не отдаёт, поэтому идём порциями.
   */
  const runExport = async () => {
    setExporting(true);
    try {
      const chunk = 200;
      const rows: OrderListRow[] = [];
      for (let offset = 0; offset < total && offset < 5_000; offset += chunk) {
        const page = await api.orders({ ...params, limit: chunk, offset });
        rows.push(...page.rows);
        if (page.rows.length < chunk) break;
      }
      exportOrders(rows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось выгрузить заказы");
    } finally {
      setExporting(false);
    }
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const orderId = String(event.active.id);
    const targetColumn = event.over?.id ? boardColumnFromId(String(event.over.id)) : null;
    const order = allOrders.find((item) => item.id === orderId);
    if (!order || !targetColumn) return;

    const currentStatus = asOrderStatus(order.status);
    if (targetColumn.statuses.includes(currentStatus)) return;

    const targetStatus = targetColumn.id;
    if (!isTransitionAllowed(order, targetStatus)) {
      toast.error(`Сначала переведите заказ в следующий этап: «${nextTransitions(order)[0]?.label ?? "нет доступного действия"}»`);
      return;
    }

    setOrderStatus(order, targetStatus);
  };

  if (orders.isPending) return <OrdersSkeleton />;

  if (orders.isError) {
    return (
      <div className="error-state">
        <h2>Заказы не загрузились</h2>
        <p>{orders.error instanceof Error ? orders.error.message : "Проверьте соединение и повторите запрос."}</p>
        <Button variant="ghost" onClick={() => void orders.refetch()}>
          <RefreshCw size={15} aria-hidden />
          Повторить
        </Button>
      </div>
    );
  }

  return (
    <div className="orders-layout" data-drawer-open={Boolean(selectedOrder)}>
      <div className="page-stack">
        <div className="metric-strip">
          <div className="metric-card">
            <div className="metric-label">Активные</div>
            <div className="metric-value">{metrics.active}</div>
            <div className="metric-note">в работе сейчас</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Ждут действия</div>
            <div className="metric-value">{metrics.ready}</div>
            <div className="metric-note">готовы к выдаче</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Курьер</div>
            <div className="metric-value">{metrics.delivering}</div>
            <div className="metric-note">заказы в пути</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">На кухне</div>
            <div className="metric-value">{metrics.cooking}</div>
            <div className="metric-note">готовятся сейчас</div>
          </div>
        </div>

        {metrics.ready > 0 ? (
          <div className="alert-band">
            <AlertTriangle size={16} aria-hidden />
            <strong>{metrics.ready}</strong>
            <span>готовых заказов ждут выдачи или курьера</span>
          </div>
        ) : null}

        <div className="tabs orders-groups" aria-label="Состояние заказов">
          {GROUP_TABS.map((groupTab) => (
            <button
              key={groupTab.key}
              className="tab-button"
              data-active={group === groupTab.key}
              type="button"
              onClick={() => setGroup(groupTab.key)}
            >
              {groupTab.label}
              <span className="tab-counter">{counts?.[groupTab.key] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="orders-toolbar">
          <div className="toolbar-filters">
          {group === "active" ? (
            <div className="tabs" aria-label="Вид заказов">
              <button className="tab-button" data-active={view === "board"} type="button" onClick={() => setView("board")}>
                <Columns3 size={14} aria-hidden />
                Доска
              </button>
              <button className="tab-button" data-active={view === "table"} type="button" onClick={() => setView("table")}>
                <Table2 size={14} aria-hidden />
                Таблица
              </button>
            </div>
          ) : null}

          <div className="filter-chips" aria-label="Тип заказа">
            {[
              ["all", "Все"],
              ["delivery", "Доставка"],
              ["pickup", "Самовывоз"],
            ].map(([key, label]) => (
              <button
                key={key}
                className="filter-chip"
                data-active={filter === key}
                type="button"
                onClick={() => setFilter(key as OrderFilter)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="toolbar-dates">
            <span className="select-control">
              <CalendarDays className="select-icon" size={15} aria-hidden />
              <select
                className="input"
                aria-label="Период"
                value={period}
                onChange={(event) => setPeriod(event.target.value as OrderPeriod)}
              >
                {PERIOD_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </span>

            {period === "custom" ? (
              <>
                <input
                  className="input date-input"
                  aria-label="С какой даты"
                  lang="ru-RU"
                  max={customTo}
                  type="date"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
                <span className="toolbar-note">—</span>
                <input
                  className="input date-input"
                  aria-label="По какую дату"
                  lang="ru-RU"
                  min={customFrom}
                  type="date"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
              </>
            ) : null}
          </div>

          </div>

          <div className="toolbar-actions">
          <span className="search-control toolbar-search">
            <Search className="search-icon" size={15} aria-hidden />
            <input
              className="input"
              placeholder="Номер, телефон, имя, адрес"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>

          {view === "table" ? (
            <div className="density-toggle" aria-label="Плотность таблицы">
              <button data-active={density === "compact"} type="button" onClick={() => setDensity("compact")}>
                Компактно
              </button>
              <button data-active={density === "regular"} type="button" onClick={() => setDensity("regular")}>
                Обычно
              </button>
            </div>
          ) : null}

          <IconButton
            label="Обновить список"
            size="sm"
            variant="quiet"
            onClick={() => void orders.refetch()}
          >
            <RefreshCw size={15} aria-hidden />
          </IconButton>
          <Button size="sm" variant="ghost" disabled={exporting} onClick={runExport}>
            <Download size={15} aria-hidden />
            {exporting ? "Готовим…" : "Экспорт"}
          </Button>
          </div>
        </div>

        {filteredOrders.length === 0 ? (
          <div className="empty-state">
            <h2>{narrowed ? "По этим условиям ничего нет" : "Здесь пусто"}</h2>
            <p>
              {narrowed
                ? "Сбросьте поиск, период или тип — и вкладка снова покажет заказы."
                : "Заказы этой вкладки появятся здесь, как только они будут."}
            </p>
            {narrowed ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                  setPeriod("all");
                }}
              >
                Сбросить фильтры
              </Button>
            ) : null}
          </div>
        ) : view === "board" ? (
          <OrdersBoard
            activeId={activeId}
            busy={setStatus.isPending}
            counts={counts}
            orders={boardOrders}
            selectedId={selectedId}
            onDragEnd={onDragEnd}
            onDragStart={onDragStart}
            onSelect={(order) => setSelectedId(order.id)}
            onSetStatus={setOrderStatus}
          />
        ) : (
          <OrdersTable
            density={density}
            orders={filteredOrders}
            selectedId={selectedId}
            onSelect={(order) => setSelectedId(order.id)}
            onSetStatus={setOrderStatus}
          />
        )}

        {view === "table" && total > PAGE_SIZE ? (
          <div className="pager">
            <span className="row-sub">
              {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} из {total}
            </span>
            <span className="toolbar-spacer" />
            <Button
              disabled={page === 0 || orders.isFetching}
              size="sm"
              variant="ghost"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              <ChevronLeft size={15} aria-hidden />
              Назад
            </Button>
            <Button
              disabled={(page + 1) * PAGE_SIZE >= total || orders.isFetching}
              size="sm"
              variant="ghost"
              onClick={() => setPage((current) => current + 1)}
            >
              Дальше
              <ChevronRight size={15} aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>

      {selectedOrder ? (
        <OrderDrawer
          busy={setStatus.isPending}
          order={selectedOrder}
          saving={saveItems.isPending}
          onClose={() => setSelectedId(null)}
          onSaveItems={(items) => saveItems.mutate(items)}
          onSetStatus={setOrderStatus}
        />
      ) : null}
    </div>
  );
}
