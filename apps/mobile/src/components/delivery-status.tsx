import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { DeliveryResolve } from '@/api/client';
import { formatPrice } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';

type Props = {
  delivery: DeliveryResolve | null;
  subtotalKopecks: number;
  /** Адреса ещё нет: считать нечего, но сказать что-то полезное надо. */
  hasAddress: boolean;
};

type PickupProps = {
  /** Часы работы выбранного ресторана: 11:00:00. */
  opensAt?: string;
  closesAt?: string;
  paused?: string | null;
};

/** Минуты от полуночи: 11:00 → 660. */
function minutesOf(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Мигающая точка: доставка работает прямо сейчас. */
function Pulse({ color }: { color: string }) {
  const beat = useSharedValue(0);

  useEffect(() => {
    beat.value = withRepeat(
      withSequence(withTiming(1, { duration: 700 }), withDelay(300, withTiming(0, { duration: 500 }))),
      -1,
      false,
    );
  }, [beat]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.45 + 0.55 * beat.value,
    transform: [{ scale: 0.85 + 0.25 * beat.value }],
  }));

  return <Animated.View style={[styles.dot, style, { backgroundColor: color }]} />;
}

/**
 * Строка под переключателем: когда привезут и сколько осталось до бесплатной
 * доставки. Второе прямо влияет на средний чек, поэтому полоса заметная.
 */
export function DeliveryStatus({ delivery, subtotalKopecks, hasAddress }: Props) {
  const theme = useTheme();

  const free = delivery?.free_delivery_from_kopecks ?? null;
  const left = free === null ? 0 : Math.max(0, free - subtotalKopecks);
  const share = free === null || free === 0 ? 0 : Math.min(1, subtotalKopecks / free);

  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withTiming(share, { duration: 600 });
  }, [fill, share]);

  const bar = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  // Без адреса всё равно объясняем, что будет дальше, а не прячем строку
  if (delivery === null) {
    return (
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <Ionicons name="time-outline" size={13} color={theme.colors.onHeroMuted} />
        <Text style={[theme.typography.caption, { color: theme.colors.onHeroMuted }]}>
          {hasAddress
            ? 'Считаем условия доставки…'
            : 'Укажите адрес — покажем время и стоимость доставки'}
        </Text>
      </View>
    );
  }

  const open = delivery.delivery_open_now && delivery.covered;
  const opensAt = delivery.delivery_opens_at?.slice(0, 5);

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        {open ? (
          <Pulse color={theme.colors.accent} />
        ) : (
          <Ionicons name="moon" size={13} color={theme.colors.onHeroMuted} />
        )}

        <Text style={[theme.typography.caption, styles.grow, { color: theme.colors.onHeroMuted }]}>
          {!delivery.covered
            ? 'Сюда не доставляем — можно забрать самим'
            : open
              ? delivery.delivery_minutes
                ? `Привезём примерно за ${delivery.delivery_minutes} минут`
                : `Доставка ${
                    delivery.delivery_price_kopecks > 0
                      ? formatPrice(delivery.delivery_price_kopecks)
                      : 'бесплатно'
                  }`
              : `Доставка закрыта${opensAt ? `, откроется в ${opensAt}` : ''}`}
        </Text>

        {free !== null && left > 0 ? (
          <Text style={[theme.typography.caption, { color: theme.colors.onHero }]}>
            до бесплатной {formatPrice(left)}
          </Text>
        ) : free !== null ? (
          <Text style={[theme.typography.caption, { color: theme.colors.accent }]}>
            доставка бесплатно
          </Text>
        ) : delivery.min_order_kopecks > 0 ? (
          <Text style={[theme.typography.caption, { color: theme.colors.onHero }]}>
            заказ от {formatPrice(delivery.min_order_kopecks)}
          </Text>
        ) : null}
      </View>

      {free !== null && left > 0 ? (
        <View style={[styles.track, { backgroundColor: theme.colors.heroRaised }]}>
          <Animated.View style={[styles.fill, bar, { backgroundColor: theme.colors.accent }]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
});


/**
 * Тот же ряд, но для самовывоза: часы ресторана и напоминание, что
 * минимальной суммы здесь нет.
 */
export function PickupStatus({ opensAt, closesAt, paused }: PickupProps) {
  const theme = useTheme();

  if (!opensAt || !closesAt) {
    return (
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <Ionicons name="storefront-outline" size={13} color={theme.colors.onHeroMuted} />
        <Text style={[theme.typography.caption, { color: theme.colors.onHeroMuted }]}>
          Выберите ресторан — покажем часы работы
        </Text>
      </View>
    );
  }

  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const opens = minutesOf(opensAt);
  const closes = minutesOf(closesAt);
  const open =
    closes > opens ? minutes >= opens && minutes <= closes : minutes >= opens || minutes <= closes;

  return (
    <View style={[styles.row, { gap: theme.spacing.sm }]}>
      {open && !paused ? (
        <Pulse color={theme.colors.accent} />
      ) : (
        <Ionicons name="moon" size={13} color={theme.colors.onHeroMuted} />
      )}

      <Text style={[theme.typography.caption, styles.grow, { color: theme.colors.onHeroMuted }]}>
        {paused
          ? paused
          : open
            ? `Открыт до ${closesAt.slice(0, 5)}`
            : `Закрыт, откроется в ${opensAt.slice(0, 5)}`}
      </Text>
    </View>
  );
}
