import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';

import { api, type Order } from '@/api/client';
import { ActiveOrder } from '@/components/active-order';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

const DONE: Order['status'][] = ['completed', 'cancelled'];

/**
 * Сколько заказ считается едущим.
 *
 * Ресторан может забыть закрыть заказ на кассе, и он останется в «принят»
 * навсегда — на главной вечно висел бы статус доставки, которой давно нет.
 * Сутки с запасом перекрывают любую доставку, включая заказ ко времени.
 */
const LIVE_HOURS = 24;

/**
 * Первая строка меню: заказ, который сейчас едет.
 *
 * Нечего показать — строки нет вовсе, вместе с отступами: пустой зазор над
 * меню выглядит как забытый блок.
 */
export function OrderStrip() {
  const theme = useTheme();
  const session = useSession();

  // Время берём один раз за жизнь экрана: отрисовка должна быть предсказуемой
  const [now] = useState(() => Date.now());

  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.orders(),
    enabled: session.status === 'authorized',
  });

  const live = (orders.data ?? []).find(
    (row) =>
      !DONE.includes(row.status) &&
      now - new Date(row.created_at).getTime() <= LIVE_HOURS * 3_600_000,
  );

  if (live === undefined) return null;

  return (
    <View
      style={{
        paddingHorizontal: theme.layout.screenPadding,
        paddingTop: theme.spacing.base,
        paddingBottom: theme.spacing.base,
      }}
    >
      <ActiveOrder />
    </View>
  );
}
