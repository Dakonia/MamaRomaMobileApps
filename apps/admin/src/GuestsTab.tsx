import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  Ban,
  Cake,
  CalendarDays,
  Coins,
  CreditCard,
  Edit3,
  Gift,
  History,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Plus,
  ReceiptText,
  Save,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  TrendingUp,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  formatDate,
  formatDateTime,
  formatPrice,
  type Guest,
  type GuestCard,
  type GuestFeedback,
  type GuestOrder,
} from "./api";
import { ConfirmDialog } from "./components/patterns/ConfirmDialog";
import { DataTable, DensityToggle, createAdminColumnHelper, useTableDensity } from "./components/patterns/DataTable";
import { Badge, Button, IconButton, Section, Select, cn } from "./ui";

type GuestFilter = "all" | "vip" | "feedback" | "points" | "new" | "blocked";
type GuestDrawerTab = "overview" | "orders" | "feedback" | "loyalty" | "profile";
type PointsMode = "earn" | "spend";
type GuestDraft = {
  birthday: string;
  email: string;
  gender: "male" | "female" | "";
  name: string;
  phone: string;
};

const column = createAdminColumnHelper<Guest>();

const ORDER_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "muted" | "bad" | "accent" }> = {
  created: { label: "Оформлен", tone: "muted" },
  paid: { label: "Оплачен", tone: "muted" },
  accepted: { label: "Принят", tone: "accent" },
  cooking: { label: "Готовится", tone: "warn" },
  ready: { label: "Готов", tone: "accent" },
  delivering: { label: "В пути", tone: "warn" },
  completed: { label: "Выполнен", tone: "ok" },
  cancelled: { label: "Отменён", tone: "bad" },
};

const ORDER_TYPE: Record<string, string> = {
  delivery: "Доставка",
  dine_in: "В зале",
  pickup: "Самовывоз",
};

const RESERVATION_STATUS: Record<string, string> = {
  requested: "Ждёт подтверждения",
  pending: "Ждёт подтверждения",
  confirmed: "Подтверждена",
  seated: "Гость пришёл",
  completed: "Завершена",
  cancelled: "Отменена",
  no_show: "Не пришёл",
};

const POINTS_OPERATION: Record<string, string> = {
  birthday: "День рождения",
  earn: "Начисление",
  expire: "Сгорание",
  manual: "Вручную",
  refund: "Возврат",
  spend: "Списание",
  welcome: "Приветствие",
};

const FILTERS: { key: GuestFilter; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "vip", label: "Ценные" },
  { key: "feedback", label: "С отзывами" },
  { key: "points", label: "Есть баллы" },
  { key: "new", label: "Без заказов" },
  { key: "blocked", label: "Блокировки" },
];

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function useDebounced(value: string, delayMs = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}

function toDraft(card?: GuestCard | null): GuestDraft {
  return {
    birthday: card?.guest.birthday ?? "",
    email: card?.guest.email ?? "",
    gender: card?.guest.gender ?? "",
    name: card?.guest.name ?? "",
    phone: card?.guest.phone ?? "",
  };
}

function isDeletedGuest(guest: Pick<Guest, "phone">): boolean {
  return guest.phone.startsWith("deleted-");
}

function guestPhoneLabel(phone: string): string {
  return phone.startsWith("deleted-") ? "телефон удалён" : phone;
}

function initials(guest: Pick<Guest, "name" | "phone">): string {
  if (isDeletedGuest(guest)) return "УГ";
  const source = guest.name?.trim() || guest.phone.replace(/\D/g, "");
  if (!source) return "Г";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toLocaleUpperCase("ru-RU");
  return source.slice(0, 2).toLocaleUpperCase("ru-RU");
}

function guestTitle(guest: Pick<Guest, "name" | "phone">): string {
  if (isDeletedGuest(guest) && !guest.name?.trim()) return "Удалённый гость";
  return guest.name?.trim() || "Гость без имени";
}

function isVip(guest: Guest): boolean {
  return guest.orders_count >= 10 || guest.spent_kopecks >= 5_000_000;
}

function averageCheck(guest: Guest): number {
  return guest.orders_count > 0 ? Math.round(guest.spent_kopecks / guest.orders_count) : 0;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function lastActivityLabel(guest: Guest): string {
  if (guest.last_order_at) return `заказ ${formatDate(guest.last_order_at)}`;
  if (guest.last_seen_at) return `визит ${formatDate(guest.last_seen_at)}`;
  return `с ${formatDate(guest.created_at)}`;
}

function ratingLabel(value: number | null): string {
  return value === null ? "нет оценок" : `${value.toFixed(1)} из 5`;
}

function orderStatusBadge(status: string) {
  const meta = ORDER_STATUS[status] ?? { label: status, tone: "muted" as const };
  return <Badge text={meta.label} tone={meta.tone} />;
}

function guestStatus(guest: Guest) {
  if (isDeletedGuest(guest)) return <Badge text="удалён" tone="bad" />;
  if (guest.is_blocked) return <Badge text="заблокирован" tone="bad" />;
  if (isVip(guest)) return <Badge text="ценный" tone="accent" />;
  if (guest.orders_count === 0) return <Badge text="новый" tone="muted" />;
  return <Badge text="активен" tone="ok" />;
}

function GuestAvatar({ guest, size = "md" }: { guest: Pick<Guest, "name" | "phone">; size?: "sm" | "md" | "lg" }) {
  return (
    <span className="guest-avatar" data-size={size}>
      {initials(guest)}
    </span>
  );
}

function GuestTableIdentity({ guest }: { guest: Guest }) {
  return (
    <div className="guest-table-identity">
      <GuestAvatar guest={guest} size="sm" />
      <div className="min-w-0">
        <div className="row-main">
          {guestTitle(guest)} {isDeletedGuest(guest) ? <Badge text="данные удалены" tone="bad" /> : guest.is_blocked ? <Badge text="стоп" tone="bad" /> : null}
        </div>
        <div className="row-sub guest-contact-line">
          <Phone size={13} aria-hidden />
          <span>{guestPhoneLabel(guest.phone)}</span>
          {guest.email ? (
            <>
              <span>·</span>
              <Mail size={13} aria-hidden />
              <span>{guest.email}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function GuestMetric({
  icon,
  label,
  note,
  tone = "neutral",
  value,
}: {
  icon: ReactNode;
  label: string;
  note: string;
  tone?: "accent" | "bad" | "neutral" | "ok" | "warn";
  value: string;
}) {
  return (
    <div className="guest-metric-card" data-tone={tone}>
      <span className="guest-metric-icon">{icon}</span>
      <div className="min-w-0">
        <div className="metric-label">{label}</div>
        <div className="guest-metric-value">{value}</div>
        <div className="metric-note">{note}</div>
      </div>
    </div>
  );
}

function FeedbackStars({ rating }: { rating: number }) {
  return (
    <span className="guest-stars" aria-label={`Оценка ${rating} из 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star key={index} size={13} aria-hidden data-filled={index < rating} />
      ))}
    </span>
  );
}

function favoriteItems(orders: GuestOrder[]) {
  const map = new Map<string, { count: number; spent: number }>();
  for (const order of orders) {
    for (const item of order.items) {
      const current = map.get(item.name) ?? { count: 0, spent: 0 };
      current.count += item.quantity;
      current.spent += item.total_kopecks;
      map.set(item.name, current);
    }
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.count - a.count || b.spent - a.spent)
    .slice(0, 5);
}

function openOrder(orderId: string) {
  sessionStorage.setItem("mr.admin.focus-order", orderId);
  window.location.href = "/orders";
}

function CreateGuestForm({ draft, set }: { draft: GuestDraft; set: <K extends keyof GuestDraft>(key: K, value: GuestDraft[K]) => void }) {
  return (
    <div className="guest-form-grid">
      <label className="field">
        <span className="field-label">Телефон</span>
        <input
          className="input"
          placeholder="+7 999 123-45-67"
          value={draft.phone}
          onChange={(event) => set("phone", event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">Имя</span>
        <input className="input" placeholder="Имя гостя" value={draft.name} onChange={(event) => set("name", event.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Почта</span>
        <input
          className="input"
          placeholder="mail@example.com"
          value={draft.email}
          onChange={(event) => set("email", event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">День рождения</span>
        <input className="input" type="date" value={draft.birthday} onChange={(event) => set("birthday", event.target.value)} />
      </label>
      <div className="field">
        <span className="field-label">Пол</span>
        <Select
          value={draft.gender}
          options={[
            { label: "Не указан", value: "" },
            { label: "Женский", value: "female" },
            { label: "Мужской", value: "male" },
          ]}
          onChange={(value) => set("gender", value as GuestDraft["gender"])}
        />
      </div>
    </div>
  );
}

function GuestDrawerHeader({
  card,
  creating,
  onClose,
}: {
  card: GuestCard | null;
  creating: boolean;
  onClose: () => void;
}) {
  const guest = card?.guest;

  return (
    <div className="guest-drawer-head">
      <div className="guest-drawer-title-block">
        {guest ? <GuestAvatar guest={guest} /> : <UserRound size={18} aria-hidden />}
        <div className="min-w-0">
          <span className="metric-label">{creating ? "Новый профиль" : "Карточка гостя"}</span>
          <h2>{creating ? "Новый гость" : guest ? guestTitle(guest) : "Гость"}</h2>
          <div className="guest-drawer-subline">
            {guest ? (
              <>
                <Phone size={13} aria-hidden />
                <span>{guestPhoneLabel(guest.phone)}</span>
                {guest.card_number ? (
                  <>
                    <span>·</span>
                    <CreditCard size={13} aria-hidden />
                    <span>карта {guest.card_number}</span>
                  </>
                ) : null}
              </>
            ) : (
              <span>Профиль для заказов и программы лояльности</span>
            )}
          </div>
        </div>
      </div>
      <IconButton label="Закрыть карточку" size="sm" variant="quiet" onClick={onClose}>
        <X size={16} aria-hidden />
      </IconButton>
    </div>
  );
}

function GuestDrawerTabs({ active, onChange }: { active: GuestDrawerTab; onChange: (tab: GuestDrawerTab) => void }) {
  const tabs: { icon: ReactNode; key: GuestDrawerTab; label: string }[] = [
    { icon: <TrendingUp size={14} aria-hidden />, key: "overview", label: "Обзор" },
    { icon: <ReceiptText size={14} aria-hidden />, key: "orders", label: "Заказы" },
    { icon: <MessageSquareText size={14} aria-hidden />, key: "feedback", label: "Отзывы" },
    { icon: <Coins size={14} aria-hidden />, key: "loyalty", label: "Баллы" },
    { icon: <Edit3 size={14} aria-hidden />, key: "profile", label: "Профиль" },
  ];

  return (
    <div className="guest-drawer-tabs" aria-label="Разделы карточки гостя">
      {tabs.map((tab) => (
        <button key={tab.key} data-active={active === tab.key} type="button" onClick={() => onChange(tab.key)}>
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

function GuestHero({ card }: { card: GuestCard }) {
  const guest = card.guest;
  const lastOrderDays = daysSince(guest.last_order_at);

  return (
    <section className="guest-hero-panel">
      <div className="guest-hero-main">
        <GuestAvatar guest={guest} size="lg" />
        <div className="min-w-0">
          <div className="guest-hero-title-row">
            <h3>{guestTitle(guest)}</h3>
            {guestStatus(guest)}
          </div>
          <div className="guest-hero-contact">
            <span>
              <Phone size={14} aria-hidden /> {guestPhoneLabel(guest.phone)}
            </span>
            {guest.email ? (
              <span>
                <Mail size={14} aria-hidden /> {guest.email}
              </span>
            ) : null}
            {guest.birthday ? (
              <span>
                <Cake size={14} aria-hidden /> {formatDate(guest.birthday)}
              </span>
            ) : null}
          </div>
          <div className="chips-line">
            <span className="mini-chip">карта {guest.card_number || "не выдана"}</span>
            <span className="mini-chip">{guest.tier_title || "Базовый уровень"}</span>
            <span className="mini-chip">{lastOrderDays === null ? "заказов не было" : `${lastOrderDays} дн. с заказа`}</span>
          </div>
        </div>
      </div>
      <div className="guest-hero-rating">
        <span className="metric-label">Оценки</span>
        <strong>{ratingLabel(guest.average_rating)}</strong>
        <small>{guest.feedback_count} отзывов</small>
      </div>
    </section>
  );
}

function GuestMetrics({ guest }: { guest: Guest }) {
  return (
    <div className="guest-metric-grid">
      <GuestMetric icon={<ReceiptText size={16} aria-hidden />} label="Заказы" note="за всё время" value={String(guest.orders_count)} />
      <GuestMetric icon={<TrendingUp size={16} aria-hidden />} label="Потратил" note="сумма заказов" value={formatPrice(guest.spent_kopecks)} />
      <GuestMetric
        icon={<CreditCard size={16} aria-hidden />}
        label="Средний чек"
        note="на один заказ"
        value={formatPrice(averageCheck(guest))}
      />
      <GuestMetric
        icon={<Coins size={16} aria-hidden />}
        label="Баллы"
        note={guest.tier_title || "уровень не задан"}
        tone={guest.points_balance > 0 ? "accent" : "neutral"}
        value={String(guest.points_balance)}
      />
      <GuestMetric
        icon={<MessageSquareText size={16} aria-hidden />}
        label="Отзывы"
        note={ratingLabel(guest.average_rating)}
        tone={guest.average_rating !== null && guest.average_rating < 4 ? "warn" : "neutral"}
        value={String(guest.feedback_count)}
      />
      <GuestMetric icon={<CalendarDays size={16} aria-hidden />} label="Активность" note="последнее событие" value={lastActivityLabel(guest)} />
    </div>
  );
}

function GuestOverview({ card, onOpenOrder }: { card: GuestCard; onOpenOrder: (orderId: string) => void }) {
  const favorites = favoriteItems(card.orders);
  const lastOrder = card.orders[0];
  const lastFeedback = card.feedbacks[0];

  return (
    <div className="guest-overview-grid">
      <section className="guest-info-panel">
        <div className="guest-panel-head">
          <ReceiptText size={16} aria-hidden />
          <h3>Последний заказ</h3>
        </div>
        {lastOrder ? (
          <button className="guest-last-order" type="button" onClick={() => onOpenOrder(lastOrder.id)}>
            <span>
              <strong>№ {lastOrder.number}</strong>
              <small>
                {formatDateTime(lastOrder.created_at)} · {ORDER_TYPE[lastOrder.type] ?? lastOrder.type}
              </small>
            </span>
            <strong className="mono">{formatPrice(lastOrder.total_kopecks)}</strong>
          </button>
        ) : (
          <div className="guest-empty-note">Заказов ещё не было</div>
        )}
      </section>

      <section className="guest-info-panel">
        <div className="guest-panel-head">
          <Gift size={16} aria-hidden />
          <h3>Чаще заказывает</h3>
        </div>
        {favorites.length > 0 ? (
          <div className="guest-favorite-list">
            {favorites.map((item) => (
              <div key={item.name} className="guest-favorite-row">
                <span>{item.name}</span>
                <strong>{item.count} раз</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="guest-empty-note">История блюд появится после первого заказа</div>
        )}
      </section>

      <section className="guest-info-panel">
        <div className="guest-panel-head">
          <MapPin size={16} aria-hidden />
          <h3>Адреса</h3>
        </div>
        {card.addresses.length > 0 ? (
          <div className="guest-address-list">
            {card.addresses.slice(0, 4).map((address) => (
              <div key={address.id} className="guest-address-row">
                <span>
                  {address.title ?? "Адрес"} {address.is_default ? <Badge text="основной" tone="ok" /> : null}
                </span>
                <small>
                  {address.locality ? `${address.locality}, ` : ""}
                  {address.full_text}
                </small>
                {address.comment ? <small>{address.comment}</small> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="guest-empty-note">Сохранённых адресов нет</div>
        )}
      </section>

      <section className="guest-info-panel">
        <div className="guest-panel-head">
          <MessageSquareText size={16} aria-hidden />
          <h3>Последний отзыв</h3>
        </div>
        {lastFeedback ? <GuestFeedbackCard feedback={lastFeedback} compact /> : <div className="guest-empty-note">Отзывы пока не оставлял</div>}
      </section>
    </div>
  );
}

function GuestOrderCard({
  expanded,
  onOpenOrder,
  onToggle,
  order,
}: {
  expanded: boolean;
  onOpenOrder: (orderId: string) => void;
  onToggle: () => void;
  order: GuestOrder;
}) {
  return (
    <article className="guest-order-card" data-expanded={expanded}>
      <button className="guest-order-summary" type="button" onClick={onToggle}>
        <span className="guest-order-number">
          <ReceiptText size={15} aria-hidden />
          № {order.number}
        </span>
        <span className="guest-order-meta">
          {formatDateTime(order.created_at)} · {ORDER_TYPE[order.type] ?? order.type}
        </span>
        <span className="guest-order-status">{orderStatusBadge(order.status)}</span>
        <strong className="mono">{formatPrice(order.total_kopecks)}</strong>
      </button>

      {expanded ? (
        <div className="guest-order-detail">
          <div className="guest-order-context">
            <div>
              <span className="detail-label">Ресторан</span>
              <strong>{order.restaurant_name}</strong>
            </div>
            <div>
              <span className="detail-label">Куда</span>
              <strong>{order.address_text || "в ресторане"}</strong>
            </div>
            <div>
              <span className="detail-label">Гостей</span>
              <strong>{order.persons_count ? `${order.persons_count}` : "не указано"}</strong>
            </div>
          </div>

          <div className="guest-order-items">
            {order.items.map((item) => (
              <div key={item.id} className="guest-order-item">
                <div className="min-w-0">
                  <strong>{item.name}</strong>
                  <small>
                    {item.quantity} шт.
                    {item.extras.length > 0 ? ` · ${item.extras.join(", ")}` : ""}
                  </small>
                </div>
                <span className="mono">{formatPrice(item.total_kopecks)}</span>
              </div>
            ))}
          </div>

          <div className="guest-order-money">
            <span>
              <small>Доставка</small>
              <strong>{formatPrice(order.delivery_kopecks)}</strong>
            </span>
            <span>
              <small>Скидки</small>
              <strong>{formatPrice(order.discount_kopecks)}</strong>
            </span>
            <span>
              <small>Баллы</small>
              <strong>
                {order.points_spent > 0 ? `-${order.points_spent}` : "0"} / +{order.points_earned}
              </strong>
            </span>
            <span>
              <small>Промокод</small>
              <strong>{order.promo_code || "нет"}</strong>
            </span>
          </div>

          {order.comment ? <div className="guest-order-comment">{order.comment}</div> : null}
          {order.feedback ? <GuestFeedbackCard feedback={order.feedback} compact /> : null}

          <Button size="sm" variant="ghost" onClick={() => onOpenOrder(order.id)}>
            <ReceiptText size={15} aria-hidden />
            Открыть заказ
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function GuestOrdersTab({ card, onOpenOrder }: { card: GuestCard; onOpenOrder: (orderId: string) => void }) {
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(card.orders[0]?.id ?? null);

  useEffect(() => {
    setExpandedOrderId(card.orders[0]?.id ?? null);
  }, [card.guest.id, card.orders]);

  if (card.orders.length === 0) {
    return <div className="guest-empty-state">Гость ещё не делал заказы.</div>;
  }

  return (
    <div className="guest-order-list">
      {card.orders.map((order) => (
        <GuestOrderCard
          key={order.id}
          expanded={expandedOrderId === order.id}
          order={order}
          onOpenOrder={onOpenOrder}
          onToggle={() => setExpandedOrderId((current) => (current === order.id ? null : order.id))}
        />
      ))}
    </div>
  );
}

function GuestFeedbackCard({ compact = false, feedback }: { compact?: boolean; feedback: GuestFeedback }) {
  return (
    <article className="guest-feedback-card" data-compact={compact}>
      <div className="guest-feedback-top">
        <FeedbackStars rating={feedback.rating} />
        <span className="row-sub">№ {feedback.order_number}</span>
        <span className="toolbar-spacer" />
        <span className="row-sub">{formatDate(feedback.created_at)}</span>
      </div>
      {feedback.comment ? <p>{feedback.comment}</p> : <p className="row-muted">Оставил оценку без комментария</p>}
      <div className="chips-line">
        <span className="mini-chip">{feedback.restaurant_name}</span>
        {feedback.tags.map((tag) => (
          <span key={tag} className="mini-chip">
            {tag}
          </span>
        ))}
      </div>
    </article>
  );
}

function GuestFeedbackTab({ card }: { card: GuestCard }) {
  if (card.feedbacks.length === 0) {
    return <div className="guest-empty-state">Гость пока не оставлял обратную связь.</div>;
  }

  return (
    <div className="guest-feedback-list">
      {card.feedbacks.map((feedback) => (
        <GuestFeedbackCard key={feedback.id} feedback={feedback} />
      ))}
    </div>
  );
}

function GuestLoyaltyTab({
  card,
  onAdjustPoints,
  pending,
}: {
  card: GuestCard;
  onAdjustPoints: (guest: Guest, points: number, comment: string) => void;
  pending: boolean;
}) {
  const [mode, setMode] = useState<PointsMode>("earn");
  const [points, setPoints] = useState("100");
  const [comment, setComment] = useState("");
  const amount = Number(points.replace(/\D/g, "") || 0);
  const signedAmount = mode === "earn" ? amount : -amount;

  useEffect(() => {
    setComment("");
    setPoints("100");
    setMode("earn");
  }, [card.guest.id]);

  return (
    <div className="guest-loyalty-layout">
      <section className="guest-loyalty-panel">
        <div className="guest-panel-head">
          <Coins size={16} aria-hidden />
          <h3>Баланс и ручная операция</h3>
        </div>
        <div className="guest-loyalty-balance">
          <span>Текущий баланс</span>
          <strong>{card.guest.points_balance}</strong>
          <small>{card.guest.tier_title || "уровень не задан"} · карта {card.guest.card_number || "не выдана"}</small>
        </div>
        <div className="guest-points-mode" aria-label="Тип операции">
          <button data-active={mode === "earn"} type="button" onClick={() => setMode("earn")}>
            <Plus size={14} aria-hidden />
            Начислить
          </button>
          <button data-active={mode === "spend"} type="button" onClick={() => setMode("spend")}>
            <Coins size={14} aria-hidden />
            Списать
          </button>
        </div>
        <div className="guest-points-form">
          <label className="field">
            <span className="field-label">Баллы</span>
            <input className="input" inputMode="numeric" value={points} onChange={(event) => setPoints(event.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="field" data-wide="true">
            <span className="field-label">Комментарий</span>
            <input
              className="input"
              placeholder="Причина операции"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
          <Button
            disabled={pending || amount <= 0}
            size="sm"
            onClick={() => onAdjustPoints(card.guest, signedAmount, comment.trim())}
          >
            <Save size={15} aria-hidden />
            Провести
          </Button>
        </div>
      </section>

      <section className="guest-loyalty-panel">
        <div className="guest-panel-head">
          <History size={16} aria-hidden />
          <h3>История баллов</h3>
        </div>
        {card.points.length === 0 ? (
          <div className="guest-empty-note">Операций по баллам ещё не было</div>
        ) : (
          <div className="guest-points-history">
            {card.points.map((row, index) => (
              <div key={`${row.created_at}-${index}`} className="guest-points-row">
                <span>
                  <strong>{POINTS_OPERATION[row.operation] ?? row.operation}</strong>
                  <small>{formatDateTime(row.created_at)}</small>
                  {row.comment ? <small>{row.comment}</small> : null}
                </span>
                <strong className={cn("mono", row.points < 0 ? "guest-negative" : "guest-positive")}>
                  {row.points > 0 ? `+${row.points}` : row.points}
                </strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function GuestProfileTab({
  card,
  creating,
  draft,
  set,
}: {
  card: GuestCard | null;
  creating: boolean;
  draft: GuestDraft;
  set: <K extends keyof GuestDraft>(key: K, value: GuestDraft[K]) => void;
}) {
  return (
    <div className="guest-profile-layout">
      <section className="guest-info-panel">
        <div className="guest-panel-head">
          <Edit3 size={16} aria-hidden />
          <h3>{creating ? "Данные нового гостя" : "Редактирование профиля"}</h3>
        </div>
        <CreateGuestForm draft={draft} set={set} />
      </section>

      {!creating && card ? (
        <section className="guest-info-panel">
          <div className="guest-panel-head">
            <ShieldCheck size={16} aria-hidden />
            <h3>Состояние</h3>
          </div>
          <div className="guest-profile-facts">
            <div>
              <span className="detail-label">Регистрация</span>
              <strong>{formatDateTime(card.guest.created_at)}</strong>
            </div>
            <div>
              <span className="detail-label">Последний вход</span>
              <strong>{card.guest.last_seen_at ? formatDateTime(card.guest.last_seen_at) : "не заходил"}</strong>
            </div>
            <div>
              <span className="detail-label">Статус</span>
              <strong>{card.guest.is_blocked ? "заблокирован" : "активен"}</strong>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function GuestReservationsPanel({ card }: { card: GuestCard }) {
  return (
    <section className="guest-info-panel">
      <div className="guest-panel-head">
        <CalendarDays size={16} aria-hidden />
        <h3>Брони</h3>
      </div>
      {card.reservations.length === 0 ? (
        <div className="guest-empty-note">Столы не бронировал</div>
      ) : (
        <div className="guest-reservation-list">
          {card.reservations.slice(0, 8).map((reservation) => (
            <div key={reservation.id} className="guest-reservation-row">
              <strong>{formatDateTime(reservation.reserved_at)}</strong>
              <small>
                {reservation.restaurant_name} · {reservation.guests_count} гост.
              </small>
              <span className="mini-chip">{RESERVATION_STATUS[reservation.status] ?? reservation.status}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function GuestDrawer({
  card,
  creating,
  loading,
  onAdjustPoints,
  onClose,
  onCreate,
  onDelete,
  onSave,
  onToggleBlock,
  pending,
  pointsPending,
}: {
  card: GuestCard | null;
  creating: boolean;
  loading: boolean;
  onAdjustPoints: (guest: Guest, points: number, comment: string) => void;
  onClose: () => void;
  onCreate: (draft: GuestDraft) => void;
  onDelete: (guest: Guest) => void;
  onSave: (card: GuestCard, draft: GuestDraft) => void;
  onToggleBlock: (guest: Guest) => void;
  pending: boolean;
  pointsPending: boolean;
}) {
  const [draft, setDraft] = useState<GuestDraft>(() => toDraft(card));
  const [tab, setTab] = useState<GuestDrawerTab>("overview");

  useEffect(() => {
    setDraft(toDraft(card));
    setTab(creating ? "profile" : "overview");
  }, [card, creating]);

  const set = <K extends keyof GuestDraft>(key: K, value: GuestDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const canSubmit = draft.phone.trim().length >= 10 && (creating || card !== null);

  return (
    <>
      <div className="drawer-overlay guest-editor-overlay" onClick={onClose} />
      <aside className="guest-drawer-shell" aria-label={creating ? "Новый гость" : "Карточка гостя"}>
        <GuestDrawerHeader card={card} creating={creating} onClose={onClose} />

        {loading ? (
          <div className="guest-drawer-body">
            <div className="skeleton skeleton-row" />
            <div className="skeleton skeleton-card" />
            <div className="skeleton skeleton-card" />
          </div>
        ) : (
          <div className="guest-drawer-body">
            {creating ? (
              <GuestProfileTab card={null} creating draft={draft} set={set} />
            ) : card ? (
              <>
                <GuestHero card={card} />
                <GuestDrawerTabs active={tab} onChange={setTab} />

                {tab === "overview" ? (
                  <>
                    <GuestMetrics guest={card.guest} />
                    <GuestOverview card={card} onOpenOrder={openOrder} />
                    <GuestReservationsPanel card={card} />
                  </>
                ) : null}
                {tab === "orders" ? <GuestOrdersTab card={card} onOpenOrder={openOrder} /> : null}
                {tab === "feedback" ? <GuestFeedbackTab card={card} /> : null}
                {tab === "loyalty" ? (
                  <GuestLoyaltyTab card={card} pending={pointsPending} onAdjustPoints={onAdjustPoints} />
                ) : null}
                {tab === "profile" ? <GuestProfileTab card={card} creating={false} draft={draft} set={set} /> : null}
              </>
            ) : null}
          </div>
        )}

        <div className="guest-drawer-foot">
          {!creating && card ? (
            <>
              <Button disabled={pending} variant="danger" onClick={() => onToggleBlock(card.guest)}>
                <Ban size={15} aria-hidden />
                {card.guest.is_blocked ? "Разблокировать" : "Заблокировать"}
              </Button>
              <Button disabled={pending} variant="danger" onClick={() => onDelete(card.guest)}>
                <Trash2 size={15} aria-hidden />
                Удалить
              </Button>
            </>
          ) : null}
          <span className="toolbar-spacer" />
          <Button disabled={pending} variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={pending || !canSubmit}
            onClick={() => {
              if (creating) onCreate(draft);
              else if (card) onSave(card, draft);
            }}
          >
            <Save size={15} aria-hidden />
            {pending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </div>
      </aside>
    </>
  );
}

export function GuestsTab() {
  const queryClient = useQueryClient();
  const [density, setDensity] = useTableDensity();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [filter, setFilter] = useState<GuestFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Guest | null>(null);

  const guests = useQuery({
    queryKey: ["guests", debouncedSearch],
    queryFn: () => api.guests(debouncedSearch),
    staleTime: 20_000,
  });

  const guestCard = useQuery({
    queryKey: ["guest-card", selectedId],
    queryFn: () => api.guestCard(selectedId ?? ""),
    enabled: selectedId !== null,
    staleTime: 10_000,
  });

  useEffect(() => {
    const focusedGuest = sessionStorage.getItem("mr.admin.focus-guest");
    if (!focusedGuest) return;
    sessionStorage.removeItem("mr.admin.focus-guest");
    setCreating(false);
    setSelectedId(focusedGuest);
  }, []);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["guests"] });
    if (selectedId) void queryClient.invalidateQueries({ queryKey: ["guest-card", selectedId] });
  };

  const create = useMutation({
    mutationFn: (draft: GuestDraft) =>
      api.createGuest({
        birthday: draft.birthday || null,
        email: draft.email.trim() || null,
        gender: draft.gender === "" ? null : draft.gender,
        name: draft.name.trim() || null,
        phone: draft.phone.trim(),
      }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (guest) => {
      setCreating(false);
      setSelectedId(guest.id);
      refresh();
      toast.success("Гость создан");
    },
  });

  const update = useMutation({
    mutationFn: ({ card, draft }: { card: GuestCard; draft: GuestDraft }) =>
      api.updateGuest(card.guest.id, {
        birthday: draft.birthday || null,
        email: draft.email.trim() || null,
        gender: draft.gender === "" ? null : draft.gender,
        is_blocked: card.guest.is_blocked,
        name: draft.name.trim() || null,
      }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      refresh();
      toast.success("Гость сохранён");
    },
  });

  const adjustPoints = useMutation({
    mutationFn: ({ comment, guest, points }: { comment: string; guest: Guest; points: number }) =>
      api.adjustGuestPoints(guest.id, { comment: comment || null, points }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (_row, variables) => {
      refresh();
      toast.success(variables.points > 0 ? "Баллы начислены" : "Баллы списаны");
    },
  });

  const toggleBlock = useMutation({
    mutationFn: (guest: Guest) => api.updateGuest(guest.id, { is_blocked: !guest.is_blocked }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteGuest(id),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      setDeleteTarget(null);
      setSelectedId(null);
      refresh();
      toast.success("Гость удалён");
    },
  });

  const rows = useMemo(() => {
    const list = guests.data ?? [];
    return list.filter((guest) => {
      if (filter === "blocked") return guest.is_blocked;
      if (filter === "feedback") return guest.feedback_count > 0;
      if (filter === "new") return guest.orders_count === 0;
      if (filter === "points") return guest.points_balance > 0;
      if (filter === "vip") return isVip(guest);
      return true;
    });
  }, [filter, guests.data]);

  const stats = useMemo(() => {
    const list = guests.data ?? [];
    const withOrders = list.filter((guest) => guest.orders_count > 0);
    return {
      avgCheck:
        withOrders.length > 0
          ? Math.round(list.reduce((sum, guest) => sum + guest.spent_kopecks, 0) / list.reduce((sum, guest) => sum + guest.orders_count, 0))
          : 0,
      blocked: list.filter((guest) => guest.is_blocked).length,
      feedback: list.reduce((sum, guest) => sum + guest.feedback_count, 0),
      orders: list.reduce((sum, guest) => sum + guest.orders_count, 0),
      points: list.reduce((sum, guest) => sum + guest.points_balance, 0),
      spent: list.reduce((sum, guest) => sum + guest.spent_kopecks, 0),
      total: list.length,
      vip: list.filter(isVip).length,
    };
  }, [guests.data]);

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor((guest) => guest.name ?? guest.phone, {
          id: "guest",
          header: "Гость",
          cell: (info) => <GuestTableIdentity guest={info.row.original} />,
        }),
        column.accessor("last_order_at", {
          header: "Активность",
          sortFn: "datetime",
          cell: (info) => {
            const guest = info.row.original;
            return (
              <div>
                <div className="row-main">{guest.last_order_at ? formatDate(guest.last_order_at) : "заказов нет"}</div>
                <div className="row-sub">{lastActivityLabel(guest)}</div>
              </div>
            );
          },
        }),
        column.accessor("orders_count", {
          header: "Заказы",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => (
            <div className="guest-table-number">
              <strong className="mono">{info.getValue()}</strong>
              <span>{formatPrice(averageCheck(info.row.original))} средний</span>
            </div>
          ),
        }),
        column.accessor("spent_kopecks", {
          header: "Потратил",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => <span className="mono">{formatPrice(info.getValue())}</span>,
        }),
        column.accessor("tier_title", {
          header: "Лояльность",
          cell: (info) => (
            <div>
              <div className="row-main">{info.getValue() || "—"}</div>
              <div className="row-sub">
                {info.row.original.points_balance} баллов · {info.row.original.card_number || "карты нет"}
              </div>
            </div>
          ),
        }),
        column.accessor("feedback_count", {
          header: "Отзывы",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => (
            <div className="guest-table-number">
              <strong className="mono">{info.getValue()}</strong>
              <span>{ratingLabel(info.row.original.average_rating)}</span>
            </div>
          ),
        }),
        column.display({
          id: "status",
          header: "Статус",
          cell: (info) => guestStatus(info.row.original),
        }),
        column.display({
          id: "actions",
          header: "",
          meta: { align: "right" },
          cell: (info) => {
            const guest = info.row.original;
            return (
              <div className="cell-actions">
                <IconButton
                  label="Открыть карточку"
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setCreating(false);
                    setSelectedId(guest.id);
                  }}
                >
                  <Edit3 size={14} aria-hidden />
                </IconButton>
                <IconButton
                  label={guest.is_blocked ? "Разблокировать" : "Заблокировать"}
                  size="xs"
                  variant="danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleBlock.mutate(guest);
                  }}
                >
                  <Ban size={14} aria-hidden />
                </IconButton>
                <IconButton
                  label="Удалить"
                  size="xs"
                  variant="danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDeleteTarget(guest);
                  }}
                >
                  <Trash2 size={14} aria-hidden />
                </IconButton>
              </div>
            );
          },
        }),
      ]),
    [toggleBlock],
  );

  const activeCard = selectedId ? guestCard.data ?? null : null;
  const drawerBusy = create.isPending || update.isPending || toggleBlock.isPending;

  return (
    <div className="guests-layout page-layout-with-drawer" data-drawer-open={creating || selectedId !== null}>
      <div className="page-stack">
        <Section
          title="Гости"
          description="CRM-карточки гостей: покупки, адреса, отзывы, лояльность и ручное управление баллами."
          action={
            <Button
              onClick={() => {
                setSelectedId(null);
                setCreating(true);
              }}
            >
              <Plus size={15} aria-hidden />
              Завести гостя
            </Button>
          }
        >
          <div className="guest-stat-grid">
            <GuestMetric icon={<UserRound size={16} aria-hidden />} label="Гостей" note="по текущему поиску" value={String(stats.total)} />
            <GuestMetric icon={<Award size={16} aria-hidden />} label="Ценные" note="10+ заказов или высокий чек" tone="accent" value={String(stats.vip)} />
            <GuestMetric icon={<TrendingUp size={16} aria-hidden />} label="Оборот" note="по найденным профилям" value={formatPrice(stats.spent)} />
            <GuestMetric icon={<CreditCard size={16} aria-hidden />} label="Средний чек" note={`${stats.orders} заказов`} value={formatPrice(stats.avgCheck)} />
            <GuestMetric icon={<Coins size={16} aria-hidden />} label="Баллы" note="на балансах гостей" tone="accent" value={String(stats.points)} />
            <GuestMetric
              icon={<MessageSquareText size={16} aria-hidden />}
              label="Отзывы"
              note={`${stats.blocked} блокировок`}
              tone={stats.blocked > 0 ? "warn" : "neutral"}
              value={String(stats.feedback)}
            />
          </div>

          <div className="surface-toolbar guests-toolbar">
            <label className="field toolbar-field">
              <span className="field-label">Поиск</span>
              <span className="search-control">
                <Search className="search-icon" size={15} aria-hidden />
                <input
                  className="input"
                  placeholder="Имя, телефон, карта, почта"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </span>
            </label>

            <div className="filter-chips guests-filter-chips" aria-label="Фильтр гостей">
              {FILTERS.map((item) => (
                <button
                  key={item.key}
                  className="filter-chip"
                  data-active={filter === item.key}
                  type="button"
                  onClick={() => setFilter(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <span className="toolbar-spacer" />
            <DensityToggle density={density} onChange={setDensity} />
          </div>

          <DataTable
            columns={columns}
            data={rows}
            density={density}
            empty={
              <div className="empty-state">
                <h2>Гостей не найдено</h2>
                <p>Измените запрос, фильтр или заведите новый профиль вручную.</p>
              </div>
            }
            getRowId={(row) => row.id}
            isLoading={guests.isPending}
            selectedId={selectedId}
            onRowClick={(row) => {
              setCreating(false);
              setSelectedId(row.id);
            }}
          />
        </Section>
      </div>

      {creating || selectedId !== null ? (
        <GuestDrawer
          card={activeCard}
          creating={creating}
          loading={!creating && guestCard.isPending}
          pending={drawerBusy}
          pointsPending={adjustPoints.isPending}
          onAdjustPoints={(guest, points, comment) => adjustPoints.mutate({ comment, guest, points })}
          onClose={() => {
            setCreating(false);
            setSelectedId(null);
          }}
          onCreate={(draft) => create.mutate(draft)}
          onDelete={setDeleteTarget}
          onSave={(card, draft) => update.mutate({ card, draft })}
          onToggleBlock={(guest) => toggleBlock.mutate(guest)}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          busy={remove.isPending}
          message={`Профиль ${deleteTarget.name ?? guestPhoneLabel(deleteTarget.phone)} будет удалён, если у него нет заказов. При наличии истории система предложит заблокировать профиль.`}
          title="Удалить гостя"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => remove.mutate(deleteTarget.id)}
        />
      ) : null}
    </div>
  );
}
