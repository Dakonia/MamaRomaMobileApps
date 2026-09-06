/**
 * Предложение повторить заказ на главной.
 *
 * Проверяем не вид, а поведение: когда блок появляется, что обещает гостю и
 * что кладёт в корзину по нажатию. Ошибка здесь тихая — гость нажимает
 * «Заказать снова» и получает не тот заказ, а узнаёт об этом у двери.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { Order } from '@/api/client';
import { OrderAgain } from '@/components/order-again';
import { useCart } from '@/store/cart';
import { useSession } from '@/store/session';

const mockOrders = jest.fn<Promise<Order[]>, []>();

jest.mock('@/api/client', () => ({
  api: { orders: () => mockOrders() },
  mediaUrl: (path: string | null) => path,
  // Хранилище сессии подписывается на смену токенов при загрузке модуля
  onTokens: () => undefined,
  setTokens: () => undefined,
  ApiError: class extends Error {},
}));

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    number: '260906-1',
    status: 'completed',
    type: 'delivery',
    restaurant_id: 'r1',
    restaurant_name: 'Невский, 63',
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    total_kopecks: 92_000,
    items: [
      {
        id: 'i1',
        dish_id: 'pizza',
        name: 'Маргарита',
        image_url: null,
        unit_price_kopecks: 41_000,
        quantity: 2,
        total_kopecks: 82_000,
        extras: [],
      },
      {
        id: 'i2',
        dish_id: 'cola',
        name: 'Кола',
        image_url: null,
        unit_price_kopecks: 10_000,
        quantity: 1,
        total_kopecks: 10_000,
        extras: [],
      },
    ],
    ...overrides,
  } as Order;
}

async function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  return render(<OrderAgain />, { wrapper });
}

beforeEach(() => {
  mockOrders.mockReset();
  useCart.setState({ items: [], restaurantId: null });
  useSession.setState({ status: 'authorized' });
});

it('показывает состав прошлого заказа и его сумму', async () => {
  mockOrders.mockResolvedValue([order()]);
  const view = await show();

  expect(await view.findByText('Заказать снова')).toBeTruthy();
  expect(view.getByText('Маргарита, Кола')).toBeTruthy();
  expect(view.getByText(/920/)).toBeTruthy();
});

it('по нажатию собирает ту же корзину', async () => {
  mockOrders.mockResolvedValue([order()]);
  const view = await show();

  fireEvent.press(await view.findByLabelText(/Повторить прошлый заказ/));

  const cart = useCart.getState();
  expect(cart.restaurantId).toBe('r1');
  expect(cart.items).toHaveLength(2);
  expect(cart.items[0]).toMatchObject({ dishId: 'pizza', quantity: 2, priceKopecks: 41_000 });
});

it('молчит, пока едет другой заказ', async () => {
  mockOrders.mockResolvedValue([order({ id: 'o2', status: 'delivering' }), order()]);
  const view = await show();

  await waitFor(() => expect(mockOrders).toHaveBeenCalled());
  expect(view.queryByText('Заказать снова')).toBeNull();
});

it('молчит, если гость уже собирает корзину', async () => {
  mockOrders.mockResolvedValue([order()]);
  useCart.setState({
    items: [
      { key: 'pizza', dishId: 'pizza', name: 'Маргарита', priceKopecks: 41_000, extras: [], quantity: 1 },
    ],
  });
  const view = await show();

  await waitFor(() => expect(mockOrders).toHaveBeenCalled());
  expect(view.queryByText('Заказать снова')).toBeNull();
});

it('старый заказ не предлагаем: гость его уже не помнит', async () => {
  mockOrders.mockResolvedValue([
    order({ created_at: new Date(Date.now() - 90 * 86_400_000).toISOString() }),
  ]);
  const view = await show();

  await waitFor(() => expect(mockOrders).toHaveBeenCalled());
  expect(view.queryByText('Заказать снова')).toBeNull();
});
