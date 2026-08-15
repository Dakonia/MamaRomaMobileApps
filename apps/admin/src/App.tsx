import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  api,
  ApiError,
  formatDateTime,
  formatPrice,
  getToken,
  setToken,
  tenant,
} from "./api";
import { MenuTab } from "./MenuTab";
import { PromosTab } from "./PromosTab";
import { Badge, Button, c, Section, spacing, styles, typography } from "./ui";

type Tab = "menu" | "orders" | "reservations" | "promos";

const ORDER_FLOW: Record<string, { label: string; next: { status: string; label: string }[] }> = {
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

const RESERVATION_LABEL: Record<string, string> = {
  requested: "Ждёт подтверждения",
  confirmed: "Подтверждена",
  seated: "Гость за столом",
  completed: "Завершена",
  cancelled: "Отменена",
  no_show: "Не пришёл",
};

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: (result) => {
      setToken(result.access_token);
      onDone();
    },
    onError: (error: ApiError) => setFailure(error.message),
  });

  return (
    <div
      style={{
        ...styles.page,
        display: "grid",
        placeItems: "center",
        padding: spacing.xl,
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setFailure(null);
          login.mutate();
        }}
        style={{
          ...styles.card,
          padding: spacing.xxl,
          width: "min(380px, 100%)",
          display: "flex",
          flexDirection: "column",
          gap: spacing.base,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: "'Comfortaa', sans-serif",
            fontSize: typography.h1.fontSize,
            color: c.brand,
          }}
        >
          {tenant.branding.displayName}
        </h1>
        <p style={{ margin: 0, color: c.textSecondary }}>Панель управления рестораном</p>

        <input
          style={styles.input}
          type="email"
          value={email}
          placeholder="Почта"
          autoComplete="username"
          onChange={(event) => setEmail(event.target.value)}
        />
        <input
          style={styles.input}
          type="password"
          value={password}
          placeholder="Пароль"
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
        />

        {failure ? <span style={{ color: c.danger }}>{failure}</span> : null}

        <Button onClick={() => login.mutate()} disabled={login.isPending}>
          {login.isPending ? "Входим…" : "Войти"}
        </Button>
      </form>
    </div>
  );
}

function OrdersTab() {
  const queryClient = useQueryClient();
  const orders = useQuery({ queryKey: ["orders"], queryFn: api.orders, refetchInterval: 15_000 });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.setOrderStatus(id, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["orders"] }),
  });

  if ((orders.data ?? []).length === 0) {
    return <p style={{ color: c.textSecondary }}>Активных заказов нет.</p>;
  }

  return (
    <Section title="Активные заказы">
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
        {(orders.data ?? []).map((order) => {
          const flow = ORDER_FLOW[order.status] ?? { label: order.status, next: [] };

          return (
            <div key={order.id} style={{ ...styles.card, padding: spacing.base }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: spacing.base }}>
                <div>
                  <strong>№ {order.number}</strong>{" "}
                  <Badge text={flow.label} tone={order.status === "completed" ? "ok" : "warn"} />
                  <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                    {order.restaurant_name} · {order.type === "delivery" ? "доставка" : "самовывоз"} ·{" "}
                    {formatDateTime(order.created_at)}
                  </div>
                  {order.address_text ? (
                    <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                      {order.address_text}
                    </div>
                  ) : null}
                </div>
                <strong>{formatPrice(order.total_kopecks)}</strong>
              </div>

              <ul style={{ margin: `${spacing.sm}px 0`, paddingLeft: spacing.lg, color: c.textSecondary }}>
                {order.items.map((item) => (
                  <li key={item.id}>
                    {item.name} × {item.quantity}
                  </li>
                ))}
              </ul>

              <div style={{ display: "flex", gap: spacing.sm, flexWrap: "wrap" }}>
                {flow.next.map((step) => (
                  <Button
                    key={step.status}
                    onClick={() => setStatus.mutate({ id: order.id, status: step.status })}
                  >
                    {step.label}
                  </Button>
                ))}
                <Button
                  tone="danger"
                  onClick={() => setStatus.mutate({ id: order.id, status: "cancelled" })}
                >
                  Отменить
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function ReservationsTab() {
  const queryClient = useQueryClient();
  const reservations = useQuery({
    queryKey: ["reservations"],
    queryFn: api.reservations,
    refetchInterval: 30_000,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.setReservationStatus(id, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["reservations"] }),
  });

  if ((reservations.data ?? []).length === 0) {
    return <p style={{ color: c.textSecondary }}>Активных броней нет.</p>;
  }

  return (
    <Section title="Брони">
      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Когда</th>
              <th style={styles.th}>Гость</th>
              <th style={styles.th}>Ресторан</th>
              <th style={styles.th}>Статус</th>
              <th style={styles.th} />
            </tr>
          </thead>
          <tbody>
            {(reservations.data ?? []).map((item) => (
              <tr key={item.id}>
                <td style={styles.td}>
                  <strong>{formatDateTime(item.reserved_at)}</strong>
                  <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                    {item.guests_count} гост.
                  </div>
                </td>
                <td style={styles.td}>
                  {item.contact_name ?? "—"}
                  <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                    {item.contact_phone}
                  </div>
                  {item.comment ? (
                    <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                      {item.comment}
                    </div>
                  ) : null}
                </td>
                <td style={{ ...styles.td, color: c.textSecondary }}>{item.restaurant_name}</td>
                <td style={styles.td}>
                  <Badge
                    text={RESERVATION_LABEL[item.status] ?? item.status}
                    tone={item.status === "confirmed" ? "ok" : "warn"}
                  />
                </td>
                <td style={styles.td}>
                  <div style={{ display: "flex", gap: spacing.sm }}>
                    {item.status === "requested" ? (
                      <Button onClick={() => setStatus.mutate({ id: item.id, status: "confirmed" })}>
                        Подтвердить
                      </Button>
                    ) : null}
                    <Button
                      tone="danger"
                      onClick={() => setStatus.mutate({ id: item.id, status: "cancelled" })}
                    >
                      Отменить
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export default function App() {
  const [authorized, setAuthorized] = useState(getToken() !== null);
  const [tab, setTab] = useState<Tab>("orders");

  const me = useQuery({ queryKey: ["me"], queryFn: api.me, enabled: authorized, retry: false });

  if (!authorized || me.isError) {
    return <Login onDone={() => setAuthorized(true)} />;
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "orders", label: "Заказы" },
    { key: "reservations", label: "Брони" },
    { key: "menu", label: "Меню" },
    { key: "promos", label: "Акции" },
  ];

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <strong style={{ fontFamily: "'Comfortaa', sans-serif", color: c.brand }}>
          {tenant.branding.displayName}
        </strong>

        <nav style={{ display: "flex", gap: spacing.sm, flex: 1 }}>
          {tabs.map((item) => (
            <Button
              key={item.key}
              tone={tab === item.key ? "brand" : "quiet"}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </nav>

        <span style={{ color: c.textSecondary }}>{me.data?.name}</span>
        <Button
          tone="quiet"
          onClick={() => {
            setToken(null);
            setAuthorized(false);
          }}
        >
          Выйти
        </Button>
      </header>

      <main style={styles.content}>
        {tab === "orders" ? <OrdersTab /> : null}
        {tab === "reservations" ? <ReservationsTab /> : null}
        {tab === "menu" ? <MenuTab /> : null}
        {tab === "promos" ? <PromosTab /> : null}
      </main>
    </div>
  );
}
