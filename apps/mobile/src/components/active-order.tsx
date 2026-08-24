import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { api, type Order } from '@/api/client';
import { hideLiveOrder, showLiveOrder } from '@/lib/live-order';
import { PressableScale } from '@/components/pressable-scale';
import { useSession } from '@/store/session';
import type { Theme } from '@/theme';
import { useTheme } from '@/theme/theme-provider';

const DONE: Order['status'][] = ['completed', 'cancelled'];

/** Четыре понятных гостю этапа: подписи зависят от способа получения. */
const STEPS: Record<Order['type'], string[]> = {
  delivery: ['Принят', 'Готовим', 'В пути', 'У вас'],
  pickup: ['Принят', 'Готовим', 'Готов', 'Забрали'],
};

type Tone = 'wait' | 'live' | 'done' | 'off';

/** Что показываем на каждом статусе: подпись, значок, этап и настроение. */
const STATUS: Record<
  Order['status'],
  { label: string; icon: keyof typeof Ionicons.glyphMap; step: number; tone: Tone }
> = {
  created: { label: 'Ждём подтверждения', icon: 'hourglass-outline', step: 0, tone: 'wait' },
  paid: { label: 'Оплачен, ждём ресторан', icon: 'card-outline', step: 0, tone: 'wait' },
  accepted: { label: 'Ресторан принял заказ', icon: 'thumbs-up-outline', step: 0, tone: 'live' },
  cooking: { label: 'Готовим', icon: 'flame-outline', step: 1, tone: 'live' },
  ready: { label: 'Заказ готов', icon: 'bag-check-outline', step: 2, tone: 'live' },
  delivering: { label: 'Курьер в пути', icon: 'bicycle-outline', step: 2, tone: 'live' },
  completed: { label: 'Заказ выполнен', icon: 'checkmark-done', step: 3, tone: 'done' },
  cancelled: { label: 'Заказ отменён', icon: 'close-circle-outline', step: 0, tone: 'off' },
};

/**
 * Цвет статуса — базилик, терракота остаётся за действиями. Ожидание красим
 * шафраном: гость видит, что мяч на стороне ресторана.
 */
function toneColor(theme: Theme, tone: Tone): { fill: string; subtle: string } {
  if (tone === 'wait') return { fill: theme.colors.warning, subtle: theme.colors.warningSubtle };
  if (tone === 'off') return { fill: theme.colors.textTertiary, subtle: theme.colors.surfaceSunken };
  return { fill: theme.colors.accent, subtle: theme.colors.accentSubtle };
}

function clock(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** Точка этапа: пройденный — с галочкой, текущий — с живым ореолом. */
function StepDot({ state, fill }: { state: 'past' | 'now' | 'next'; fill: string }) {
  const theme = useTheme();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (state !== 'now') return;

    pulse.value = withRepeat(
      withSequence(withTiming(1, { duration: 1100 }), withTiming(0, { duration: 1100 })),
      -1,
      false,
    );
  }, [pulse, state]);

  const halo = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - pulse.value),
    transform: [{ scale: 1 + pulse.value * 0.9 }],
  }));

  if (state === 'next') {
    return (
      <View
        style={[styles.dot, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
      />
    );
  }

  return (
    <View style={styles.dotBox}>
      {state === 'now' ? (
        <Animated.View style={[styles.halo, halo, { backgroundColor: fill }]} />
      ) : null}

      <View style={[styles.dot, { backgroundColor: fill, borderColor: fill }]}>
        {state === 'past' ? <Ionicons name="checkmark" size={11} color="#FFFFFF" /> : null}
      </View>
    </View>
  );
}

/**
 * Строка активного заказа: статус, время и лесенка этапов. Стоит в меню и в
 * профиле, чтобы за статусом не приходилось ходить в историю.
 */
export function ActiveOrder({ compact }: { compact?: boolean }) {
  const theme = useTheme();
  const session = useSession();

  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.orders(),
    enabled: session.status === 'authorized',
    staleTime: 0,
    // Пока заказ едет, статус подтягиваем сами
    refetchInterval: (query) =>
      (query.state.data ?? []).some((order) => !DONE.includes(order.status)) ? 30_000 : false,
  });

  const order = (orders.data ?? []).find((row) => !DONE.includes(row.status));

  // Живое табло в шторке телефона: обновляется вместе со статусом
  useEffect(() => {
    if (order) void showLiveOrder(order);
    else void hideLiveOrder();
  }, [order?.id, order?.status]);

  if (order === undefined) return null;

  const status = STATUS[order.status];
  const tone = toneColor(theme, status.tone);
  const steps = STEPS[order.type];
  const delivery = order.type === 'delivery';

  return (
    <Animated.View entering={FadeInDown.duration(260)}>
      <PressableScale
        depth={0.99}
        accessibilityLabel={`Заказ ${order.number}: ${status.label}`}
        onPress={() => router.push(`/order/${order.id}`)}
        style={[
          compact ? null : theme.elevation.card,
          styles.card,
          {
            borderRadius: theme.radius.xl,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            padding: theme.spacing.base,
            gap: theme.spacing.base,
          },
        ]}
      >
        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <View
            style={[
              styles.icon,
              {
                width: theme.spacing.xxl,
                height: theme.spacing.xxl,
                borderRadius: theme.radius.md,
                backgroundColor: tone.subtle,
              },
            ]}
          >
            <Ionicons name={status.icon} size={18} color={tone.fill} />
          </View>

          <View style={styles.grow}>
            <Text
              numberOfLines={1}
              style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}
            >
              {status.label}
            </Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
              № {order.number} · {delivery ? 'доставка' : 'самовывоз'}
            </Text>
          </View>

          <View style={styles.time}>
            <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
              {delivery ? 'привезём' : 'заберёте'}
            </Text>
            <Text
              style={{
                fontFamily: theme.typography.h2.fontFamily,
                fontSize: 17,
                color: theme.colors.textPrimary,
              }}
            >
              {order.delivery_at ? clock(order.delivery_at) : 'скоро'}
            </Text>
          </View>

          <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
        </View>

        <View style={styles.row}>
          {steps.map((label, index) => {
            const state = index < status.step ? 'past' : index === status.step ? 'now' : 'next';
            const reached = index <= status.step;

            return (
              <View key={label} style={[styles.step, { gap: theme.spacing.xs }]}>
                <View style={styles.row}>
                  <View
                    style={[
                      styles.line,
                      {
                        backgroundColor: reached ? tone.fill : theme.colors.border,
                        opacity: index === 0 ? 0 : 1,
                      },
                    ]}
                  />

                  <StepDot state={state} fill={tone.fill} />

                  <View
                    style={[
                      styles.line,
                      {
                        backgroundColor: index < status.step ? tone.fill : theme.colors.border,
                        opacity: index === steps.length - 1 ? 0 : 1,
                      },
                    ]}
                  />
                </View>

                <Text
                  numberOfLines={1}
                  style={[
                    theme.typography.caption,
                    {
                      fontSize: 11,
                      color: reached ? theme.colors.textPrimary : theme.colors.textTertiary,
                    },
                  ]}
                >
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  icon: { alignItems: 'center', justifyContent: 'center' },
  time: { alignItems: 'flex-end' },
  step: { flex: 1, alignItems: 'center' },
  dotBox: { alignItems: 'center', justifyContent: 'center' },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: { position: 'absolute', width: 18, height: 18, borderRadius: 9 },
  line: { flex: 1, height: 2 },
});
