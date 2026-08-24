import { useCallback, useEffect, useState } from 'react';
import { RefreshControl } from 'react-native';

import { useRefreshing } from '@/store/refreshing';
import { useTheme } from '@/theme/theme-provider';

/**
 * Общий жест «потянуть, чтобы обновить». Экран отдаёт список своих запросов и,
 * если у него плавающая шапка, её высоту — чтобы спиннер вышел из-под неё.
 * Вид и состояние берутся отсюда: тогда жест везде одинаковый.
 */
export function useRefresher(reload: () => Promise<unknown>, offset = 0) {
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void reload().finally(() => setRefreshing(false));
  }, [reload]);

  // Пока идёт обновление, поверх приложения крутится пицца
  useEffect(() => {
    const { start, stop } = useRefreshing.getState();

    if (refreshing) start(offset);
    else stop();

    return stop;
  }, [refreshing, offset]);

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
