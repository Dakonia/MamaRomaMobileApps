import { useQuery } from "@tanstack/react-query";
import { radius, spacing, typography } from "@mr/design-tokens";
import { useState } from "react";

import { api, formatDateTime, type Feedback } from "./api";
import { Button, c, Section, styles } from "./ui";

/** Звёзды в строке таблицы: цифру видно, но взгляд цепляется за форму. */
function Stars({ rating }: { rating: number }) {
  return (
    <span
      style={{
        color: rating <= 2 ? c.danger : rating === 3 ? c.warning : c.success,
        letterSpacing: 1,
        whiteSpace: "nowrap",
      }}
      title={`${rating} из 5`}
    >
      {"★".repeat(rating)}
      <span style={{ color: c.border }}>{"★".repeat(5 - rating)}</span>
    </span>
  );
}

/**
 * Отзывы о доставленных заказах.
 *
 * Публичного рейтинга у сети нет — эти оценки видит только персонал, поэтому
 * здесь важнее не среднее число, а возможность быстро выцепить недовольных.
 */
export function FeedbackTab() {
  const [restaurantId, setRestaurantId] = useState("");
  const [onlyBad, setOnlyBad] = useState(false);

  const restaurants = useQuery({ queryKey: ["restaurants"], queryFn: api.restaurants });

  const filters = {
    restaurant_id: restaurantId || undefined,
    max_rating: onlyBad ? 3 : undefined,
  };

  const rows = useQuery({
    queryKey: ["feedback", filters],
    queryFn: () => api.feedback(filters),
  });

  const summary = useQuery({
    queryKey: ["feedback-summary", restaurantId],
    queryFn: () => api.feedbackSummary(restaurantId || undefined),
  });

  const total = summary.data?.total ?? 0;

  return (
    <>
      <Section title="Оценки гостей">
        <div style={{ display: "flex", gap: spacing.xl, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 42, fontWeight: 700, lineHeight: 1.1, color: c.textPrimary }}>
              {total > 0 ? summary.data?.average.toFixed(2) : "—"}
            </div>
            <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
              {total > 0 ? `${total} оценок` : "Пока никто не оценил"}
            </div>
          </div>

          {/* Раскладка по звёздам: одна жалоба среди сотни хороших не тонет */}
          <div style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: 4 }}>
            {[5, 4, 3, 2, 1].map((star) => {
              const count = summary.data?.by_rating[String(star)] ?? 0;
              const share = total > 0 ? (count / total) * 100 : 0;

              return (
                <div key={star} style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
                  <span style={{ width: 34, color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                    {star} ★
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 8,
                      borderRadius: radius.pill,
                      background: c.surfaceSunken,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${share}%`,
                        height: "100%",
                        background: star <= 2 ? c.danger : star === 3 ? c.warning : c.success,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      width: 34,
                      textAlign: "right",
                      color: c.textSecondary,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </Section>

      <Section
        title="Отзывы"
        action={
          <div style={{ display: "flex", gap: spacing.sm, alignItems: "center" }}>
            <select
              style={styles.input}
              value={restaurantId}
              onChange={(event) => setRestaurantId(event.target.value)}
            >
              <option value="">Все рестораны</option>
              {(restaurants.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>

            <Button tone={onlyBad ? "brand" : "quiet"} onClick={() => setOnlyBad(!onlyBad)}>
              Только жалобы
            </Button>
          </div>
        }
      >
        {rows.isPending ? (
          <p style={{ color: c.textSecondary }}>Загружаем…</p>
        ) : (rows.data ?? []).length === 0 ? (
          <p style={{ color: c.textSecondary }}>
            {onlyBad ? "Жалоб нет — и хорошо" : "Отзывов пока нет"}
          </p>
        ) : (
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Оценка</th>
                  <th style={styles.th}>Заказ</th>
                  <th style={styles.th}>Гость</th>
                  <th style={styles.th}>Что отметил</th>
                  <th style={styles.th}>Когда</th>
                </tr>
              </thead>
              <tbody>
                {(rows.data ?? []).map((row: Feedback) => (
                  <tr key={row.id}>
                    <td style={styles.td}>
                      <Stars rating={row.rating} />
                    </td>
                    <td style={styles.td}>
                      <div style={{ fontWeight: 600 }}>№ {row.order_number}</div>
                      <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                        {row.restaurant_name}
                      </div>
                    </td>
                    <td style={styles.td}>
                      <div>{row.guest_name ?? "Без имени"}</div>
                      <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                        {row.guest_phone}
                      </div>
                    </td>
                    <td style={{ ...styles.td, maxWidth: 380 }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {row.tags.map((tag) => (
                          <span
                            key={tag}
                            style={{
                              padding: "2px 8px",
                              borderRadius: radius.pill,
                              background: c.surfaceSunken,
                              color: c.textSecondary,
                              fontSize: typography.caption.fontSize,
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      {row.comment ? (
                        <div style={{ marginTop: row.tags.length > 0 ? spacing.xs : 0 }}>
                          {row.comment}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ ...styles.td, color: c.textSecondary, whiteSpace: "nowrap" }}>
                      {formatDateTime(row.created_at)}
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
