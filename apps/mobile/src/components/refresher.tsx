import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl } from 'react-native';

import { useTheme } from '@/theme/theme-provider';

/**
 * Дольше этого «обновляется» не держим. Запросы продолжают идти и данные
 * приедут, но крутящийся без конца значок — это уже не «загружаем», а «висим».
 */
const PATIENCE_MS = 15_000;

/**
 * Общий жест «потянуть, чтобы обновить». Экран отдаёт список своих запросов и,
 * если у него плавающая шапка, её высоту — чтобы значок вышел из-под неё.
 *
 * Значок системный. Свой рисованный мы пробовали, но спрятать системный поверх
 * него не выходит: он остаётся видимым и в Expo Go, и в сборке. Два значка на
 * одном жесте выглядят хуже любого рисунка, поэтому оставлен один — тот, что
 * платформа умеет ставить на правильное место и держать список оттянутым.
 */
export function useRefresher(reload: () => Promise<unknown>, offset = 0) {
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const finish = useCallback(() => {
    busy.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (alive.current) setRefreshing(false);
  }, []);

  const onRefresh = useCallback(() => {
    // Пока предыдущее обновление не закончилось, второе не начинаем
    if (busy.current) return;

    busy.current = true;
    setRefreshing(true);

    // Страховка от запроса, который не вернётся никогда
    timer.current = setTimeout(finish, PATIENCE_MS);

    void Promise.resolve()
      .then(reload)
      .catch(() => undefined)
      .finally(finish);
  }, [finish, reload]);

  useEffect(
    () => () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={theme.colors.brand}
      colors={[theme.colors.brand]}
      progressBackgroundColor={theme.colors.surface}
      progressViewOffset={offset}
    />
  );
}
