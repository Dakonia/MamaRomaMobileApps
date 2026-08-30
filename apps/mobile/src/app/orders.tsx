import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Order } from '@/api/client';
import { EmptyState } from '@/components/empty-state';
import { UNDER_HEADER, useRefresher } from '@/components/refresher';
import { OrderHistoryCard } from '@/components/order-history-card';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenHeader } from '@/components/screen-header';
import { Skeleton } from '@/components/skeleton';
import { formatPrice } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';

type Filter = 'all' | 'active' | 'done';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'В работе' },
  { key: 'done', label: 'Завершённые' },
];

const DONE: Order['status'][] = ['completed', 'cancelled'];

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

type Row = { kind: 'month'; key: string; title: string } | { kind: 'order'; key: string; order: Order };

/**
 * История заказов отдельным экраном: в профиле она растягивала страницу на
 * десятки карточек. Здесь список виртуализирован и разбит по месяцам.
 */
export default function OrdersScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');

  const orders = useQuery({ queryKey: ['orders'], queryFn: () => api.orders() });

  // Под заголовком экрана, а не поверх него
  const refresher = useRefresher(() => orders.refetch(), insets.top + UNDER_HEADER);

  const rows = useMemo<Row[]>(() => {
    const all = orders.data ?? [];
    const picked = all.filter((order) => {
      if (filter === 'active') return !DONE.includes(order.status);
      if (filter === 'done') return DONE.includes(order.status);
      return true;
    });

    const result: Row[] = [];
    let month = '';

    for (const order of picked) {
      const at = new Date(order.created_at);
      const title = `${MONTHS[at.getMonth()]} ${at.getFullYear()}`;

      if (title !== month) {
        month = title;
        result.push({ kind: 'month', key: `m-${title}`, title });
      }

      result.push({ kind: 'order', key: order.id, order });
    }

    return result;
  }, [orders.data, filter]);

  const spent = (orders.data ?? [])
    .filter((order) => order.status === 'completed')
    .reduce((sum, order) => sum + order.total_kopecks, 0);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.backgroundAlt }]}>
      <ScreenHeader title="Мои заказы" onBack={() => router.back()} />

      <View
        style={[
          styles.row,
          {
            gap: theme.spacing.sm,
            paddingHorizontal: theme.layout.screenPadding,
            paddingBottom: theme.spacing.sm,
          },
        ]}
      >
        {FILTERS.map((item) => {
          const active = filter === item.key;

          return (
            <PressableScale
              key={item.key}
              depth={0.96}
              accessibilityLabel={item.label}
              onPress={() => setFilter(item.key)}
              style={{
                paddingHorizontal: theme.spacing.base,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.radius.pill,
                backgroundColor: active ? theme.colors.brand : theme.colors.surface,
              }}
            >
              <Text
                style={[
                  theme.typography.bodyMedium,
                  { color: active ? theme.colors.textOnBrand : theme.colors.textSecondary },
                ]}
              >
                {item.label}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      {orders.isPending ? (
        <View style={{ padding: theme.layout.screenPadding, gap: theme.spacing.md }}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} height={150} radius={theme.radius.xl} />
          ))}
        </View>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          art="orders"
          title={filter === 'all' ? 'Заказов ещё не было' : 'Здесь пусто'}
          description="Как только закажете — история появится тут."
          actionLabel="В меню"
          onAction={() => router.replace('/')}
        />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(row) => row.key}
          contentContainerStyle={{
            paddingHorizontal: theme.layout.screenPadding,
            paddingBottom: insets.bottom + theme.spacing.huge,
          }}
          refreshControl={refresher}
          ListHeaderComponent={
            spent > 0 ? (
              <Animated.View
                entering={FadeIn.duration(220)}
                style={{
                  marginBottom: theme.spacing.md,
                  padding: theme.spacing.base,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface,
                }}
              >
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                  Всего заказов: {(orders.data ?? []).length} · на {formatPrice(spent)}
                </Text>
              </Animated.View>
            ) : null
          }
          renderItem={({ item }) =>
            item.kind === 'month' ? (
              <Text
                style={[
                  theme.typography.overline,
                  {
                    color: theme.colors.textTertiary,
                    paddingTop: theme.spacing.base,
                    paddingBottom: theme.spacing.sm,
                  },
                ]}
              >
                {item.title}
              </Text>
            ) : (
              <View style={{ paddingBottom: theme.spacing.md }}>
                <OrderHistoryCard
                  order={item.order}
                  onPress={() => router.push(`/order/${item.order.id}`)}
                />
              </View>
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
