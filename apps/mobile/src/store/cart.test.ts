/**
 * Счёт корзины на стороне гостя.
 *
 * Итог заказа считает сервер, но всё, что гость видит до оформления, считается
 * здесь: сумма строки с добавками, число блюд на значке, ключ строки. Ошибка в
 * любом из этих мест — это неправильная цена на экране и потерянное доверие,
 * поэтому проверяем их отдельно от экранов.
 */

import type { Dish, Order } from '@/api/client';
import {
  cartCount,
  cartSubtotal,
  itemPrice,
  itemsFromOrder,
  lineKey,
  useCart,
  type CartItem,
} from '@/store/cart';

function line(overrides: Partial<CartItem> = {}): CartItem {
  return {
    key: 'pizza',
    dishId: 'pizza',
    name: 'Маргарита',
    priceKopecks: 41_000,
    extras: [],
    quantity: 1,
    ...overrides,
  };
}

function dish(overrides: Partial<Dish> = {}): Dish {
  return {
    id: 'pizza',
    name: 'Маргарита',
    price_kopecks: 41_000,
    is_available: true,
    ...overrides,
  } as Dish;
}

describe('цена строки', () => {
  it('складывает блюдо с добавками', () => {
    const item = line({
      extras: [
        { id: 'cheese', name: 'Сыр', priceKopecks: 9_000 },
        { id: 'basil', name: 'Базилик', priceKopecks: 4_000 },
      ],
    });

    expect(itemPrice(item)).toBe(54_000);
  });

  it('переживает строку без добавок', () => {
    expect(itemPrice(line({ extras: [] }))).toBe(41_000);
  });
});

describe('итоги корзины', () => {
  it('умножает цену строки на количество', () => {
    const items = [
      line({ quantity: 2 }),
      line({
        key: 'kalzone',
        dishId: 'kalzone',
        name: 'Кальцоне',
        priceKopecks: 51_000,
        quantity: 3,
      }),
    ];

    expect(cartSubtotal(items)).toBe(41_000 * 2 + 51_000 * 3);
    expect(cartCount(items)).toBe(5);
  });

  it('добавки попадают в сумму каждой порции', () => {
    const items = [
      line({ quantity: 3, extras: [{ id: 'cheese', name: 'Сыр', priceKopecks: 9_000 }] }),
    ];

    expect(cartSubtotal(items)).toBe(50_000 * 3);
  });

  it('пустая корзина стоит ноль', () => {
    expect(cartSubtotal([])).toBe(0);
    expect(cartCount([])).toBe(0);
  });
});

describe('ключ строки', () => {
  it('не зависит от порядка выбора добавок', () => {
    const first = lineKey('pizza', [
      { id: 'cheese', name: 'Сыр', priceKopecks: 9_000 },
      { id: 'basil', name: 'Базилик', priceKopecks: 4_000 },
    ]);
    const second = lineKey('pizza', [
      { id: 'basil', name: 'Базилик', priceKopecks: 4_000 },
      { id: 'cheese', name: 'Сыр', priceKopecks: 9_000 },
    ]);

    expect(first).toBe(second);
  });

  it('разводит одно блюдо с добавкой и без неё', () => {
    const plain = lineKey('pizza', []);
    const withCheese = lineKey('pizza', [{ id: 'cheese', name: 'Сыр', priceKopecks: 9_000 }]);

    expect(plain).not.toBe(withCheese);
  });
});

describe('переезд корзины в другой ресторан', () => {
  beforeEach(() => {
    useCart.setState({ items: [], restaurantId: null });
  });

  it('подтягивает цену нового ресторана и сообщает о разнице', () => {
    useCart.setState({ items: [line({ quantity: 2 })], restaurantId: 'first' });

    const report = useCart.getState().moveTo('second', [dish({ price_kopecks: 45_000 })]);

    expect(report.repriced).toEqual([{ name: 'Маргарита', from: 41_000, to: 45_000 }]);
    expect(cartSubtotal(useCart.getState().items)).toBe(45_000 * 2);
  });

  it('блюдо, которого здесь не готовят, остаётся в корзине с пометкой', () => {
    useCart.setState({ items: [line()], restaurantId: 'first' });

    const report = useCart.getState().moveTo('second', []);

    expect(report.unavailable).toEqual(['Маргарита']);
    expect(useCart.getState().items).toHaveLength(1);
  });

  it('снятое со стоп-листа блюдо считается недоступным', () => {
    useCart.setState({ items: [line()], restaurantId: 'first' });

    const report = useCart.getState().moveTo('second', [dish({ is_available: false })]);

    expect(report.unavailable).toEqual(['Маргарита']);
  });

  it('цена не изменилась — сообщать не о чем', () => {
    useCart.setState({ items: [line()], restaurantId: 'first' });

    const report = useCart.getState().moveTo('second', [dish()]);

    expect(report.repriced).toEqual([]);
    expect(report.unavailable).toEqual([]);
  });
});

describe('повтор прошлого заказа', () => {
  function order(items: Order['items']): Order {
    return { id: 'o1', restaurant_id: 'r1', items } as Order;
  }

  it('цену добавок отделяет от цены блюда', () => {
    const items = itemsFromOrder(
      order([
        {
          id: 'i1',
          dish_id: 'pizza',
          name: 'Маргарита',
          // В заказе порция хранится вместе с добавками, в корзине — раздельно
          unit_price_kopecks: 50_000,
          quantity: 2,
          total_kopecks: 100_000,
          extras: [{ name: 'Сыр', price_kopecks: 9_000 }],
        },
      ] as Order['items']),
    );

    expect(items).toHaveLength(1);
    expect(items[0].priceKopecks).toBe(41_000);
    expect(items[0].extras[0].priceKopecks).toBe(9_000);
    expect(itemPrice(items[0])).toBe(50_000);
    expect(cartSubtotal(items)).toBe(100_000);
  });

  it('позицию, добавленную на кассе, повторить нечем', () => {
    const items = itemsFromOrder(
      order([
        {
          id: 'i1',
          dish_id: null,
          name: 'Блюдо с кассы',
          unit_price_kopecks: 30_000,
          quantity: 1,
          total_kopecks: 30_000,
          extras: [],
        },
      ] as unknown as Order['items']),
    );

    expect(items).toEqual([]);
  });

  it('одинаковые наборы добавок дают одну строку', () => {
    const items = itemsFromOrder(
      order([
        {
          id: 'i1',
          dish_id: 'pizza',
          name: 'Маргарита',
          unit_price_kopecks: 41_000,
          quantity: 1,
          total_kopecks: 41_000,
          extras: [],
        },
      ] as Order['items']),
    );

    expect(items[0].key).toBe(lineKey('pizza', []));
  });
});
