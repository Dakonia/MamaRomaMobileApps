import { useEffect, useState } from "react";

import {
  api,
  ApiError,
  formatDate,
  formatDateTime,
  formatPrice,
  type Guest,
  type GuestCard,
} from "./api";
import { Badge, Button, c, radius, Section, spacing, styles, typography } from "./ui";

const ORDER_STATUS: Record<string, string> = {
  created: "Оформлен",
  paid: "Оплачен",
  accepted: "Принят",
  cooking: "Готовится",
  ready: "Готов",
  delivering: "В пути",
  completed: "Выполнен",
  cancelled: "Отменён",
};

const ORDER_TYPE: Record<string, string> = {
  delivery: "Доставка",
  pickup: "Самовывоз",
  dine_in: "В зале",
};

const RESERVATION_STATUS: Record<string, string> = {
  pending: "Ждёт подтверждения",
  confirmed: "Подтверждена",
  seated: "Гость пришёл",
  cancelled: "Отменена",
  no_show: "Не пришёл",
};

const POINTS_OPERATION: Record<string, string> = {
  earn: "Начисление",
  spend: "Списание",
  expire: "Сгорание",
  manual: "Вручную",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: c.surfaceSunken,
        borderRadius: radius.md,
        padding: `${spacing.md}px ${spacing.base}px`,
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>{label}</div>
      <div style={{ fontSize: typography.h3.fontSize, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
      <div
        style={{
          fontSize: typography.caption.fontSize,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: c.textTertiary,
          fontWeight: 600,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function GuestCardView({
  card,
  onChanged,
  onClose,
}: {
  card: GuestCard;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(card.guest.name ?? "");
  const [email, setEmail] = useState(card.guest.email ?? "");
  const [birthday, setBirthday] = useState(card.guest.birthday ?? "");
  const [gender, setGender] = useState(card.guest.gender ?? "");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await api.updateGuest(card.guest.id, {
        name: name.trim() || null,
        email: email.trim() || null,
        birthday: birthday.trim() || null,
        gender: gender === "" ? null : (gender as "male" | "female"),
      });
      onChanged();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const toggleBlock = async () => {
    setFailure(null);
    try {
      await api.updateGuest(card.guest.id, { is_blocked: !card.guest.is_blocked });
      onChanged();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось изменить");
    }
  };

  const remove = async () => {
    if (!window.confirm("Удалить гостя вместе с адресами? Отменить это нельзя")) return;
    setFailure(null);
    try {
      await api.deleteGuest(card.guest.id);
      onClose();
      onChanged();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось удалить");
    }
  };

  return (
    <div style={{ ...styles.card, padding: spacing.lg, display: "grid", gap: spacing.lg }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: typography.h2.fontSize, fontWeight: 600 }}>
            {card.guest.name ?? "Без имени"}
          </div>
          <div style={{ color: c.textSecondary }}>
            {card.guest.phone} · с нами с {formatDate(card.guest.created_at)}
            {card.guest.last_seen_at ? ` · заходил ${formatDate(card.guest.last_seen_at)}` : ""}
          </div>
        </div>
        <Button tone="quiet" onClick={onClose}>
          Закрыть
        </Button>
      </div>

      <div style={{ display: "flex", gap: spacing.md, flexWrap: "wrap" }}>
        <Stat label="Заказов" value={String(card.guest.orders_count)} />
        <Stat label="Потратил" value={formatPrice(card.guest.spent_kopecks)} />
        <Stat label="Уровень" value={card.guest.tier_title || "—"} />
        <Stat label="Баллы" value={String(card.guest.points_balance)} />
      </div>

      <Block title="Данные гостя">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: spacing.base,
          }}
        >
          <Field label="Имя">
            <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Почта">
            <input style={styles.input} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="День рождения">
            <input
              style={styles.input}
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
            />
          </Field>
          <Field label="Пол">
            <select style={styles.input} value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">Не указан</option>
              <option value="female">Женский</option>
              <option value="male">Мужской</option>
            </select>
          </Field>
        </div>

        {failure ? <div style={{ color: c.danger }}>{failure}</div> : null}

        <div style={{ display: "flex", gap: spacing.md, flexWrap: "wrap" }}>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </Button>
          <Button tone="quiet" onClick={() => void toggleBlock()}>
            {card.guest.is_blocked ? "Разблокировать" : "Заблокировать"}
          </Button>
          <Button tone="danger" onClick={() => void remove()}>
            Удалить
          </Button>
        </div>
      </Block>

      <Block title={`Адреса (${card.addresses.length})`}>
        {card.addresses.length === 0 ? (
          <div style={{ color: c.textTertiary }}>Гость пока не сохранял адреса</div>
        ) : (
          card.addresses.map((address) => (
            <div
              key={address.id}
              style={{
                background: c.surfaceSunken,
                borderRadius: radius.md,
                padding: spacing.md,
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {address.title ?? "Адрес"} {address.is_default ? <Badge text="основной" tone="ok" /> : null}
              </div>
              <div style={{ color: c.textSecondary }}>
                {address.locality ? `${address.locality}, ` : ""}
                {address.full_text}
              </div>
              {address.metro ? (
                <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                  м. {address.metro}
                </div>
              ) : null}
              {address.comment ? (
                <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                  {address.comment}
                </div>
              ) : null}
            </div>
          ))
        )}
      </Block>

      <Block title={`Заказы (${card.orders.length})`}>
        {card.orders.length === 0 ? (
          <div style={{ color: c.textTertiary }}>Заказов ещё не было</div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Когда</th>
                <th style={styles.th}>Номер</th>
                <th style={styles.th}>Тип</th>
                <th style={styles.th}>Куда</th>
                <th style={styles.th}>Состав</th>
                <th style={styles.th}>Сумма</th>
                <th style={styles.th}>Статус</th>
              </tr>
            </thead>
            <tbody>
              {card.orders.map((order) => (
                <tr key={order.id}>
                  <td style={styles.td}>{formatDateTime(order.created_at)}</td>
                  <td style={styles.td}>{order.number}</td>
                  <td style={styles.td}>{ORDER_TYPE[order.type] ?? order.type}</td>
                  <td style={styles.td}>{order.address_text ?? order.restaurant_name}</td>
                  <td style={{ ...styles.td, color: c.textSecondary }}>{order.items.join(", ")}</td>
                  <td style={styles.td}>{formatPrice(order.total_kopecks)}</td>
                  <td style={styles.td}>{ORDER_STATUS[order.status] ?? order.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Block>

      <Block title={`Брони (${card.reservations.length})`}>
        {card.reservations.length === 0 ? (
          <div style={{ color: c.textTertiary }}>Столы не бронировал</div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Когда</th>
                <th style={styles.th}>Ресторан</th>
                <th style={styles.th}>Гостей</th>
                <th style={styles.th}>Статус</th>
              </tr>
            </thead>
            <tbody>
              {card.reservations.map((row) => (
                <tr key={row.id}>
                  <td style={styles.td}>{formatDateTime(row.reserved_at)}</td>
                  <td style={styles.td}>{row.restaurant_name}</td>
                  <td style={styles.td}>{row.guests_count}</td>
                  <td style={styles.td}>{RESERVATION_STATUS[row.status] ?? row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Block>

      <Block title="Движение баллов">
        {card.points.length === 0 ? (
          <div style={{ color: c.textTertiary }}>Операций не было</div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Когда</th>
                <th style={styles.th}>Операция</th>
                <th style={styles.th}>Баллы</th>
                <th style={styles.th}>Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {card.points.map((row, index) => (
                <tr key={`${row.created_at}-${index}`}>
                  <td style={styles.td}>{formatDateTime(row.created_at)}</td>
                  <td style={styles.td}>{POINTS_OPERATION[row.operation] ?? row.operation}</td>
                  <td style={{ ...styles.td, color: row.points < 0 ? c.danger : c.success }}>
                    {row.points > 0 ? `+${row.points}` : row.points}
                  </td>
                  <td style={{ ...styles.td, color: c.textSecondary }}>{row.comment ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Block>
    </div>
  );
}

export function GuestsTab() {
  const [rows, setRows] = useState<Guest[]>([]);
  const [search, setSearch] = useState("");
  const [card, setCard] = useState<GuestCard | null>(null);
  const [creating, setCreating] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const load = async (query = search) => {
    try {
      setRows(await api.guests(query));
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось загрузить гостей");
    }
  };

  useEffect(() => {
    // Ищем на паузе в наборе, чтобы не дёргать сервер на каждую букву
    const timer = setTimeout(() => void load(search), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const open = async (guest: Guest) => {
    setFailure(null);
    try {
      setCard(await api.guestCard(guest.id));
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось открыть карточку");
    }
  };

  const create = async () => {
    setFailure(null);
    try {
      const guest = await api.createGuest({
        phone: newPhone.trim(),
        name: newName.trim() || null,
        email: null,
        birthday: null,
        gender: null,
      });
      setCreating(false);
      setNewPhone("");
      setNewName("");
      await load();
      await open(guest);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось создать гостя");
    }
  };

  if (card) {
    return (
      <Section title="Гость">
        <GuestCardView
          card={card}
          onClose={() => setCard(null)}
          onChanged={async () => {
            await load();
            const fresh = await api.guestCard(card.guest.id).catch(() => null);
            setCard(fresh);
          }}
        />
      </Section>
    );
  }

  return (
    <Section
      title="Гости"
      action={
        creating ? null : <Button onClick={() => setCreating(true)}>Завести гостя</Button>
      }
    >
      {failure ? <div style={{ color: c.danger }}>{failure}</div> : null}

      {creating ? (
        <div style={{ ...styles.card, padding: spacing.lg, display: "flex", gap: spacing.base, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Телефон">
            <input
              style={styles.input}
              placeholder="+7 999 123-45-67"
              value={newPhone}
              onChange={(event) => setNewPhone(event.target.value)}
            />
          </Field>
          <Field label="Имя">
            <input
              style={styles.input}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </Field>
          <Button onClick={() => void create()} disabled={newPhone.trim().length < 10}>
            Создать
          </Button>
          <Button tone="quiet" onClick={() => setCreating(false)}>
            Отмена
          </Button>
        </div>
      ) : null}

      <input
        style={{ ...styles.input, maxWidth: 380 }}
        placeholder="Поиск по имени, телефону или почте"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Гость</th>
              <th style={styles.th}>Регистрация</th>
              <th style={styles.th}>Заказы</th>
              <th style={styles.th}>Потратил</th>
              <th style={styles.th}>Лояльность</th>
              <th style={styles.th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((guest) => (
              <tr key={guest.id}>
                <td style={styles.td}>
                  <div style={{ fontWeight: 600 }}>
                    {guest.name ?? "Без имени"}{" "}
                    {guest.is_blocked ? <Badge text="заблокирован" tone="warn" /> : null}
                  </div>
                  <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                    {guest.phone}
                    {guest.email ? ` · ${guest.email}` : ""}
                  </div>
                </td>
                <td style={styles.td}>{formatDate(guest.created_at)}</td>
                <td style={styles.td}>{guest.orders_count}</td>
                <td style={styles.td}>{formatPrice(guest.spent_kopecks)}</td>
                <td style={styles.td}>
                  {guest.tier_title || "—"}
                  <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                    {guest.points_balance} баллов
                  </div>
                </td>
                <td style={{ ...styles.td, textAlign: "right" }}>
                  <Button tone="quiet" onClick={() => void open(guest)}>
                    Открыть
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td style={{ ...styles.td, color: c.textTertiary }} colSpan={6}>
                  Никого не нашли
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
