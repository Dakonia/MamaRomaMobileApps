import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { track, trackCartAdd, trackCartRemove } from '@/lib/analytics';
import type { SoldItem } from '@/lib/analytics';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Dish } from '@/api/client';

export type CartExtra = { id: string; name: string; priceKopecks: number };

export type CartItem = {
  /** Ключ строки: блюдо плюс выбранные добавки — одна пицца может лежать дважды */
  key: string;
  dishId: string;
  name: string;
  /** Цена блюда без добавок */
  priceKopecks: number;
  extras: CartExtra[];
  quantity: number;
};

/** Цена одной порции вместе с добавками. */
export function itemPrice(item: CartItem): number {
  const extras = item.extras ?? [];
  return item.priceKopecks + extras.reduce((sum, extra) => sum + extra.priceKopecks, 0);
}

/** Строка корзины в виде, который уходит в товарные отчёты аналитики. */
export function soldItem(item: CartItem, quantity = item.quantity): SoldItem {
  return { sku: item.dishId, name: item.name, priceKopecks: itemPrice(item), quantity };
}

/** Один и тот же набор добавок даёт один ключ независимо от порядка выбора. */
export function lineKey(dishId: string, extras: CartExtra[]): string {
  return [dishId, ...extras.map((extra) => extra.id).sort()].join(':');
}

/** Доставка или самовывоз: от этого зависит, как выбирается ресторан. */
export type OrderMode = 'delivery' | 'pickup';

/** Что изменилось в корзине при переезде в другой ресторан. */
export type CartMoveReport = {
  /** Блюда, которых в новом ресторане нет: из корзины их не выбрасываем */
  unavailable: string[];
  repriced: { name: string; from: number; to: number }[];
};

type CartState = {
  mode: OrderMode;
  restaurantId: string | null;
  // Адрес, по которому определён ресторан доставки
  addressId: string | null;
  // Откуда гость забирал в прошлый раз: на самовывозе подставляем его сразу
  pickupRestaurantId: string | null;
  items: CartItem[];
  setMode: (mode: OrderMode) => void;
  selectPickup: (restaurantId: string) => void;
  selectAddress: (addressId: string | null) => void;
  selectRestaurant: (restaurantId: string | null) => void;
  /** Переносит корзину в меню нового ресторана и рассказывает, что изменилось. */
  moveTo: (restaurantId: string, menu: Dish[]) => CartMoveReport;
  dropItems: (keys: string[]) => void;
  /** Докинуть добавку к части порций строки: остальные останутся без неё. */
  addExtra: (key: string, portions: number, extra: CartExtra) => void;
  add: (dish: Dish, extras?: CartExtra[]) => void;
  /** Собрать корзину заново по прошлому заказу. */
  repeat: (restaurantId: string, items: CartItem[]) => void;
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
  /** Полный сброс при смене гостя: чужой адрес и ресторан оставлять нельзя. */
  reset: () => void;
};

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      mode: 'delivery',
      restaurantId: null,
      addressId: null,
      pickupRestaurantId: null,
      items: [],

      setMode: (mode) => set({ mode }),
      selectPickup: (restaurantId) =>
        set({ pickupRestaurantId: restaurantId, restaurantId }),
      selectAddress: (addressId) => set({ addressId }),

      // Простая смена ресторана без сверки меню: корзину не трогаем,
      // сверку делает moveTo, когда меню нового ресторана уже загружено
      selectRestaurant: (restaurantId) =>
        set((state) => (state.restaurantId === restaurantId ? state : { restaurantId })),

      moveTo: (restaurantId, menu) => {
        const report: CartMoveReport = { unavailable: [], repriced: [] };
        const prices = new Map(menu.map((dish) => [dish.id, dish]));

        set((state) => {
          const items = state.items.map((item) => {
            const dish = prices.get(item.dishId);

            // Ничего не удаляем молча: гость сам решает, что делать с блюдом,
            // которого здесь не готовят. Экран покажет его отдельной меткой
            if (!dish || dish.is_available === false) {
              report.unavailable.push(item.name);
              return item;
            }

            if (dish.price_kopecks !== item.priceKopecks) {
              report.repriced.push({
                name: item.name,
                from: item.priceKopecks,
                to: dish.price_kopecks,
              });
            }

            return { ...item, name: dish.name, priceKopecks: dish.price_kopecks };
          });

          return { restaurantId, items };
        });

        return report;
      },

      addExtra: (key, portions, extra) =>
        set((state) => {
          const line = state.items.find((item) => item.key === key);
          if (line === undefined || line.extras.some((row) => row.id === extra.id)) return state;

          const count = Math.max(1, Math.min(portions, line.quantity));
          const extras = [...line.extras, extra];
          const nextKey = lineKey(line.dishId, extras);

          // Часть порций остаётся без добавки — строка делится надвое
          const items = state.items
            .map((item) => (item.key === key ? { ...item, quantity: line.quantity - count } : item))
            .filter((item) => item.quantity > 0);

          const twin = items.find((item) => item.key === nextKey);
          if (twin !== undefined) {
            return {
              items: items.map((item) =>
                item.key === nextKey ? { ...item, quantity: item.quantity + count } : item,
              ),
            };
          }

          const withExtra = { ...line, key: nextKey, extras, quantity: count };
          const at = items.findIndex((item) => item.key === key);

          return {
            items:
              at >= 0
                ? [...items.slice(0, at + 1), withExtra, ...items.slice(at + 1)]
                : [...items, withExtra],
          };
        }),

      /** Убрать из корзины всё, что сейчас недоступно. */
      dropItems: (keys) =>
        set((state) => {
          for (const item of state.items) {
            if (keys.includes(item.key)) trackCartRemove(soldItem(item));
          }

          return { items: state.items.filter((item) => !keys.includes(item.key)) };
        }),

      add: (dish, extras = []) =>
        set((state) => {
          const withExtras =
            dish.price_kopecks + extras.reduce((sum, extra) => sum + extra.priceKopecks, 0);

          track('dish_added', {
            dish: dish.name,
            price: Math.round(dish.price_kopecks / 100),
            extras: extras.length,
          });

          trackCartAdd({ sku: dish.id, name: dish.name, priceKopecks: withExtras, quantity: 1 });

          const key = lineKey(dish.id, extras);
          const existing = state.items.find((item) => item.key === key);

          if (existing) {
            return {
              items: state.items.map((item) =>
                item.key === key ? { ...item, quantity: item.quantity + 1 } : item,
              ),
            };
          }

          return {
            items: [
              ...state.items,
              {
                key,
                dishId: dish.id,
                name: dish.name,
                priceKopecks: dish.price_kopecks,
                extras,
                quantity: 1,
              },
            ],
          };
        }),

      repeat: (restaurantId, items) => set({ restaurantId, items }),

      setQuantity: (key, quantity) =>
        set((state) => {
          // Кнопки «+» и «−» в корзине: без них товарная воронка разъедется —
          // добавления считались бы, а отказы нет
          const line = state.items.find((item) => item.key === key);

          if (line !== undefined && quantity !== line.quantity) {
            const delta = Math.max(0, quantity) - line.quantity;
            if (delta > 0) trackCartAdd(soldItem(line, delta));
            else trackCartRemove(soldItem(line, -delta));
          }

          return {
            items:
              quantity <= 0
                ? state.items.filter((item) => item.key !== key)
                : state.items.map((item) => (item.key === key ? { ...item, quantity } : item)),
          };
        }),

      clear: () => set({ items: [] }),

      reset: () =>
        set({
          items: [],
          restaurantId: null,
          addressId: null,
          pickupRestaurantId: null,
          mode: 'delivery',
        }),
    }),
    {
      // Корзина и выбор способа переживают перезапуск: человек закрыл приложение
      // на кухне, открыл в комнате — всё на месте
      name: 'mr.cart',
      storage: createJSONStorage(() => AsyncStorage),

      // Корзина пережила установку новой версии: у старых строк нет ключа и
      // добавок, и без этого экран падал на первой же отрисовке
      version: 2,
      migrate: (state, from) => {
        const saved = state as { items?: Partial<CartItem>[] } | undefined;
        if (saved?.items === undefined || from >= 2) return saved as never;

        return {
          ...saved,
          items: saved.items.map((item) => ({
            key: item.key ?? lineKey(item.dishId ?? '', item.extras ?? []),
            dishId: item.dishId ?? '',
            name: item.name ?? '',
            priceKopecks: item.priceKopecks ?? 0,
            extras: item.extras ?? [],
            quantity: item.quantity ?? 1,
          })),
        } as never;
      },

      partialize: (state) => ({
        mode: state.mode,
        restaurantId: state.restaurantId,
        addressId: state.addressId,
        pickupRestaurantId: state.pickupRestaurantId,
        items: state.items,
      }),
    },
  ),
);

export function cartCount(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

export function cartSubtotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + itemPrice(item) * item.quantity, 0);
}
