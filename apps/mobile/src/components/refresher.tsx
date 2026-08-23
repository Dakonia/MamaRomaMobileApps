import { useCallback, useState } from 'react';
import { RefreshControl } from 'react-native';

import { useTheme } from '@/theme/theme-provider';

/**
 * Общий жест «потянуть, чтобы обновить». Экран отдаёт список своих запросов,
 * а вид спиннера и состояние берутся отсюда — тогда жест везде одинаковый.
 */
export function useRefresher(reload: () => Promise<unknown>) {
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
    />
  );
}
