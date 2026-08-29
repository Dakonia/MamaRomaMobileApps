import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Search, Utensils } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { api, ApiError, formatPrice, type RestaurantDish } from "./api";
import { DataTable, DensityToggle, createAdminColumnHelper, useTableDensity } from "./components/patterns/DataTable";
import { Badge, Button, Section } from "./ui";

type Props = {
  restaurantId: string;
  restaurantName: string;
  onClose: () => void;
};

const column = createAdminColumnHelper<RestaurantDish>();

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

export function RestaurantMenu({ restaurantId, restaurantName, onClose }: Props) {
  const queryClient = useQueryClient();
  const [density, setDensity] = useTableDensity();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<RestaurantDish[]>([]);
  const [busyDish, setBusyDish] = useState<string | null>(null);

  const menu = useQuery({
    queryKey: ["restaurant-menu", restaurantId],
    queryFn: () => api.restaurantMenu(restaurantId),
  });

  useEffect(() => {
    setRows(menu.data ?? []);
  }, [menu.data]);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["restaurant-menu", restaurantId] });

  const saveDish = useMutation({
    mutationFn: (dish: RestaurantDish) =>
      api.setRestaurantDish(restaurantId, {
        dish_id: dish.dish_id,
        is_available: dish.is_available,
        price_kopecks: dish.price_kopecks,
      }),
    onMutate: (dish) => setBusyDish(dish.dish_id),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => setBusyDish(null),
    onSuccess: (saved) => {
      setRows((current) =>
        current.map((row) =>
          row.dish_id === saved.dish_id ? { ...saved, in_stop_list: row.in_stop_list } : row,
        ),
      );
      invalidate();
    },
  });

  const toggleStop = useMutation({
    mutationFn: async (dish: RestaurantDish) => {
      if (dish.in_stop_list) {
        const entries = await api.stopList();
        const entry = entries.find(
          (row) => row.dish_id === dish.dish_id && row.restaurant_id === restaurantId,
        );
        if (entry) await api.removeStop(entry.id);
        return { dishId: dish.dish_id, inStopList: false };
      }

      await api.addStop(restaurantId, dish.dish_id);
      return { dishId: dish.dish_id, inStopList: true };
    },
    onMutate: (dish) => setBusyDish(dish.dish_id),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => setBusyDish(null),
    onSuccess: ({ dishId, inStopList }) => {
      setRows((current) =>
        current.map((row) => (row.dish_id === dishId ? { ...row, in_stop_list: inStopList } : row)),
      );
      toast.success(inStopList ? "Блюдо добавлено в стоп-лист" : "Блюдо вернули в продажу");
    },
  });

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return rows.filter((row) =>
      `${row.name} ${row.category_name}`.toLocaleLowerCase("ru-RU").includes(needle),
    );
  }, [rows, search]);

  const changed = rows.filter(
    (row) => !row.is_available || row.price_kopecks !== row.base_price_kopecks,
  ).length;
  const stopped = rows.filter((row) => row.in_stop_list).length;
  const unavailable = rows.filter((row) => !row.is_available).length;
  const categories = new Set(rows.map((row) => row.category_name)).size;

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("name", {
          header: "Блюдо",
          cell: (info) => {
            const dish = info.row.original;
            return (
              <div>
                <div className="row-main">{info.getValue()}</div>
                <div className="row-sub">
                  {dish.category_name}
                  {dish.in_stop_list ? " · " : ""}
                  {dish.in_stop_list ? <Badge text="стоп-лист" tone="warn" /> : null}
                </div>
              </div>
            );
          },
        }),
        column.accessor("base_price_kopecks", {
          header: "Цена сети",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => <span className="mono">{formatPrice(info.getValue())}</span>,
        }),
        column.accessor("price_kopecks", {
          header: "Цена здесь",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => {
            const dish = info.row.original;
            return (
              <input
                className="input table-price-input"
                disabled={busyDish === dish.dish_id}
                inputMode="numeric"
                value={Math.round(info.getValue() / 100)}
                onBlur={() => saveDish.mutate(dish)}
                onChange={(event) =>
                  setRows((current) =>
                    current.map((row) =>
                      row.dish_id === dish.dish_id
                        ? { ...row, price_kopecks: Number(event.target.value.replace(/\D/g, "") || 0) * 100 }
                        : row,
                    ),
                  )
                }
              />
            );
          },
        }),
        column.accessor("is_available", {
          header: "Продаётся",
          cell: (info) => {
            const dish = info.row.original;
            return (
              <label className="inline-check">
                <input
                  checked={info.getValue()}
                  disabled={busyDish === dish.dish_id}
                  type="checkbox"
                  onChange={(event) => saveDish.mutate({ ...dish, is_available: event.target.checked })}
                />
                {info.getValue() ? "да" : "нет"}
              </label>
            );
          },
        }),
        column.accessor("in_stop_list", {
          header: "Сегодня",
          cell: (info) => {
            const dish = info.row.original;
            return (
              <label className="inline-check">
                <input
                  checked={info.getValue()}
                  disabled={busyDish === dish.dish_id || !dish.is_available}
                  type="checkbox"
                  onChange={() => toggleStop.mutate(dish)}
                />
                {info.getValue() ? "закончилось" : "есть"}
              </label>
            );
          },
        }),
      ]),
    [busyDish, saveDish, toggleStop],
  );

  return (
    <article className="split-detail">
      <div className="section-head">
        <div>
          <h2 className="section-title">Меню точки</h2>
          <p className="section-copy">{restaurantName}</p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          <ArrowLeft size={15} aria-hidden />
          К карточке
        </Button>
      </div>

      <div className="metric-strip">
        <div className="metric-card">
          <div className="metric-label">Блюд</div>
          <div className="metric-value">{rows.length}</div>
          <div className="metric-note">в меню точки</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Отличий</div>
          <div className="metric-value">{changed}</div>
          <div className="metric-note">цена или доступность</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Стоп-лист</div>
          <div className="metric-value">{stopped}</div>
          <div className="metric-note">закончилось сегодня</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Разделов</div>
          <div className="metric-value">{categories}</div>
          <div className="metric-note">{unavailable > 0 ? `${unavailable} скрыто` : "всё продаётся"}</div>
        </div>
      </div>

      <Section title="Позиции">
        <div className="surface-toolbar">
          <label className="field toolbar-field">
            <span className="field-label">Поиск</span>
            <span className="search-control">
              <Search className="search-icon" size={15} aria-hidden />
              <input
                className="input"
                placeholder="Поиск позиции"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </span>
          </label>
          <DensityToggle density={density} onChange={setDensity} />
        </div>

        {menu.error ? (
          <div className="error-state">
            <h2>Не удалось загрузить меню</h2>
            <p>{errorMessage(menu.error)}</p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={visible}
            density={density}
            getRowId={(row) => row.dish_id}
            isLoading={menu.isPending}
            pageSize={20}
            empty={
              <div className="empty-state">
                <Utensils size={20} aria-hidden />
                <h2>Ничего не найдено</h2>
                <p>Проверьте поиск по названию блюда или разделу меню.</p>
              </div>
            }
          />
        )}
      </Section>
    </article>
  );
}
