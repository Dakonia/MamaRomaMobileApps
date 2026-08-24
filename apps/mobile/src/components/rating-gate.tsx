import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { api, type Order } from '@/api/client';
import { OrderRating } from '@/components/order-rating';
import { useSession } from '@/store/session';

/** Где спрашивать не стыдно: вкладки и карточка самого заказа. */
const CALM_SCREENS = ['/', '/promos', '/booking', '/profile'];

const asked = (orderId: string) => `rated-${orderId}`;

/**
 * Просьба оценить последнюю доставку.
 *
 * По уведомлению переходят не все: чаще приложение просто открывают позже.
 * Поэтому спрашиваем не на экране заказа, а там, где гость оказался, — но
 * только на спокойных экранах: посреди оформления заказа шторка мешала бы.
 * Один заказ спрашиваем один раз: отметку ставим в момент показа.
 */
export function RatingGate() {
  const authorized = useSession((state) => state.status === 'authorized');
  const pathname = usePathname();

  const [order, setOrder] = useState<Order | null>(null);
  const shown = useRef(false);

  const { data } = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.orders(),
    enabled: authorized,
  });

  const calm = CALM_SCREENS.includes(pathname) || pathname.startsWith('/order/');

  useEffect(() => {
    if (shown.current || !calm || data === undefined) return;

    // Открыт сам заказ — спрашиваем про него, иначе про самую свежую доставку
    const openId = pathname.startsWith('/order/') ? pathname.slice('/order/'.length) : null;
    const waiting = data.filter(
      (item) => item.status === 'completed' && !item.feedback_left,
    );
    const candidate = waiting.find((item) => item.id === openId) ?? waiting[0];

    if (candidate === undefined) return;

    shown.current = true;

    void AsyncStorage.getItem(asked(candidate.id)).then((seen) => {
      if (seen !== null) return;

      void AsyncStorage.setItem(asked(candidate.id), '1');
      // Даём экрану проявиться: шторка поверх входа выглядит суетливо
      setTimeout(() => setOrder(candidate), 1200);
    });
  }, [calm, data, pathname]);

  if (order === null) return null;

  return <OrderRating order={order} onClose={() => setOrder(null)} />;
}
