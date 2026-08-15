import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Order } from '@/api/client';
import { EmptyState } from '@/components/empty-state';
import { ScreenHeader } from '@/components/screen-header';
import { formatPoints, formatPrice } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';

const STATUS_LABEL: Record<Order['status'], string> = {
  created: 'Оформлен',
  paid: 'Оплачен',
  accepted: 'Принят рестораном',
  cooking: 'Готовим',
  ready: 'Готов',
  delivering: 'В пути',
  completed: 'Выполнен',
  cancelled: 'Отменён',
};

const TYPE_LABEL: Record<Order['type'], string> = {
  delivery: 'Доставка',
  pickup: 'Самовывоз',
};

export default function OrderScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.order(id),
  });

  if (isPending) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <ScreenHeader title="Заказ" />
        <View style={{ padding: theme.layout.screenPadding }}>
          <View
            style={{
              height: theme.spacing.huge,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.skeleton,
            }}
          />
        </View>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <ScreenHeader title="Заказ" />
        <EmptyState
          icon="cloud-offline-outline"
          title="Заказ не открылся"
          description={error.message}
          actionLabel="Повторить"
          onAction={() => {
            void refetch();
          }}
        />
      </View>
    );
  }

  const summaryRow = (label: string, value: string, accent?: boolean) => (
    <View style={styles.summaryRow} key={label}>
      <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>{label}</Text>
      <Text
        style={[
          theme.typography.bodyMedium,
          { color: accent ? theme.colors.accent : theme.colors.textPrimary },
        ]}
      >
        {value}
      </Text>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title={`Заказ ${data.number}`} subtitle={STATUS_LABEL[data.status]} />

      <ScrollView
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing.xxxl + insets.bottom,
        }}
      >
        <View
          style={{
            padding: theme.spacing.lg,
            borderRadius: theme.radius.xl,
            backgroundColor: theme.colors.accentSubtle,
            gap: theme.spacing.xxs,
          }}
        >
          <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
            {TYPE_LABEL[data.type]} · {data.restaurant_name}
          </Text>
          {data.address_text ? (
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
              {data.address_text}
            </Text>
          ) : null}
          {data.points_earned > 0 ? (
            <Text style={[theme.typography.body, { color: theme.colors.accent }]}>
              Начислили {formatPoints(data.points_earned)}
            </Text>
          ) : null}
        </View>

        <View style={{ gap: theme.spacing.md }}>
          <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
            Состав
          </Text>
          {data.items.map((item) => (
            <View key={item.id} style={styles.summaryRow}>
              <Text style={[theme.typography.body, styles.itemName, { color: theme.colors.textPrimary }]}>
                {item.name} × {item.quantity}
              </Text>
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                {formatPrice(item.total_kopecks)}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          {summaryRow('Блюда', formatPrice(data.subtotal_kopecks))}
          {data.delivery_kopecks > 0 ? summaryRow('Доставка', formatPrice(data.delivery_kopecks)) : null}
          {data.discount_kopecks > 0
            ? summaryRow('Списано баллами', `−${formatPrice(data.discount_kopecks)}`, true)
            : null}
          <View style={styles.summaryRow}>
            <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>Итого</Text>
            <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
              {formatPrice(data.total_kopecks)}
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/')}
          hitSlop={theme.hitSlop}
          style={[styles.backToMenu, { minHeight: theme.layout.minTouchTarget }]}
        >
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.brand }]}>
            Вернуться в меню
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  itemName: { flex: 1 },
  backToMenu: { alignItems: 'center', justifyContent: 'center' },
});
