import { onlineManager } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { RefreshControl } from 'react-native';

import { queryClient } from '@/lib/query-client';
import { useRefreshing } from '@/store/refreshing';
import { useTheme } from '@/theme/theme-provider';

/**
 * Дольше этого обновление не показываем. Запросы продолжают идти и данные
 * приедут, но крутящийся без конца значок — это уже не «загружаем», а «висим».
 */
const PATIENCE_MS = 15_000;

/**
 * Общий жест «потянуть, чтобы обновить». Экран отдаёт список своих запросов и,
 * если у него плавающая шапка, её высоту — чтобы значок вышел из-под неё.
 * Вид и состояние берутся отсюда: тогда жест везде одинаковый.
 */
export function useRefresher(reload: () => Promise<unknown>, offset = 0) {
  const theme = useTheme();
  const id = useId();
  const screen = usePathname();
  const [refreshing, setRefreshing] = useState(false);

  // Чтобы обещание, отставшее от жизни экрана, не включало значок заново
  const alive = useRef(true);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback(() => {
    busy.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;

    useRefreshing.getState().stop(id);
    if (alive.current) setRefreshing(false);
  }, [id]);

  const onRefresh = useCallback(() => {
    // Пока предыдущее обновление не закончилось, второе не начинаем
    if (busy.current) return;

    busy.current = true;
    setRefreshing(true);
    useRefreshing.getState().start(id, offset);

    // Страховка от запроса, который не вернётся никогда
    timer.current = setTimeout(() => {
      if (__DEV__) {
        // Кто именно не отвечает: без этого причину приходится угадывать.
        // paused — запрос стоит, потому что React Query считает нас офлайн,
        // fetching — ушёл и не вернулся
        const busyQueries = queryClient
          .getQueryCache()
          .getAll()
          .filter((query) => query.state.fetchStatus !== 'idle')
          .map((query) => `${JSON.stringify(query.queryKey)} — ${query.state.fetchStatus}`);

        console.warn(
          [
            `Обновление на ${screen} висит дольше ${PATIENCE_MS / 1000} с`,
            `сеть: ${onlineManager.isOnline() ? 'онлайн' : 'офлайн'}`,
            busyQueries.length > 0 ? `застряли: ${busyQueries.join(', ')}` : 'застрявших запросов нет',
          ].join('. '),
        );
      }
      finish();
    }, PATIENCE_MS);

    void Promise.resolve()
      .then(reload)
      .catch(() => undefined)
      .finally(finish);
  }, [finish, id, offset, reload, screen]);

  // Экран закрыли посреди обновления — запись о нём убираем сами
  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      useRefreshing.getState().stop(id);
    };
  }, [id]);

  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      // Системный кружок гасим: вместо него крутится своя пицца
      tintColor="transparent"
      colors={['transparent']}
      progressBackgroundColor="transparent"
      style={{ backgroundColor: 'transparent' }}
      progressViewOffset={offset + theme.spacing.md}
    />
  );
}
