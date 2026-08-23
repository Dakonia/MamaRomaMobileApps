import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import { api, type Reservation } from '@/api/client';
import { PressableScale } from '@/components/pressable-scale';
import { guestsLabel } from '@/lib/dates';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

const LIVE: Reservation['status'][] = ['requested', 'confirmed', 'seated'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** «Сегодня 19:30», «завтра 20:00», иначе «сб, 24 · 19:30». */
function when(iso: string): string {
  const at = new Date(iso);
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;

  const today = new Date();
  const days = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  );

  if (days === 0) return `сегодня в ${clock}`;
  if (days === 1) return `завтра в ${clock}`;
  return `${WEEKDAYS[at.getDay()]}, ${at.getDate()} · ${clock}`;
}

/**
 * Ближайшая бронь в профиле: одна строка с датой и рестораном. Подробности и
 * отмена живут на своём экране — сюда выносим только напоминание.
 */
export function ReservationStrip() {
  const theme = useTheme();
  const session = useSession();

  const reservations = useQuery({
    queryKey: ['reservations'],
    queryFn: () => api.reservations(),
    enabled: session.status === 'authorized',
  });

  // Ближайшая по времени: их редко больше одной, но порядок важен
  const rows = (reservations.data ?? [])
    .filter((item) => LIVE.includes(item.status))
    .sort((a, b) => a.reserved_at.localeCompare(b.reserved_at));

  const next = rows[0];
  if (next === undefined) return null;

  const waiting = next.status === 'requested';
  const tone = waiting ? theme.colors.warning : theme.colors.accent;

  return (
    <Animated.View entering={FadeInDown.duration(260)} layout={LinearTransition}>
      <PressableScale
        depth={0.99}
        accessibilityLabel={`Бронь: ${next.restaurant_name}, ${when(next.reserved_at)}`}
        onPress={() => router.push('/reservations')}
        style={[
          styles.card,
          {
            borderRadius: theme.radius.xl,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            padding: theme.spacing.md,
            gap: theme.spacing.md,
          },
        ]}
      >
        <View
          style={[
            styles.icon,
            {
              width: theme.spacing.xxl,
              height: theme.spacing.xxl,
              borderRadius: theme.radius.md,
              backgroundColor: waiting ? theme.colors.warningSubtle : theme.colors.accentSubtle,
            },
          ]}
        >
          <Ionicons name="restaurant-outline" size={17} color={tone} />
        </View>

        <View style={styles.grow}>
          <Text
            numberOfLines={1}
            style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}
          >
            Стол {when(next.reserved_at)}
          </Text>
          <Text numberOfLines={1} style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {next.restaurant_name} · {guestsLabel(next.guests_count)}
          </Text>
        </View>

        {waiting ? (
          <Text style={[theme.typography.caption, { color: tone }]}>ждём ответа</Text>
        ) : null}

        {rows.length > 1 ? (
          <View
            style={{
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: theme.spacing.xxs,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.surfaceSunken,
            }}
          >
            <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
              +{rows.length - 1}
            </Text>
          </View>
        ) : null}

        <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  icon: { alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
});
