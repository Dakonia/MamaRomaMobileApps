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
  CheckCircle2,
  ChefHat,
  CircleDot,
  ClipboardCheck,
  Clock3,
  Columns3,
  Download,
  GripVertical,
  MoreHorizontal,
  PackageCheck,
  RefreshCw,
  Search,
  Store,
  Table2,
  Truck,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { api, type Order } from "../../api";
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

function asOrderStatus(status: string): OrderStatus {
  return status in STATUS_META ? (status as OrderStatus) : "created";
}

function statusLabel(status: string): string {
  return STATUS_META[asOrderStatus(status)]?.label ?? status;
}

function orderTypeLabel(type: string): string {
  if (type === "delivery") return "Доставка";
  if (type === "pickup") return "Самовывоз";
  return type;
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

function nextTransitions(order: Order): OrderTransition[] {
  const status = asOrderStatus(order.status);

  if (status === "ready") {
    if (order.type === "delivery") return [transitionFor("delivering", "Передать курьеру")];
    return [transitionFor("completed", "Выдать гостю")];
  }

  if (status === "delivering") return [transitionFor("completed", "Доставлен")];

  return ORDER_FLOW[status].next.map((next) => transitionFor(next));
}

function statusPathForOrder(order: Pick<Order, "status" | "type">): OrderStatus[] {
  const status = asOrderStatus(order.status);
  if (order.type === "delivery" || status === "delivering") return STATUS_PIPELINE;
  return STATUS_PIPELINE.filter((step) => step !== "delivering");
}

function statusIndexForOrder(order: Pick<Order, "status" | "type">): number {
  const status = asOrderStatus(order.status);
  if (status === "paid") return 0;
  const index = statusPathForOrder(order).findIndex((step) => step === status);
  return index >= 0 ? index : 0;
}

function displayStatusForStep(order: Pick<Order, "status">, step: OrderStatus): OrderStatus {
  const status = asOrderStatus(order.status);
  return step === "created" && status === "paid" ? "paid" : step;
}

function boardColumnForStatus(status: OrderStatus) {
  return BOARD_COLUMNS.find((column) => column.statuses.includes(status)) ?? null;
}

function boardColumnFromId(id: string): (typeof BOARD_COLUMNS)[number] | null {
  return BOARD_COLUMNS.find((column) => column.id === id) ?? null;
}

function isTransitionAllowed(order: Order, targetStatus: OrderStatus): boolean {
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

function matchesOrder(order: Order, query: string): boolean {
  if (!query) return true;
  const normalized = query.toLocaleLowerCase("ru-RU");
  const haystack = [
    order.number,
    order.restaurant_name,
    order.address_text ?? "",
    order.type,
    ...order.items.map((item) => item.name),
  ]
    .join(" ")
    .toLocaleLowerCase("ru-RU");

  return haystack.includes(normalized);
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function exportOrders(orders: Order[]) {
  const header = ["Номер", "Дата", "Ресторан", "Тип", "Адрес", "Состав", "Сумма", "Статус"];
  const rows = orders.map((order) => [
    order.number,
    formatDateTime(order.created_at),
    order.restaurant_name,
    orderTypeLabel(order.type),
    order.address_text ?? "",
    order.items.map((item) => `${item.name} x ${item.quantity}`).join("; "),
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

function OrderProgress({ compact = false, order }: { compact?: boolean; order: Pick<Order, "status" | "type"> }) {
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
  order: Order;
  onSetStatus?: (order: Order, status: OrderStatus) => void;
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
  order: Order;
  selected: boolean;
  onSelect: () => void;
  onSetStatus: (order: Order, status: OrderStatus) => void;
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
  order: Order;
  onSetStatus?: (order: Order, status: OrderStatus) => void;
}) {
  const age = minutesSince(order.created_at);
  const previewItems = order.items.slice(0, 3);
  const hiddenItems = order.items.length - previewItems.length;

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

      <div className="order-card-items">
        {previewItems.map((item) => (
          <span key={item.id}>
            {item.name} × {item.quantity}
          </span>
        ))}
        {hiddenItems > 0 ? <span>Ещё {hiddenItems}</span> : null}
      </div>

      <OrderProgress compact order={order} />

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
  onSelect,
  onSetStatus,
}: {
  activeId: string | null;
  activeOrder: Order | null;
  column: (typeof BOARD_COLUMNS)[number];
  busy: boolean;
  orders: Order[];
  selectedId: string | null;
  onSelect: (order: Order) => void;
  onSetStatus: (order: Order, status: OrderStatus) => void;
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
          <span className="board-count">{orders.length}</span>
        </div>
        <div className="board-column-drop-hint">
          {activeOrder ? (canDrop ? (currentColumn ? "Текущий этап" : "Можно перенести") : "Недоступный переход") : "Перетащите сюда"}
        </div>
      </div>

      <div ref={setNodeRef} className="board-lane" data-can-drop={canDrop} data-over={isOver}>
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
      </div>
    </section>
  );
}

function OrdersBoard({
  activeId,
  busy,
  orders,
  selectedId,
  onDragEnd,
  onDragStart,
  onSelect,
  onSetStatus,
}: {
  activeId: string | null;
  busy: boolean;
  orders: Order[];
  selectedId: string | null;
  onDragEnd: (event: DragEndEvent) => void;
  onDragStart: (event: DragStartEvent) => void;
  onSelect: (order: Order) => void;
  onSetStatus: (order: Order, status: OrderStatus) => void;
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

  return (
    <DndContext collisionDetection={closestCorners} onDragEnd={onDragEnd} onDragStart={onDragStart}>
      <div className="orders-board">
        {byColumn.map(({ column, orders: columnOrders }) => (
          <BoardColumn
            key={column.id}
            activeId={activeId}
            activeOrder={activeOrder}
            busy={busy}
            column={column}
            orders={columnOrders}
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
  orders: Order[];
  selectedId: string | null;
  onSelect: (order: Order) => void;
  onSetStatus: (order: Order, status: OrderStatus) => void;
}) {
  return (
    <div className="table-shell" data-density={density}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Номер</th>
            <th>Когда</th>
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

            return (
              <tr key={order.id} data-selected={selectedId === order.id} onClick={() => onSelect(order)}>
                <td>
                  <span className="mono">№ {order.number}</span>
                </td>
                <td>
                  <div className="row-main">{formatDateTime(order.created_at)}</div>
                  <div className="row-sub">{minutesLabel(minutesSince(order.created_at))}</div>
                </td>
                <td>{order.restaurant_name}</td>
                <td>
                  <div className="row-main">{orderTypeLabel(order.type)}</div>
                  <div className="row-sub">{order.address_text ?? "в ресторане"}</div>
                </td>
                <td>
                  <div className="row-sub">{order.items.map((item) => `${item.name} × ${item.quantity}`).join(", ")}</div>
                </td>
                <td className="numeric">{formatPrice(order.total_kopecks)}</td>
                <td>
                  <div className="order-table-status">
                    <OrderStatusBadge status={order.status} />
                    <OrderProgress compact order={order} />
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
  order: Order;
  onSetStatus: (order: Order, status: OrderStatus) => void;
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

function OrderDrawer({
  busy,
  order,
  onClose,
  onSetStatus,
}: {
  busy: boolean;
  order: Order;
  onClose: () => void;
  onSetStatus: (order: Order, status: OrderStatus) => void;
}) {
  const status = asOrderStatus(order.status);
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="order-drawer" aria-label={`Заказ № ${order.number}`}>
        <div className="drawer-head">
          <div className="order-drawer-title-block">
            <span className="order-drawer-status-icon" data-tone={meta.tone}>
              <Icon size={18} aria-hidden />
            </span>
            <div className="min-w-0">
              <span className="metric-label">Заказ</span>
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

          <section className="drawer-section">
            <h3 className="drawer-section-title">Детали</h3>
            <div className="detail-list">
              <div className="detail-row">
                <span className="detail-label">Создан</span>
                <span>{formatDateTime(order.created_at)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">В работе</span>
                <span>{minutesLabel(minutesSince(order.created_at))}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Ресторан</span>
                <span>{order.restaurant_name}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Получение</span>
                <span>
                  {orderTypeLabel(order.type)}
                  {order.address_text ? ` · ${order.address_text}` : ""}
                </span>
              </div>
            </div>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Состав</h3>
            <div className="item-list">
              {order.items.map((item) => (
                <div key={item.id} className="item-row">
                  <div>
                    <div className="row-main">{item.name}</div>
                    <div className="row-sub">Количество: {item.quantity}</div>
                  </div>
                  <strong className="mono">{formatPrice(item.total_kopecks)}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Итого</h3>
            <div className="detail-row">
              <span className="detail-label">Сумма</span>
              <strong className="mono">{formatPrice(order.total_kopecks)}</strong>
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}

export function OrdersPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useOrdersView();
  const [density, setDensity] = useTableDensity();
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: api.orders,
    refetchInterval: 15_000,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: SetOrderStatusInput) => api.setOrderStatus(id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["orders"] });
      const previous = queryClient.getQueryData<Order[]>(["orders"]);
      queryClient.setQueryData<Order[]>(["orders"], (current) =>
        current?.map((order) => (order.id === id ? { ...order, status } : order)),
      );
      return { previous };
    },
    onError: (error, variables, context) => {
      if (context?.previous) queryClient.setQueryData(["orders"], context.previous);
      toast.error(error instanceof Error ? error.message : `Не удалось обновить заказ № ${variables.number}`);
    },
    onSuccess: (_order, variables) => {
      toast.success(`Заказ № ${variables.number}: ${statusLabel(variables.status)}`);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
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

  const allOrders = orders.data ?? [];
  const filteredOrders = useMemo(
    () =>
      allOrders.filter((order) => {
        const typeMatch = filter === "all" || order.type === filter;
        return typeMatch && matchesOrder(order, query);
      }),
    [allOrders, filter, query],
  );

  const boardOrders = filteredOrders.filter((order) => !CLOSED_STATUSES.has(asOrderStatus(order.status)));
  const selectedOrder = allOrders.find((order) => order.id === selectedId) ?? null;

  const metrics = useMemo(() => {
    const active = allOrders.filter((order) => !CLOSED_STATUSES.has(asOrderStatus(order.status)));
    const ready = active.filter((order) => order.status === "ready");
    const delivering = active.filter((order) => order.status === "delivering");
    const revenue = allOrders.reduce((sum, order) => sum + order.total_kopecks, 0);

    return {
      active: active.length,
      delivering: delivering.length,
      ready: ready.length,
      revenue,
    };
  }, [allOrders]);

  const setOrderStatus = (order: Order, status: OrderStatus) => {
    const currentStatus = asOrderStatus(order.status);
    if (currentStatus === status) return;

    if (!isTransitionAllowed(order, status)) {
      toast.error(`Нельзя сразу перевести из «${statusLabel(currentStatus)}» в «${statusLabel(status)}»`);
      return;
    }

    setStatus.mutate({ id: order.id, number: order.number, status });
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
            <div className="metric-label">Сумма</div>
            <div className="metric-value">{formatPrice(metrics.revenue)}</div>
            <div className="metric-note">по загруженному списку</div>
          </div>
        </div>

        {metrics.ready > 0 ? (
          <div className="alert-band">
            <AlertTriangle size={16} aria-hidden />
            <strong>{metrics.ready}</strong>
            <span>готовых заказов ждут выдачи или курьера</span>
          </div>
        ) : null}

        <div className="orders-toolbar">
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

          <div className="toolbar-spacer" />

          <label className="field toolbar-field">
            <span className="field-label">Поиск</span>
            <span className="search-control">
              <Search className="search-icon" size={15} aria-hidden />
              <input
                className="input"
                placeholder="Поиск заказа"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </span>
          </label>

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

          <Button size="sm" variant="ghost" onClick={() => void orders.refetch()}>
            <RefreshCw size={15} aria-hidden />
            Обновить
          </Button>
          <Button size="sm" variant="ghost" onClick={() => exportOrders(filteredOrders)}>
            <Download size={15} aria-hidden />
            Экспорт
          </Button>
        </div>

        {filteredOrders.length === 0 ? (
          <div className="empty-state">
            <h2>По этим условиям ничего нет</h2>
            <p>Сбросьте поиск или фильтр, чтобы увидеть активные заказы.</p>
            <Button
              variant="ghost"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Сбросить фильтры
            </Button>
          </div>
        ) : view === "board" ? (
          <OrdersBoard
            activeId={activeId}
            busy={setStatus.isPending}
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
      </div>

      {selectedOrder ? (
        <OrderDrawer
          busy={setStatus.isPending}
          order={selectedOrder}
          onClose={() => setSelectedId(null)}
          onSetStatus={setOrderStatus}
        />
      ) : null}
    </div>
  );
}
