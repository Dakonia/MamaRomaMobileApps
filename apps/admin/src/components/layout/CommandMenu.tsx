import { useQuery } from "@tanstack/react-query";
import {
  ChefHat,
  Hash,
  Phone,
  Search,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import { usePermissions } from "../../lib/admin-session";
import { formatDateTime, formatPrice } from "../../lib/format";
import { cn } from "../../ui";
import { visibleNavItems, type AdminPath } from "./navigation";

type CommandResult = {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  path: AdminPath;
  onPick?: () => void;
};

function normalize(value: string): string {
  return value.toLocaleLowerCase("ru-RU").trim();
}

export function CommandMenu({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (path: AdminPath) => void;
}) {
  const { can } = usePermissions();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const normalized = normalize(query);

  /**
   * Поиск заказов из строки команд спрашиваем у сервера: раньше сюда тянулась
   * сотня последних и перебиралась на месте, а при двадцати пяти ресторанах
   * нужный заказ в эту сотню просто не попадёт.
   */
  const orders = useQuery({
    queryKey: ["orders", "command", normalized],
    queryFn: () =>
      api.orders({ group: "all", search: normalized, limit: 5, offset: 0 }),
    enabled: open && normalized.length >= 2,
    staleTime: 15_000,
  });

  const dishes = useQuery({
    queryKey: ["dishes", "command"],
    queryFn: api.dishes,
    enabled: open && normalized.length >= 2,
    staleTime: 60_000,
  });

  const guests = useQuery({
    queryKey: ["guests", "command", normalized],
    queryFn: () => api.guests(normalized),
    enabled: open && normalized.length >= 3,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  const results = useMemo<CommandResult[]>(() => {
    const sectionResults = visibleNavItems(can).filter((item) => {
      if (!normalized) return true;
      return (
        normalize(item.label).includes(normalized) ||
        normalize(item.description).includes(normalized)
      );
    }).map((item) => ({
      id: `section:${item.path}`,
      title: item.label,
      subtitle: item.description,
      icon: item.icon,
      path: item.path,
    }));

    const orderResults =
      orders.data?.rows
        .map((order) => ({
          id: `order:${order.id}`,
          title: `Заказ № ${order.number}`,
          subtitle: `${order.restaurant_name} · ${formatDateTime(order.created_at)} · ${formatPrice(order.total_kopecks)}`,
          icon: Hash,
          path: "/orders" as const,
          onPick: () => sessionStorage.setItem("mr.admin.focus-order", order.id),
        })) ?? [];

    const guestResults =
      guests.data?.slice(0, 5).map((guest) => ({
        id: `guest:${guest.id}`,
        title: guest.name ?? guest.phone,
        subtitle: `${guest.phone} · ${guest.orders_count} заказов · ${formatPrice(guest.spent_kopecks)}`,
        icon: guest.name ? UserRound : Phone,
        path: "/guests" as const,
        onPick: () => sessionStorage.setItem("mr.admin.focus-guest", guest.id),
      })) ?? [];

    const dishResults =
      dishes.data
        ?.filter((dish) => normalize(dish.name).includes(normalized))
        .slice(0, 5)
        .map((dish) => ({
          id: `dish:${dish.id}`,
          title: dish.name,
          subtitle: `${formatPrice(dish.price_kopecks)} · ${dish.is_active ? "в меню" : "скрыто"}`,
          icon: ChefHat,
          path: "/menu" as const,
          onPick: () => sessionStorage.setItem("mr.admin.focus-dish", dish.id),
        })) ?? [];

    return [...sectionResults.slice(0, normalized ? 6 : 13), ...orderResults, ...guestResults, ...dishResults];
  }, [can, dishes.data, guests.data, normalized, orders.data]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const pick = (item: CommandResult) => {
    item.onPick?.();
    onNavigate(item.path);
    onClose();
  };

  return (
    <>
      <div className="command-overlay" onClick={onClose} />
      <div
        aria-label="Быстрый поиск"
        aria-modal="true"
        className="command-dialog"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="command-input-wrap">
          <Search size={18} aria-hidden />
          <input
            autoFocus
            placeholder="Раздел, заказ, гость, блюдо"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onClose();
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((value) => Math.min(value + 1, Math.max(results.length - 1, 0)));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((value) => Math.max(value - 1, 0));
              }
              if (event.key === "Enter" && results[activeIndex]) {
                event.preventDefault();
                pick(results[activeIndex]);
              }
            }}
          />
          <kbd className="kbd">Esc</kbd>
        </div>

        <div className="command-list">
          {results.length === 0 ? (
            <div className="command-empty">По этому запросу ничего нет</div>
          ) : (
            results.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={cn("command-item")}
                  data-active={index === activeIndex}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(item)}
                >
                  <Icon size={16} aria-hidden />
                  <span>
                    <span>{item.title}</span>
                    <small>{item.subtitle}</small>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
