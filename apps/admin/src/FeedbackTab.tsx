import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, MessageSquareText, Search, Star, ThumbsUp, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { api, formatDateTime, type Feedback } from "./api";
import { DataTable, DensityToggle, createAdminColumnHelper, useTableDensity } from "./components/patterns/DataTable";
import { DetailDrawer } from "./components/patterns/DetailDrawer";
import { Badge, Button, Section, Select } from "./ui";

type FeedbackMode = "all" | "critical" | "positive";

const column = createAdminColumnHelper<Feedback>();

function ratingTone(rating: number): "ok" | "warn" | "bad" {
  if (rating <= 2) return "bad";
  if (rating === 3) return "warn";
  return "ok";
}

function priorityLabel(rating: number): string {
  if (rating <= 2) return "Высокий";
  if (rating === 3) return "Средний";
  return "Низкий";
}

function guestName(row: Feedback): string {
  const name = row.guest_name?.trim();
  if (!name || name.toLocaleLowerCase("ru-RU") === "deleted") return "Гость без имени";
  return name;
}

function guestPhone(row: Feedback): string {
  const phone = row.guest_phone.trim();
  if (!phone || phone.toLocaleLowerCase("ru-RU").startsWith("deleted-")) return "Телефон скрыт";
  return phone;
}

function Stars({ rating }: { rating: number }) {
  const tone = ratingTone(rating);

  return (
    <span className="stars" data-tone={tone} aria-label={`${rating} из 5`}>
      {"★".repeat(rating)}
      <span className="stars-empty">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function FeedbackKpi({
  icon,
  label,
  note,
  tone = "neutral",
  value,
}: {
  icon: ReactNode;
  label: string;
  note: string;
  tone?: "neutral" | "ok" | "warn" | "bad";
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

function FeedbackBadge({ rating }: { rating: number }) {
  return <Badge text={`${rating}/5`} tone={ratingTone(rating)} />;
}

export function FeedbackTab() {
  const [density, setDensity] = useTableDensity();
  const [restaurantId, setRestaurantId] = useState("");
  const [mode, setMode] = useState<FeedbackMode>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const restaurants = useQuery({ queryKey: ["restaurants"], queryFn: api.restaurants });
  const rows = useQuery({
    queryKey: ["feedback", restaurantId, mode],
    queryFn: () =>
      api.feedback({
        restaurant_id: restaurantId || undefined,
        max_rating: mode === "critical" ? 3 : undefined,
      }),
  });
  const summary = useQuery({
    queryKey: ["feedback-summary", restaurantId],
    queryFn: () => api.feedbackSummary(restaurantId || undefined),
  });

  const allRows = rows.data ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return allRows.filter((row) => {
      const positive = row.rating >= 4;
      const matchesMode = mode === "all" || (mode === "critical" && row.rating <= 3) || (mode === "positive" && positive);
      const text = `${row.order_number} ${guestName(row)} ${guestPhone(row)} ${row.restaurant_name} ${row.comment ?? ""} ${row.tags.join(" ")}`.toLocaleLowerCase("ru-RU");
      return matchesMode && text.includes(needle);
    });
  }, [allRows, mode, search]);

  const selected = selectedId ? filtered.find((row) => row.id === selectedId) ?? null : null;
  const total = summary.data?.total ?? 0;
  const average = total > 0 ? summary.data?.average.toFixed(2) ?? "—" : "—";
  const critical = [1, 2, 3].reduce((sum, rating) => sum + (summary.data?.by_rating[String(rating)] ?? 0), 0);
  const positive = [4, 5].reduce((sum, rating) => sum + (summary.data?.by_rating[String(rating)] ?? 0), 0);
  const withComment = allRows.filter((row) => row.comment && row.comment.trim().length > 0).length;
  const isLoading = rows.isPending || summary.isPending;

  const restaurantOptions = [
    { label: "Все рестораны", value: "" },
    ...(restaurants.data ?? []).map((item) => ({ label: item.name, value: item.id })),
  ];

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("rating", {
          header: "Оценка",
          sortFn: "basic",
          cell: (info) => (
            <div>
              <div className="feedback-rating-line">
                <Stars rating={info.getValue()} />
                <FeedbackBadge rating={info.getValue()} />
              </div>
              <div className="row-sub">приоритет: {priorityLabel(info.getValue()).toLocaleLowerCase("ru-RU")}</div>
            </div>
          ),
        }),
        column.display({
          id: "order",
          header: "Заказ",
          cell: (info) => {
            const row = info.row.original;
            return (
              <div>
                <div className="row-main">№ {row.order_number}</div>
                <div className="row-sub">{row.restaurant_name}</div>
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
                <div className="row-main">{guestName(row)}</div>
                <div className="row-sub">{guestPhone(row)}</div>
              </div>
            );
          },
        }),
        column.display({
          id: "comment",
          header: "Комментарий",
          cell: (info) => {
            const row = info.row.original;
            return (
              <div className="feedback-comment-cell">
                {row.comment ? row.comment : <span className="row-muted">Без комментария</span>}
                {row.tags.length > 0 ? (
                  <div className="chips-line mt-1">
                    {row.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="mini-chip">
                        {tag}
                      </span>
                    ))}
                    {row.tags.length > 3 ? <span className="row-sub">+{row.tags.length - 3}</span> : null}
                  </div>
                ) : null}
              </div>
            );
          },
        }),
        column.accessor("created_at", {
          header: "Когда",
          sortFn: "datetime",
          cell: (info) => <span className="mono">{formatDateTime(info.getValue())}</span>,
        }),
        column.display({
          id: "actions",
          header: "",
          meta: { align: "right" },
          cell: (info) => (
            <Button
              size="xs"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                setSelectedId(info.row.original.id);
              }}
            >
              Детали
            </Button>
          ),
        }),
      ]),
    [],
  );

  return (
    <div className="page-stack">
      <Section
        title="Отзывы"
        description="Оценки заказов, проблемные сигналы, теги и комментарии гостей."
      >
        <div className="metric-strip">
          <FeedbackKpi
            icon={<Star size={18} aria-hidden />}
            label="Средняя"
            note={total > 0 ? `${total} оценок` : "данных пока нет"}
            value={isLoading ? "..." : average}
          />
          <FeedbackKpi
            icon={<AlertTriangle size={18} aria-hidden />}
            label="Проблемные"
            note="1-3 звезды"
            tone={critical > 0 ? "warn" : "ok"}
            value={isLoading ? "..." : String(critical)}
          />
          <FeedbackKpi
            icon={<ThumbsUp size={18} aria-hidden />}
            label="Хорошие"
            note="4-5 звёзд"
            tone="ok"
            value={isLoading ? "..." : String(positive)}
          />
          <FeedbackKpi
            icon={<MessageSquareText size={18} aria-hidden />}
            label="С текстом"
            note="в текущем списке"
            value={isLoading ? "..." : String(withComment)}
          />
        </div>

        <div className="feedback-overview admin-panel card-pad">
          <div>
            <div className="metric-label">Распределение</div>
            <div className="metric-note">по выбранному ресторану</div>
          </div>
          <div className="rating-bars">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = summary.data?.by_rating[String(star)] ?? 0;
              return (
                <div key={star} className="rating-bar-row">
                  <span className="row-sub">{star} ★</span>
                  <progress
                    aria-label={`${star} звёзд`}
                    className="rating-progress"
                    data-tone={ratingTone(star)}
                    max={Math.max(total, 1)}
                    value={count}
                  />
                  <span className="mono row-sub text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="surface-toolbar">
          <div className="field toolbar-field">
            <span className="field-label">Ресторан</span>
            <Select value={restaurantId} options={restaurantOptions} onChange={setRestaurantId} />
          </div>

          <label className="field toolbar-field">
            <span className="field-label">Поиск</span>
            <span className="search-control">
              <Search className="search-icon" size={15} aria-hidden />
              <input
                className="input"
                placeholder="Заказ, гость, тег"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </span>
          </label>

          <div className="filter-chips" aria-label="Фильтр отзывов">
            <button className="filter-chip" data-active={mode === "all"} type="button" onClick={() => setMode("all")}>
              Все
            </button>
            <button className="filter-chip" data-active={mode === "critical"} type="button" onClick={() => setMode("critical")}>
              Проблемные
            </button>
            <button className="filter-chip" data-active={mode === "positive"} type="button" onClick={() => setMode("positive")}>
              Хорошие
            </button>
          </div>
          <span className="toolbar-spacer" />
          <DensityToggle density={density} onChange={setDensity} />
        </div>

        {rows.error ? (
          <div className="error-state">
            <h2>Не удалось загрузить отзывы</h2>
            <p>Попробуйте обновить страницу или выбрать другой ресторан.</p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filtered}
            density={density}
            getRowId={(row) => row.id}
            isLoading={rows.isPending}
            onRowClick={(row) => setSelectedId(row.id)}
            pageSize={20}
            selectedId={selectedId}
            empty={
              <div className="empty-state">
                <h2>{mode === "critical" ? "Проблемных отзывов нет" : "Отзывов не найдено"}</h2>
                <p>Проверьте ресторан, режим просмотра или поиск.</p>
              </div>
            }
          />
        )}
      </Section>

      {selected ? (
        <DetailDrawer
          badge={<FeedbackBadge rating={selected.rating} />}
          className="feedback-drawer"
          footer={
            <Button variant="ghost" onClick={() => setSelectedId(null)}>
              Закрыть
            </Button>
          }
          subtitle={`${selected.restaurant_name} · ${formatDateTime(selected.created_at)}`}
          title={`Заказ № ${selected.order_number}`}
          onClose={() => setSelectedId(null)}
        >
          <div className="drawer-metrics">
            <div className="drawer-metric">
              <div className="metric-label">Оценка</div>
              <div className="drawer-metric-value">
                <Stars rating={selected.rating} />
              </div>
            </div>
            <div className="drawer-metric">
              <div className="metric-label">Приоритет</div>
              <div className="drawer-metric-value">{priorityLabel(selected.rating)}</div>
            </div>
          </div>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Гость</h3>
            <div className="detail-list">
              <div className="detail-row">
                <span className="detail-label">Имя</span>
                <span>{guestName(selected)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Телефон</span>
                <span>{guestPhone(selected)}</span>
              </div>
            </div>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Комментарий</h3>
            <div className="feedback-message">
              {selected.comment ? (
                <p>{selected.comment}</p>
              ) : (
                <p className="row-muted">Гость оставил только оценку без текста.</p>
              )}
            </div>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Теги</h3>
            {selected.tags.length > 0 ? (
              <div className="chips-line">
                {selected.tags.map((tag) => (
                  <span key={tag} className="mini-chip">
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <div className="row-muted">Теги не выбраны</div>
            )}
          </section>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Заказ</h3>
            <div className="timeline-list">
              <div className="timeline-row">
                <div className="row-main">
                  <MessageSquareText size={14} aria-hidden /> № {selected.order_number}
                </div>
                <div className="row-sub">{selected.restaurant_name}</div>
              </div>
              <div className="timeline-row">
                <div className="row-main">
                  <UserRound size={14} aria-hidden /> {guestName(selected)}
                </div>
                <div className="row-sub">{formatDateTime(selected.created_at)}</div>
              </div>
            </div>
          </section>
        </DetailDrawer>
      ) : null}
    </div>
  );
}
