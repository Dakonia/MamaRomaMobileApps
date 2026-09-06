import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';

import { api, type Order } from '@/api/client';
import { ActiveOrder } from '@/components/active-order';
import { OrderAgain } from '@/components/order-again';
import { useCart } from '@/store/cart';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

const DONE: Order['status'][] = ['completed', 'cancelled'];

/** Заказ ещё «свежий» — повторить его осмысленно. Дальше гость и сам не помнит. */
const RECENT_DAYS = 45;

/**
 * Первая строка меню: что у гостя с заказами.
 *
 * Едет заказ — показываем его статус. Не едет, а корзина пуста — предлагаем
 * повторить прошлый. Нечего показать — строки нет вовсе, вместе с отступами:
 * пустой зазор над меню выглядит как забытый блок.
 */
export function OrderStrip() {
  const theme = useTheme();
  const cart = useCart();
  const session = useSession();

  // Время берём один раз за жизнь экрана: свежесть заказа за эти минуты не
  // изменится, а спрашивать часы при каждой отрисовке нельзя — она должна
  // давать один и тот же результат на одних и тех же данных
  const [now] = useState(() => Date.now());

  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.orders(),
    enabled: session.status === 'authorized',
  });

  const rows = orders.data ?? [];
  const live = rows.find((row) => !DONE.includes(row.status));
  const last = rows.find((row) => row.status === 'completed');

  const canRepeat =
    live === undefined &&
    cart.items.length === 0 &&
    last !== undefined &&
    now - new Date(last.created_at).getTime() <= RECENT_DAYS * 86_400_000;

  if (live === undefined && !canRepeat) return null;

  return (
    <View
      style={{
        paddingHorizontal: theme.layout.screenPadding,
        paddingTop: theme.spacing.base,
        paddingBottom: theme.spacing.base,
      }}
    >
      {live ? <ActiveOrder /> : <OrderAgain />}
    </View>
  );
}
