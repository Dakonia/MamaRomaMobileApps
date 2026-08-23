import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type ApiError, type Reservation } from '@/api/client';
import { AppDialog } from '@/components/app-dialog';
import { EmptyState } from '@/components/empty-state';
import { PizzaBackdrop } from '@/components/pizza-backdrop';
import { PressableScale } from '@/components/pressable-scale';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/components/screen-header';
import { Skeleton } from '@/components/skeleton';
import { formatDateTime, guestsLabel } from '@/lib/dates';
import { useRefresher } from '@/components/refresher';
import { useTheme } from '@/theme/theme-provider';

const LIVE: Reservation['status'][] = ['requested', 'confirmed', 'seated'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const STATUS: Record<
  Reservation['status'],
  { label: string; icon: keyof typeof Ionicons.glyphMap; tone: 'wait' | 'good' | 'off' }
> = {
  requested: { label: 'Ждём подтверждения', icon: 'hourglass-outline', tone: 'wait' },
  confirmed: { label: 'Стол забронирован', icon: 'checkmark-circle', tone: 'good' },
  seated: { label: 'Вы за столом', icon: 'restaurant', tone: 'good' },
  completed: { label: 'Завершена', icon: 'checkmark-done', tone: 'off' },
  cancelled: { label: 'Отменена', icon: 'close-circle-outline', tone: 'off' },
  no_show: { label: 'Гость не пришёл', icon: 'alert-circle-outline', tone: 'off' },
};

/** Бронь в виде билета: слева отрывной корешок с датой, справа подробности. */
function Ticket({
  item,
  onCancel,
  onCall,
}: {
  item: Reservation;
  onCancel?: () => void;
  onCall?: () => void;
}) {
  const theme = useTheme();
  const status = STATUS[item.status];
  const at = new Date(item.reserved_at);

  const tone =
    status.tone === 'good'
      ? theme.colors.accent
      : status.tone === 'wait'
        ? theme.colors.warning
        : theme.colors.textTertiary;

  return (
    <Animated.View
      entering={FadeInDown.duration(280)}
      layout={LinearTransition}
      style={[
        styles.ticket,
        theme.elevation.card,
        { borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface },
      ]}
    >
      <View
        style={[
          styles.stub,
          { backgroundColor: tone, paddingVertical: theme.spacing.base, gap: theme.spacing.xxs },
        ]}
      >
        <Text style={[theme.typography.overline, { color: 'rgba(255,255,255,0.85)' }]}>
          {WEEKDAYS[at.getDay()]}
        </Text>
        <Text style={{ fontFamily: theme.typography.h1.fontFamily, fontSize: 24, color: '#FFFFFF' }}>
          {at.getDate()}
        </Text>
        <Text style={[theme.typography.caption, { color: 'rgba(255,255,255,0.85)' }]}>
          {String(at.getHours()).padStart(2, '0')}:{String(at.getMinutes()).padStart(2, '0')}
        </Text>
      </View>

      <View style={[styles.grow, { padding: theme.spacing.base, gap: theme.spacing.xs }]}>
        <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
          {item.restaurant_name}
        </Text>

        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
          {formatDateTime(item.reserved_at)} · {guestsLabel(item.guests_count)}
        </Text>

        <View style={[styles.row, { gap: theme.spacing.xs }]}>
          <Ionicons name={status.icon} size={14} color={tone} />
          <Text style={[theme.typography.caption, { color: tone }]}>{status.label}</Text>
        </View>

        {onCancel || onCall ? (
          <View style={[styles.row, { gap: theme.spacing.lg, marginTop: theme.spacing.xs }]}>
            {onCall ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={theme.hitSlop}
                onPress={onCall}
                style={[styles.row, { gap: theme.spacing.xs, minHeight: theme.layout.minTouchTarget }]}
              >
                <Ionicons name="call-outline" size={14} color={theme.colors.brand} />
                <Text style={[theme.typography.bodyMedium, { color: theme.colors.brand }]}>
                  Позвонить
                </Text>
              </Pressable>
            ) : null}

            {onCancel ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={theme.hitSlop}
                onPress={onCancel}
                style={{ minHeight: theme.layout.minTouchTarget, justifyContent: 'center' }}
              >
                <Text style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>
                  Отменить
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

/** Брони гостя: активные сверху, прошедшие ниже. Здесь же отмена. */
export default function ReservationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const restaurants = useQuery({ queryKey: ['restaurants'], queryFn: () => api.restaurants() });
  const reservations = useQuery({
    queryKey: ['reservations'],
    queryFn: () => api.reservations(),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelReservation(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['reservations'] }),
    onError: (error: ApiError) => setFailure(error.message),
  });

  const refresher = useRefresher(() => reservations.refetch());

  const rows = reservations.data ?? [];
  const live = rows
    .filter((item) => LIVE.includes(item.status))
    .sort((a, b) => a.reserved_at.localeCompare(b.reserved_at));
  const past = rows
    .filter((item) => !LIVE.includes(item.status))
    .sort((a, b) => b.reserved_at.localeCompare(a.reserved_at));

  const phoneOf = (name: string) =>
    restaurants.data?.find((item) => item.name === name)?.phone ?? null;

  const title = (text: string) => (
    <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>{text}</Text>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.backgroundAlt }]}>
      <PizzaBackdrop strength={0.45} />

      <ScreenHeader title="Брони столов" onBack={() => router.back()} />

      <ScrollView
        refreshControl={refresher}
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          paddingBottom: insets.bottom + theme.spacing.xxxl,
          gap: theme.spacing.xl,
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
      >
        {reservations.isPending ? (
          [0, 1].map((key) => <Skeleton key={key} height={132} radius={theme.radius.xl} />)
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <EmptyState
              icon="restaurant-outline"
              art="booking"
              title="Броней пока нет"
              description="Забронируйте стол — он будет ждать вас к нужному времени."
            />
            <PrimaryButton label="Забронировать стол" onPress={() => router.replace('/booking')} />
          </View>
        ) : (
          <>
            {live.length > 0 ? (
              <View style={{ gap: theme.spacing.md }}>
                {title('Ближайшие')}
                {live.map((item) => (
                  <Ticket
                    key={item.id}
                    item={item}
                    onCancel={() => setCancelling(item.id)}
                    onCall={() => {
                      const phone = phoneOf(item.restaurant_name);
                      if (phone) void Linking.openURL(`tel:${phone}`);
                    }}
                  />
                ))}
              </View>
            ) : null}

            {past.length > 0 ? (
              <View style={{ gap: theme.spacing.md }}>
                {title('История')}
                {past.map((item) => (
                  <Ticket key={item.id} item={item} />
                ))}
              </View>
            ) : null}

            <PressableScale
              depth={0.99}
              accessibilityLabel="Забронировать ещё стол"
              onPress={() => router.replace('/booking')}
              style={[
                styles.more,
                {
                  minHeight: theme.layout.minTouchTarget + theme.spacing.xs,
                  borderRadius: theme.radius.pill,
                  gap: theme.spacing.sm,
                  backgroundColor: theme.colors.surface,
                },
              ]}
            >
              <Ionicons name="add" size={18} color={theme.colors.brand} />
              <Text style={[theme.typography.button, { color: theme.colors.brand }]}>
                Забронировать ещё
              </Text>
            </PressableScale>
          </>
        )}

        {failure ? (
          <Text style={[theme.typography.body, { color: theme.colors.danger }]}>{failure}</Text>
        ) : null}
      </ScrollView>

      <AppDialog
        visible={cancelling !== null}
        icon="close-circle"
        title="Отменить бронь?"
        description="Стол вернётся в свободные — если передумаете, забронируйте заново."
        confirmLabel="Отменить бронь"
        cancelLabel="Оставить"
        danger
        onConfirm={() => {
          if (cancelling) cancel.mutate(cancelling);
          setCancelling(null);
        }}
        onCancel={() => setCancelling(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  ticket: { flexDirection: 'row', overflow: 'hidden' },
  stub: { width: 76, alignItems: 'center', justifyContent: 'center' },
  empty: { flexGrow: 1, justifyContent: 'center', gap: 24 },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
