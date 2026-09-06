import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { api, mediaUrl, type Order } from '@/api/client';
import { PressableScale } from '@/components/pressable-scale';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { itemsFromOrder, useCart } from '@/store/cart';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

const DONE: Order['status'][] = ['completed'];
const THUMB = 44;
const OVERLAP = 25;

/** Сколько дней заказ ещё «свежий»: позже гость и сам не помнит, что брал. */
const RECENT_DAYS = 45;

function daysSince(iso: string, now: number): number {
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000);
}

/** «сегодня», «вчера», «5 дней назад» — без дат, так короче и понятнее. */
function whenLabel(days: number): string {
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн. назад`;
  if (days < 14) return 'на прошлой неделе';
  return `${Math.round(days / 7)} нед. назад`;
}

/**
 * Повтор прошлого заказа на главной.
 *
 * Постоянный гость заказывает одно и то же, и каждый раз собирает это заново:
 * меню, блюдо, добавки, корзина. Здесь весь путь сворачивается в одно
 * касание — блок стоит там же, где обычно висит активный заказ, и появляется,
 * только когда заказывать нечего: активного заказа нет, корзина пуста.
 */
export function OrderAgain() {
  const theme = useTheme();
  const cart = useCart();
  const session = useSession();

  // Часы спрашиваем один раз: отрисовка должна быть предсказуемой
  const [now] = useState(() => Date.now());

  // Тот же ключ, что у полосы активного заказа: второго запроса не будет
  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.orders(),
    enabled: session.status === 'authorized',
  });

  const rows = orders.data ?? [];
  // Заказ считается едущим сутки: дальше это забытый на кассе хвост, и место
  // под него держать незачем — то же правило в order-strip.tsx
  const busy = rows.some(
    (row) =>
      !['completed', 'cancelled'].includes(row.status) &&
      now - new Date(row.created_at).getTime() <= 24 * 3_600_000,
  );
  const last = rows.find((row) => DONE.includes(row.status));

  if (busy || cart.items.length > 0 || last === undefined) return null;
  if (daysSince(last.created_at, now) > RECENT_DAYS) return null;

  const photos = last.items
    .map((item) => mediaUrl(item.image_url))
    .filter((uri): uri is string => Boolean(uri))
    .slice(0, 3);

  const names = last.items.map((item) => item.name).join(', ');

  const repeat = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    track('order_repeat', { from: 'menu', positions: last.items.length });
    cart.repeat(last.restaurant_id, itemsFromOrder(last));
    router.push('/(tabs)/cart');
  };

  return (
    <Animated.View entering={FadeInDown.duration(320)}>
      <PressableScale
        accessibilityLabel={`Повторить прошлый заказ: ${names}`}
        depth={0.985}
        onPress={repeat}
        style={[
          theme.elevation.card,
          styles.card,
          {
            borderRadius: theme.radius.xxl,
            backgroundColor: theme.colors.surface,
            padding: theme.spacing.base,
            gap: theme.spacing.md,
          },
        ]}
      >
        {/* Снимки стопкой: гость узнаёт свой заказ по виду, а не по списку */}
        <View style={[styles.stack, { width: THUMB + Math.max(0, photos.length - 1) * OVERLAP }]}>
          {photos.map((uri, index) => (
            <Image
              key={uri}
              source={{ uri }}
              style={[
                styles.thumb,
                {
                  left: index * OVERLAP,
                  zIndex: photos.length - index,
                  borderColor: theme.colors.surface,
                  backgroundColor: theme.colors.skeleton,
                },
              ]}
              contentFit="cover"
              transition={200}
            />
          ))}

          {photos.length === 0 ? (
            <View
              style={[
                styles.thumb,
                styles.center,
                { borderColor: theme.colors.surface, backgroundColor: theme.colors.brandSubtle },
              ]}
            >
              <Ionicons name="repeat" size={17} color={theme.colors.brand} />
            </View>
          ) : null}
        </View>

        <View style={styles.grow}>
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
            Заказать снова
          </Text>
          <Text
            numberOfLines={1}
            style={[theme.typography.caption, { color: theme.colors.textSecondary }]}
          >
            {names}
          </Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            {whenLabel(daysSince(last.created_at, now))} · {formatPrice(last.total_kopecks)}
          </Text>
        </View>

        {/* Значок вместо кнопки: нажимается вся карточка, промахнуться негде */}
        <View
          style={[
            styles.action,
            styles.center,
            { borderRadius: theme.radius.pill, backgroundColor: theme.colors.brand },
          ]}
        >
          <Ionicons name="repeat" size={19} color={theme.colors.textOnBrand} />
        </View>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1, minWidth: 0, gap: 1 },
  stack: { height: THUMB },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 2,
  },
  action: { width: 40, height: 40 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
