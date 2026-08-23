import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';

import { api } from '@/api/client';
import { enablePush } from '@/lib/push';
import { queryClient } from '@/lib/query-client';
import { useCart } from '@/store/cart';
import { useSession } from '@/store/session';

/** Дольше этого гостя не держим: сеть может тупить, а меню грузится и на экране. */
const PATIENCE_MS = 4500;

/**
 * Сколько держать заставку сверх настоящей загрузки — чтобы её можно было
 * рассмотреть на разработке. В сборке для гостей всегда ноль.
 */
const HOLD_MS = __DEV__ ? 6000 : 0;

/**
 * Минимум показа: на быстрой сети данные приходят за доли секунды, и кладка
 * печи не успевала бы выложиться — гость видел бы мигание вместо загрузки.
 */
const MIN_SHOW_MS = 1900;

/** Ресторан гостя: от него зависит и меню, и цены, и акции. */
function currentRestaurant(): string | undefined {
  return useCart.getState().restaurantId ?? undefined;
}

/**
 * Что тянем, пока играет заставка. Список — из функций, а не из готовых
 * обещаний: их число известно до первого кадра, поэтому доля загрузки только
 * растёт и никогда не откатывается назад.
 */
const JOBS: (() => Promise<unknown>)[] = [
  () => useSession.getState().restore(),
  () => queryClient.prefetchQuery({ queryKey: ['restaurants'], queryFn: () => api.restaurants() }),
  () =>
    queryClient.prefetchQuery({
      queryKey: ['menu', currentRestaurant() ?? null],
      queryFn: () => api.menu(currentRestaurant()),
    }),
  () =>
    queryClient.prefetchQuery({
      queryKey: ['popular', currentRestaurant() ?? null],
      queryFn: () => api.popular(currentRestaurant()),
    }),
  () =>
    queryClient.prefetchQuery({
      queryKey: ['promotions', 'menu', currentRestaurant() ?? null],
      queryFn: () => api.promotions(currentRestaurant(), true),
    }),
  () => Image.prefetch([require('../../assets/images/hero-pizza.jpg')]),
  // Токен устройства живёт не вечно: обновляем молча, ничего не спрашивая
  () => enablePush(false),
];

/**
 * Готовность приложения к первому экрану: доля выполненных дел и признак
 * «можно показывать». Заставка рисует по этому настоящую загрузку, а не
 * притворную.
 */
export function useBoot(): { progress: number; ready: boolean } {
  const [done, setDone] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [held, setHeld] = useState(HOLD_MS === 0);
  const [shown, setShown] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    for (const job of JOBS) {
      // Упавший запрос не держит запуск: экран покажет свою ошибку и повтор
      void Promise.resolve(job())
        .catch(() => undefined)
        .finally(() => setDone((value) => value + 1));
    }

    const patience = setTimeout(() => setTimedOut(true), PATIENCE_MS);
    const minimum = setTimeout(() => setShown(true), MIN_SHOW_MS);
    const hold = HOLD_MS > 0 ? setTimeout(() => setHeld(true), HOLD_MS) : undefined;

    return () => {
      clearTimeout(patience);
      clearTimeout(minimum);
      if (hold) clearTimeout(hold);
    };
  }, []);

  return {
    progress: Math.min(1, done / JOBS.length),
    ready: held && shown && (timedOut || done >= JOBS.length),
  };
}
