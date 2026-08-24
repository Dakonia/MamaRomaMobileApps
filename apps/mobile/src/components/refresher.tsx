import { useCallback, useState } from 'react';
import { RefreshControl } from 'react-native';

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

  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={theme.colors.brand}
      colors={[theme.colors.brand]}
      progressBackgroundColor={theme.colors.surface}
      // На экранах с плавающей шапкой спиннер иначе крутится за ней
      progressViewOffset={offset}
    />
  );
}
