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
  Bike,
  Check,
  Clock3,
  Download,
  MoreHorizontal,
  PackageCheck,
  RefreshCw,
  Search,
  Store,
  Table2,
  Columns3,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { api, type Order } from "../../api";
import { formatDateTime, formatPrice, formatTime } from "../../lib/format";
import { Badge, Button, IconButton, cn } from "../../ui";

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

const DENSITY_KEY = "mr.admin.table-density";

const ORDER_FLOW: Record<OrderStatus, { label: string; next: { status: OrderStatus; label: string }[] }> = {
  created: { label: "Оформлен", next: [{ status: "accepted", label: "Принять" }] },
  paid: { label: "Оплачен", next: [{ status: "accepted", label: "Принять" }] },
  accepted: { label: "Принят", next: [{ status: "cooking", label: "Готовим" }] },
  cooking: { label: "Готовится", next: [{ status: "ready", label: "Готов" }] },
  ready: {
    label: "Готов",
    next: [
      { status: "delivering", label: "Курьер забрал" },
      { status: "completed", label: "Выдан" },
    ],
  },
  delivering: { label: "В пути", next: [{ status: "completed", label: "Доставлен" }] },
  completed: { label: "Выполнен", next: [] },
  cancelled: { label: "Отменён", next: [] },
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
  return status in ORDER_FLOW ? (status as OrderStatus) : "created";
}

function statusLabel(status: string): string {
  return ORDER_FLOW[asOrderStatus(status)]?.label ?? status;
}

function statusTone(status: string): BadgeTone {
  const value = asOrderStatus(status);
  if (value === "completed") return "ok";
  if (value === "cancelled") return "bad";
  if (value === "accepted" || value === "ready") return "accent";
  if (value === "cooking" || value === "delivering") return "warn";
  return "muted";
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

function DraggableOrderCard({
  order,
  selected,
  onSelect,
}: {
  order: Order;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    id: order.id,
  });

  return (
    <button
      ref={setNodeRef}
      className="order-card"
      data-dragging={isDragging}
      data-selected={selected}
      type="button"
      onClick={onSelect}
      {...listeners}
      {...attributes}
    >
      <OrderCardContent order={order} />
    </button>
  );
}

function OrderCardContent({ order }: { order: Order }) {
  const age = minutesSince(order.created_at);
  const previewItems = order.items.slice(0, 3);
  const hiddenItems = order.items.length - previewItems.length;

  return (
    <>
      <div className="order-card-top">
        <span className="order-number">№ {order.number}</span>
        <Badge text={statusLabel(order.status)} tone={statusTone(order.status)} />
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

      <div className="order-card-foot">
        <Clock3 size={14} aria-hidden />
        <span>{minutesLabel(age)}</span>
        <span className="toolbar-spacer" />
        <strong className="mono">{formatPrice(order.total_kopecks)}</strong>
      </div>
    </>
  );
}

function BoardColumn({
  activeId,
  column,
  orders,
  selectedId,
  onSelect,
}: {
  activeId: string | null;
  column: (typeof BOARD_COLUMNS)[number];
  orders: Order[];
  selectedId: string | null;
  onSelect: (order: Order) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: column.id });

  return (
    <section className="board-column">
      <div className="board-column-head">
        <div className={cn("board-column-stripe", `status-stripe-${column.tone}`)} />
        <div className="board-column-title">
          <h3>{column.label}</h3>
          <span className="board-count">{orders.length}</span>
        </div>
      </div>

      <div ref={setNodeRef} className="board-lane" data-over={isOver}>
        {orders.length === 0 ? <div className="board-empty">Пока пусто</div> : null}
        {orders.map((order) => (
          <DraggableOrderCard
            key={order.id}
            order={order}
            selected={selectedId === order.id || activeId === order.id}
            onSelect={() => onSelect(order)}
          />
        ))}
      </div>
    </section>
  );
}

function OrdersBoard({
  activeId,
  orders,
  selectedId,
  onDragEnd,
  onDragStart,
  onSelect,
}: {
  activeId: string | null;
  orders: Order[];
  selectedId: string | null;
  onDragEnd: (event: DragEndEvent) => void;
  onDragStart: (event: DragStartEvent) => void;
  onSelect: (order: Order) => void;
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
            column={column}
            orders={columnOrders}
            selectedId={selectedId}
            onSelect={onSelect}
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
            const flow = ORDER_FLOW[asOrderStatus(order.status)];
            const primaryAction = flow.next[0];

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
                  <Badge text={statusLabel(order.status)} tone={statusTone(order.status)} />
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
  const flow = ORDER_FLOW[asOrderStatus(order.status)];

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="order-drawer" aria-label={`Заказ № ${order.number}`}>
        <div className="drawer-head">
          <div className="min-w-0">
            <h2 className="drawer-title">№ {order.number}</h2>
            <Badge text={statusLabel(order.status)} tone={statusTone(order.status)} />
          </div>
          <span className="toolbar-spacer" />
          <IconButton label="Закрыть заказ" size="sm" variant="quiet" onClick={onClose}>
            <X size={16} aria-hidden />
          </IconButton>
        </div>

        <div className="drawer-body">
          <div className="drawer-actions">
            {flow.next.map((step) => (
              <Button
                key={step.status}
                disabled={busy}
                size="sm"
                variant={step.status === "completed" ? "ghost" : "primary"}
                onClick={() => onSetStatus(order, step.status)}
              >
                {step.status === "completed" ? <Check size={15} aria-hidden /> : <PackageCheck size={15} aria-hidden />}
                {step.label}
              </Button>
            ))}
            {!CLOSED_STATUSES.has(asOrderStatus(order.status)) ? (
              <Button
                disabled={busy}
                size="sm"
                variant="danger"
                onClick={() => onSetStatus(order, "cancelled")}
              >
                Отменить
              </Button>
            ) : null}
          </div>

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
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) => api.setOrderStatus(id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["orders"] });
      const previous = queryClient.getQueryData<Order[]>(["orders"]);
      queryClient.setQueryData<Order[]>(["orders"], (current) =>
        current?.map((order) => (order.id === id ? { ...order, status } : order)),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(["orders"], context.previous);
      toast.error(error instanceof Error ? error.message : "Не удалось обновить заказ");
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
    setStatus.mutate({ id: order.id, status });
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const orderId = String(event.active.id);
    const targetStatus = event.over?.id ? asOrderStatus(String(event.over.id)) : null;
    const order = allOrders.find((item) => item.id === orderId);
    if (!order || !targetStatus || order.status === targetStatus) return;
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
            orders={boardOrders}
            selectedId={selectedId}
            onDragEnd={onDragEnd}
            onDragStart={onDragStart}
            onSelect={(order) => setSelectedId(order.id)}
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
