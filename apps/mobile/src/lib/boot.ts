import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';

import { api, mediaUrl } from '@/api/client';
import { enablePush } from '@/lib/push';
import { queryClient } from '@/lib/query-client';
import { useAppearance } from '@/store/appearance';
import { useCart } from '@/store/cart';
import { usePushAsk } from '@/store/push-ask';
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
  () => useAppearance.getState().restore(),
  () => usePushAsk.getState().restore(),
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
  // Токен живёт не вечно: обновляем молча — но только если гость не выключил
  // уведомления сам. Иначе выключенный тумблер оживал бы при каждом запуске
  async () => {
    await usePushAsk.getState().restore();
    if (usePushAsk.getState().wanted) await enablePush(false);
  },
];

/**
 * Что греем в фоне, уже после заставки. Вкладка «Акции» лежит в одном касании
 * от меню, но её список приходит отдельным запросом — без прогрева первый заход
 * встречал гостя скелетонами на всю страницу.
 */
const WARM: (() => Promise<unknown>)[] = [
  () =>
    queryClient.prefetchQuery({
      queryKey: ['promotions', 'all'],
      queryFn: () => api.promotions(),
    }),

  /**
   * Снимки залов кладём в кэш заранее: гость заходит в бронь и видит карточки
   * без картинок, которые доезжают у него на глазах.
   *
   * Берём ровно те шесть, что показываются первыми, — это около полумегабайта.
   * Дальше кадры тянутся по мере надобности, а на следующих запусках всё уже
   * лежит на диске и качать нечего.
   */
  async () => {
    const restaurants = await queryClient.fetchQuery({
      queryKey: ['restaurants'],
      queryFn: () => api.restaurants(),
    });

    const shots = restaurants
      .slice(0, 6)
      .map((item) => mediaUrl(item.photos?.[0] ?? item.image_url))
      .filter((uri): uri is string => Boolean(uri));

    if (shots.length > 0) await Image.prefetch(shots);
  },
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

    // Фоновый прогрев не входит в прогресс: заставка его не ждёт
    for (const job of WARM) void Promise.resolve(job()).catch(() => undefined);

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
