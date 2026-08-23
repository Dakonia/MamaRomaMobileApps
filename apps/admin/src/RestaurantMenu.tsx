import { useEffect, useMemo, useState } from "react";

import { api, ApiError, formatPrice, type RestaurantDish } from "./api";
import { Badge, Button, c, radius, spacing, styles, typography } from "./ui";

type Props = {
  restaurantId: string;
  restaurantName: string;
  onClose: () => void;
};

/**
 * Меню конкретного ресторана: своя цена и продаётся ли блюдо в этой точке.
 * Пустая цена означает «как у сети» — строка-исключение тогда не хранится.
 */
export function RestaurantMenu({ restaurantId, restaurantName, onClose }: Props) {
  const [rows, setRows] = useState<RestaurantDish[]>([]);
  const [search, setSearch] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busyDish, setBusyDish] = useState<string | null>(null);

  const load = async () => {
    try {
      setRows(await api.restaurantMenu(restaurantId));
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось загрузить меню");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  // Стоп-лист — состояние на сегодня: блюдо остаётся в меню приложения,
  // но с подписью «закончилось». Снятое с продажи гость вообще не видит
  const toggleStop = async (dish: RestaurantDish) => {
    setBusyDish(dish.dish_id);
    setFailure(null);
    try {
      if (dish.in_stop_list) {
        const entries = await api.stopList();
        const entry = entries.find(
          (row) => row.dish_id === dish.dish_id && row.restaurant_id === restaurantId,
        );
        if (entry) await api.removeStop(entry.id);
      } else {
        await api.addStop(restaurantId, dish.dish_id);
      }

      setRows((current) =>
        current.map((row) =>
          row.dish_id === dish.dish_id ? { ...row, in_stop_list: !row.in_stop_list } : row,
        ),
      );
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось изменить стоп-лист");
    } finally {
      setBusyDish(null);
    }
  };

  const save = async (dish: RestaurantDish, price: number | null, available: boolean) => {
    setBusyDish(dish.dish_id);
    setFailure(null);
    try {
      const saved = await api.setRestaurantDish(restaurantId, {
        dish_id: dish.dish_id,
        price_kopecks: price,
        is_available: available,
      });
      setRows((current) =>
        current.map((row) =>
          row.dish_id === dish.dish_id ? { ...saved, in_stop_list: row.in_stop_list } : row,
        ),
      );
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось сохранить");
    } finally {
      setBusyDish(null);
    }
  };

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(query) || row.category_name.toLowerCase().includes(query),
    );
  }, [rows, search]);

  const changed = rows.filter(
    (row) => !row.is_available || row.price_kopecks !== row.base_price_kopecks,
  ).length;

  return (
    <div style={{ ...styles.card, padding: spacing.lg, display: "grid", gap: spacing.base }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: typography.h3.fontSize, fontWeight: 600 }}>
            Меню: {restaurantName}
          </div>
          <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
            Блюд {rows.length}, отличий от общего меню {changed}
          </div>
        </div>
        <Button tone="quiet" onClick={onClose}>
          Закрыть
        </Button>
      </div>

      <input
        style={{ ...styles.input, maxWidth: 360 }}
        placeholder="Поиск по блюду или категории"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {failure ? <div style={{ color: c.danger }}>{failure}</div> : null}

      <div style={{ maxHeight: 520, overflowY: "auto", borderRadius: radius.md }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Блюдо</th>
              <th style={styles.th}>Цена сети</th>
              <th style={styles.th}>Цена здесь</th>
              <th style={styles.th}>Продаётся</th>
              <th style={styles.th}>Закончилось сегодня</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((dish) => (
              <tr key={dish.dish_id}>
                <td style={styles.td}>
                  <div style={{ fontWeight: 600 }}>{dish.name}</div>
                  <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                    {dish.category_name}
                    {dish.in_stop_list ? " · " : ""}
                    {dish.in_stop_list ? <Badge text="в стоп-листе" tone="warn" /> : null}
                  </div>
                </td>

                <td style={{ ...styles.td, color: c.textSecondary }}>
                  {formatPrice(dish.base_price_kopecks)}
                </td>

                <td style={styles.td}>
                  <input
                    style={{ ...styles.input, width: 110 }}
                    inputMode="numeric"
                    disabled={busyDish === dish.dish_id}
                    value={Math.round(dish.price_kopecks / 100)}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((row) =>
                          row.dish_id === dish.dish_id
                            ? {
                                ...row,
                                price_kopecks:
                                  Number(event.target.value.replace(/\D/g, "") || 0) * 100,
                              }
                            : row,
                        ),
                      )
                    }
                    onBlur={() => void save(dish, dish.price_kopecks, dish.is_available)}
                  />
                </td>

                <td style={styles.td}>
                  <label style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
                    <input
                      type="checkbox"
                      checked={dish.is_available}
                      disabled={busyDish === dish.dish_id}
                      onChange={(event) =>
                        void save(dish, dish.price_kopecks, event.target.checked)
                      }
                    />
                    <span style={{ color: dish.is_available ? c.textPrimary : c.textTertiary }}>
                      {dish.is_available ? "да" : "нет"}
                    </span>
                  </label>
                </td>

                <td style={styles.td}>
                  <label style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
                    <input
                      type="checkbox"
                      checked={dish.in_stop_list}
                      disabled={busyDish === dish.dish_id || !dish.is_available}
                      onChange={() => void toggleStop(dish)}
                    />
                    <span style={{ color: dish.in_stop_list ? c.warning : c.textTertiary }}>
                      {dish.in_stop_list ? "в стоп-листе" : "есть"}
                    </span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
