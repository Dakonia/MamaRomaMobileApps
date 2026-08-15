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
  type Dish,
} from "./api";
import { Badge, Button, c, Section, spacing, styles, typography } from "./ui";

type Tab = "menu" | "orders" | "reservations";

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

function MenuTab() {
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const dishes = useQuery({ queryKey: ["dishes"], queryFn: api.dishes });
  const stopList = useQuery({ queryKey: ["stop-list"], queryFn: api.stopList });

  const [draft, setDraft] = useState<Record<string, string>>({});

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Dish> }) => api.updateDish(id, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["dishes"] }),
  });

  const removeStop = useMutation({
    mutationFn: (id: string) => api.removeStop(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["stop-list"] }),
  });

  const nameOf = (id: string) => categories.data?.find((item) => item.id === id)?.name ?? "—";

  return (
    <>
      <Section title="Блюда">
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Название</th>
                <th style={styles.th}>Категория</th>
                <th style={styles.th}>Цена</th>
                <th style={styles.th}>В продаже</th>
              </tr>
            </thead>
            <tbody>
              {(dishes.data ?? []).map((dish) => (
                <tr key={dish.id}>
                  <td style={styles.td}>
                    <div style={{ fontWeight: 500 }}>{dish.name}</div>
                    {dish.description ? (
                      <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                        {dish.description}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ ...styles.td, color: c.textSecondary }}>{nameOf(dish.category_id)}</td>
                  <td style={styles.td}>
                    <div style={{ display: "flex", gap: spacing.sm, alignItems: "center" }}>
                      <input
                        style={{ ...styles.input, width: 110 }}
                        inputMode="numeric"
                        value={draft[dish.id] ?? String(Math.round(dish.price_kopecks / 100))}
                        onChange={(event) =>
                          setDraft({ ...draft, [dish.id]: event.target.value.replace(/\D/g, "") })
                        }
                      />
                      {draft[dish.id] !== undefined &&
                      draft[dish.id] !== String(Math.round(dish.price_kopecks / 100)) ? (
                        <Button
                          onClick={() => {
                            patch.mutate({
                              id: dish.id,
                              body: { price_kopecks: Number(draft[dish.id]) * 100 },
                            });
                            const next = { ...draft };
                            delete next[dish.id];
                            setDraft(next);
                          }}
                        >
                          Сохранить
                        </Button>
                      ) : null}
                    </div>
                  </td>
                  <td style={styles.td}>
                    <Button
                      tone={dish.is_active ? "quiet" : "brand"}
                      onClick={() =>
                        patch.mutate({ id: dish.id, body: { is_active: !dish.is_active } })
                      }
                    >
                      {dish.is_active ? "Снять с продажи" : "Вернуть"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Стоп-лист">
        {(stopList.data ?? []).length === 0 ? (
          <p style={{ color: c.textSecondary, margin: 0 }}>Сейчас всё есть в наличии.</p>
        ) : (
          <div style={styles.card}>
            <table style={styles.table}>
              <tbody>
                {(stopList.data ?? []).map((entry) => (
                  <tr key={entry.id}>
                    <td style={styles.td}>{entry.dish_name}</td>
                    <td style={{ ...styles.td, color: c.textSecondary }}>{entry.restaurant_name}</td>
                    <td style={{ ...styles.td, color: c.textSecondary }}>{entry.comment ?? "—"}</td>
                    <td style={styles.td}>
                      <Button tone="quiet" onClick={() => removeStop.mutate(entry.id)}>
                        Вернуть в меню
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
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
      </main>
    </div>
  );
}
