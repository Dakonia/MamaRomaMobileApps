import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { api, type Order } from '@/api/client';
import { OrderRating } from '@/components/order-rating';
import { useSession } from '@/store/session';

/** Где спрашивать не стыдно: вкладки и карточка самого заказа. */
const CALM_SCREENS = ['/', '/promos', '/booking', '/profile'];

/**
 * Ключ отметки. Версия в имени не для красоты: прежняя сборка ставила отметку
 * в момент открытия заказа, а не показа шторки, и часть заказов оказалась
 * «спрошенной» молча. Новый ключ даёт им один честный вопрос.
 */
const asked = (orderId: string) => `rating-asked-${orderId}`;

/**
 * Просьба оценить последнюю доставку.
 *
 * По уведомлению переходят не все: чаще заказ отмечают доставленным, пока
 * приложение свёрнуто, и гость возвращается сам — уже на меню. Поэтому спрашиваем
 * не на экране заказа, а там, где гость оказался, и перечитываем список заказов
 * при каждом возвращении: к этому моменту статус как раз и меняется.
 *
 * Спокойные экраны выбраны намеренно: посреди оформления заказа шторка мешала бы.
 * Один заказ спрашиваем один раз — отметку ставим, когда гость закрыл шторку.
 */
export function RatingGate() {
  const authorized = useSession((state) => state.status === 'authorized');
  const pathname = usePathname();

  const [order, setOrder] = useState<Order | null>(null);
  const shown = useRef<string | null>(null);

  const { data, refetch } = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.orders(),
    enabled: authorized,
    // Свежесть здесь важнее экономии: устаревший список молчит о доставке
    refetchOnMount: 'always',
  });

  // Вернулись в приложение — перечитываем заказы, не полагаясь на возраст кэша
  useEffect(() => {
    if (!authorized) return;

    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refetch();
    });

    return () => listener.remove();
  }, [authorized, refetch]);

  const calm = CALM_SCREENS.includes(pathname) || pathname.startsWith('/order/');

  useEffect(() => {
    if (order !== null || !calm || data === undefined) return;

    // Открыт сам заказ — спрашиваем про него, иначе про самую свежую доставку
    const openId = pathname.startsWith('/order/') ? pathname.slice('/order/'.length) : null;
    const waiting = data.filter((item) => item.status === 'completed' && !item.feedback_left);
    const candidate = waiting.find((item) => item.id === openId) ?? waiting[0];

    if (candidate === undefined || shown.current === candidate.id) return;

    void AsyncStorage.getItem(asked(candidate.id)).then((seen) => {
      if (seen !== null || shown.current === candidate.id) return;

      shown.current = candidate.id;
      // Даём экрану проявиться: шторка поверх входа выглядит суетливо
      setTimeout(() => setOrder(candidate), 1000);
    });
  }, [calm, data, order, pathname]);

  // Отметку ставим по факту показа: если приложение закрыли раньше, спросим ещё раз
  const close = useCallback(() => {
    setOrder((current) => {
      if (current !== null) void AsyncStorage.setItem(asked(current.id), '1');
      return null;
    });
  }, []);

  if (order === null) return null;

  return <OrderRating order={order} onClose={close} />;
}
