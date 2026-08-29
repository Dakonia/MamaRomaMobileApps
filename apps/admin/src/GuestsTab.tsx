import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Edit3, Plus, Search, Trash2, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  formatDate,
  formatDateTime,
  formatPrice,
  type Guest,
  type GuestCard,
} from "./api";
import { ConfirmDialog } from "./components/patterns/ConfirmDialog";
import { DataTable, DensityToggle, createAdminColumnHelper, useTableDensity } from "./components/patterns/DataTable";
import { DetailDrawer } from "./components/patterns/DetailDrawer";
import { Badge, Button, IconButton, Section, Select } from "./ui";

type GuestFilter = "all" | "vip" | "blocked";
type GuestDraft = {
  birthday: string;
  email: string;
  gender: "male" | "female" | "";
  name: string;
  phone: string;
};

const column = createAdminColumnHelper<Guest>();

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
  earn: "Начисление",
  expire: "Сгорание",
  manual: "Вручную",
  spend: "Списание",
};

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

function guestStatus(guest: Guest) {
  if (guest.is_blocked) return <Badge text="заблокирован" tone="bad" />;
  if (guest.orders_count >= 10 || guest.spent_kopecks >= 5000000) return <Badge text="ценный" tone="accent" />;
  return <Badge text="активен" tone="ok" />;
}

function DrawerMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="drawer-metric">
      <div className="metric-label">{label}</div>
      <div className="drawer-metric-value">{value}</div>
    </div>
  );
}

function GuestDrawer({
  card,
  creating,
  loading,
  onClose,
  onCreate,
  onDelete,
  onSave,
  onToggleBlock,
  pending,
}: {
  card: GuestCard | null;
  creating: boolean;
  loading: boolean;
  onClose: () => void;
  onCreate: (draft: GuestDraft) => void;
  onDelete: (guest: Guest) => void;
  onSave: (card: GuestCard, draft: GuestDraft) => void;
  onToggleBlock: (guest: Guest) => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState<GuestDraft>(() => toDraft(card));

  useEffect(() => {
    setDraft(toDraft(card));
  }, [card]);

  const set = <K extends keyof GuestDraft>(key: K, value: GuestDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const title = creating ? "Новый гость" : card?.guest.name ?? card?.guest.phone ?? "Гость";
  const canSubmit = draft.phone.trim().length >= 10 && (creating || card !== null);

  return (
    <DetailDrawer
      badge={!creating && card ? guestStatus(card.guest) : undefined}
      footer={
        <>
          {!creating && card ? (
            <>
              <Button disabled={pending} variant="danger" onClick={() => onToggleBlock(card.guest)}>
                <Ban size={15} aria-hidden />
                {card.guest.is_blocked ? "Разблокировать" : "Заблокировать"}
              </Button>
              <Button disabled={pending} variant="danger" onClick={() => onDelete(card.guest)}>
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
            {pending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </>
      }
      subtitle={creating ? "Создание профиля для заказов и лояльности" : card?.guest.phone}
      title={title}
      onClose={onClose}
    >
      {loading ? (
        <div className="page-stack">
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      ) : (
        <div className="drawer-form">
          {!creating && card ? (
            <div className="drawer-metrics">
              <DrawerMetric label="Заказов" value={String(card.guest.orders_count)} />
              <DrawerMetric label="Потратил" value={formatPrice(card.guest.spent_kopecks)} />
              <DrawerMetric label="Уровень" value={card.guest.tier_title || "—"} />
              <DrawerMetric label="Баллы" value={String(card.guest.points_balance)} />
            </div>
          ) : null}

          <section className="drawer-section">
            <h3 className="drawer-section-title">Данные</h3>
            <div className="drawer-form-grid">
              <label className="field">
                <span className="field-label">Телефон</span>
                <input
                  className="input"
                  disabled={!creating}
                  placeholder="+7 999 123-45-67"
                  value={draft.phone}
                  onChange={(event) => set("phone", event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Имя</span>
                <input
                  className="input"
                  placeholder="Имя гостя"
                  value={draft.name}
                  onChange={(event) => set("name", event.target.value)}
                />
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
                <input
                  className="input"
                  type="date"
                  value={draft.birthday}
                  onChange={(event) => set("birthday", event.target.value)}
                />
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
          </section>

          {!creating && card ? (
            <>
              <section className="drawer-section">
                <h3 className="drawer-section-title">Адреса</h3>
                {card.addresses.length === 0 ? (
                  <div className="row-muted">Гость пока не сохранял адреса</div>
                ) : (
                  <div className="timeline-list">
                    {card.addresses.map((address) => (
                      <div key={address.id} className="timeline-row">
                        <div className="row-main">
                          {address.title ?? "Адрес"} {address.is_default ? <Badge text="основной" tone="ok" /> : null}
                        </div>
                        <div className="row-sub">
                          {address.locality ? `${address.locality}, ` : ""}
                          {address.full_text}
                        </div>
                        {address.metro ? <div className="row-sub">м. {address.metro}</div> : null}
                        {address.comment ? <div className="row-sub">{address.comment}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="drawer-section">
                <h3 className="drawer-section-title">Заказы</h3>
                {card.orders.length === 0 ? (
                  <div className="row-muted">Заказов ещё не было</div>
                ) : (
                  <div className="timeline-list">
                    {card.orders.map((order) => (
                      <div key={order.id} className="timeline-row">
                        <div className="order-card-top">
                          <span className="order-number">№ {order.number}</span>
                          <strong className="mono">{formatPrice(order.total_kopecks)}</strong>
                        </div>
                        <div className="row-sub">
                          {formatDateTime(order.created_at)} · {ORDER_TYPE[order.type] ?? order.type}
                        </div>
                        <div className="row-sub">{order.address_text ?? order.restaurant_name}</div>
                        <div className="chips-line">
                          <span className="mini-chip">{ORDER_STATUS[order.status] ?? order.status}</span>
                          {order.items.slice(0, 3).map((item) => (
                            <span key={item} className="mini-chip">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="drawer-section">
                <h3 className="drawer-section-title">Брони</h3>
                {card.reservations.length === 0 ? (
                  <div className="row-muted">Столы не бронировал</div>
                ) : (
                  <div className="timeline-list">
                    {card.reservations.map((reservation) => (
                      <div key={reservation.id} className="timeline-row">
                        <div className="row-main">{formatDateTime(reservation.reserved_at)}</div>
                        <div className="row-sub">
                          {reservation.restaurant_name} · {reservation.guests_count} гост.
                        </div>
                        <div className="chips-line">
                          <span className="mini-chip">{RESERVATION_STATUS[reservation.status] ?? reservation.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="drawer-section">
                <h3 className="drawer-section-title">Баллы</h3>
                {card.points.length === 0 ? (
                  <div className="row-muted">Операций не было</div>
                ) : (
                  <div className="timeline-list">
                    {card.points.map((row, index) => (
                      <div key={`${row.created_at}-${index}`} className="timeline-row">
                        <div className="order-card-top">
                          <span className="row-main">{POINTS_OPERATION[row.operation] ?? row.operation}</span>
                          <strong className={row.points < 0 ? "text-[var(--bad)] mono" : "text-[var(--ok)] mono"}>
                            {row.points > 0 ? `+${row.points}` : row.points}
                          </strong>
                        </div>
                        <div className="row-sub">{formatDateTime(row.created_at)}</div>
                        {row.comment ? <div className="row-sub">{row.comment}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      )}
    </DetailDrawer>
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
      if (filter === "vip") return guest.orders_count >= 10 || guest.spent_kopecks >= 5000000;
      return true;
    });
  }, [filter, guests.data]);

  const stats = useMemo(() => {
    const list = guests.data ?? [];
    return {
      blocked: list.filter((guest) => guest.is_blocked).length,
      orders: list.reduce((sum, guest) => sum + guest.orders_count, 0),
      spent: list.reduce((sum, guest) => sum + guest.spent_kopecks, 0),
      total: list.length,
    };
  }, [guests.data]);

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor((guest) => guest.name ?? guest.phone, {
          id: "guest",
          header: "Гость",
          cell: (info) => {
            const guest = info.row.original;
            return (
              <div>
                <div className="row-main">
                  {guest.name ?? "Без имени"} {guest.is_blocked ? <Badge text="стоп" tone="bad" /> : null}
                </div>
                <div className="row-sub">
                  {guest.phone}
                  {guest.email ? ` · ${guest.email}` : ""}
                </div>
              </div>
            );
          },
        }),
        column.accessor("created_at", {
          header: "Регистрация",
          sortFn: "datetime",
          cell: (info) => (
            <div>
              <div className="row-main">{formatDate(info.getValue())}</div>
              <div className="row-sub">{info.row.original.last_seen_at ? `заходил ${formatDate(info.row.original.last_seen_at)}` : "нет входов"}</div>
            </div>
          ),
        }),
        column.accessor("orders_count", {
          header: "Заказы",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => <span className="mono">{info.getValue()}</span>,
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
              <div className="row-sub">{info.row.original.points_balance} баллов</div>
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
                  label="Открыть"
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
    <div className="page-layout-with-drawer" data-drawer-open={creating || selectedId !== null}>
      <div className="page-stack">
        <Section
          title="Гости"
          description="Серверный поиск по гостям, история, лояльность и управление доступом."
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
          <div className="metric-strip">
            <div className="metric-card">
              <div className="metric-label">Найдено</div>
              <div className="metric-value">{stats.total}</div>
              <div className="metric-note">по текущему поиску</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Заказы</div>
              <div className="metric-value">{stats.orders}</div>
              <div className="metric-note">суммарно у гостей</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Оборот</div>
              <div className="metric-value">{formatPrice(stats.spent)}</div>
              <div className="metric-note">по найденным профилям</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Блокировки</div>
              <div className="metric-value">{stats.blocked}</div>
              <div className="metric-note">нужен контроль</div>
            </div>
          </div>

          <div className="surface-toolbar">
            <label className="field toolbar-field">
              <span className="field-label">Поиск</span>
              <span className="search-control">
                <Search className="search-icon" size={15} aria-hidden />
                <input
                  className="input"
                  placeholder="Поиск гостя"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </span>
            </label>

            <div className="filter-chips" aria-label="Фильтр гостей">
              {[
                ["all", "Все"],
                ["vip", "Ценные"],
                ["blocked", "Блокировки"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className="filter-chip"
                  data-active={filter === key}
                  type="button"
                  onClick={() => setFilter(key as GuestFilter)}
                >
                  {label}
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
                <p>Измените запрос или заведите новый профиль вручную.</p>
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
          message={`Профиль ${deleteTarget.name ?? deleteTarget.phone} будет удалён вместе с сохранёнными данными.`}
          title="Удалить гостя"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => remove.mutate(deleteTarget.id)}
        />
      ) : null}
    </div>
  );
}
