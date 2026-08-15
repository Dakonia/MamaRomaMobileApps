import { create } from 'zustand';

import type { Dish } from '@/api/client';

export type CartItem = {
  dishId: string;
  name: string;
  priceKopecks: number;
  quantity: number;
};

type CartState = {
  restaurantId: string | null;
  items: CartItem[];
  selectRestaurant: (restaurantId: string) => void;
  add: (dish: Dish) => void;
  setQuantity: (dishId: string, quantity: number) => void;
  clear: () => void;
};

export const useCart = create<CartState>((set) => ({
  restaurantId: null,
  items: [],

  // Цены зависят от ресторана, поэтому смена ресторана обнуляет корзину
  selectRestaurant: (restaurantId) =>
    set((state) =>
      state.restaurantId === restaurantId
        ? state
        : { restaurantId, items: state.restaurantId === null ? state.items : [] },
    ),

  add: (dish) =>
    set((state) => {
      const existing = state.items.find((item) => item.dishId === dish.id);
      if (existing) {
        return {
          items: state.items.map((item) =>
            item.dishId === dish.id ? { ...item, quantity: item.quantity + 1 } : item,
          ),
        };
      }
      return {
        items: [
          ...state.items,
          { dishId: dish.id, name: dish.name, priceKopecks: dish.price_kopecks, quantity: 1 },
        ],
      };
    }),

  setQuantity: (dishId, quantity) =>
    set((state) => ({
      items:
        quantity <= 0
          ? state.items.filter((item) => item.dishId !== dishId)
          : state.items.map((item) => (item.dishId === dishId ? { ...item, quantity } : item)),
    })),

  clear: () => set({ items: [] }),
}));

export function cartSubtotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.priceKopecks * item.quantity, 0);
}

export function cartCount(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}
