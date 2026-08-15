import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { api, type ApiError, type Reservation } from '@/api/client';
import { ScreenHeader } from '@/components/screen-header';
import { dayLabel, formatDateTime, guestsLabel, nextDays, toIsoDate } from '@/lib/dates';
import { useCart } from '@/store/cart';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

const DAYS_AHEAD = 7;
const MAX_GUESTS = 12;

const STATUS_LABEL: Record<Reservation['status'], string> = {
  requested: 'Ждёт подтверждения',
  confirmed: 'Подтверждена',
  seated: 'Вы за столом',
  completed: 'Завершена',
  cancelled: 'Отменена',
  no_show: 'Гость не пришёл',
};

export default function BookingScreen() {
  const theme = useTheme();
  const cart = useCart();
  const session = useSession();
  const queryClient = useQueryClient();

  const days = nextDays(DAYS_AHEAD);
  const [dayIndex, setDayIndex] = useState(0);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [guests, setGuests] = useState(2);
  const [comment, setComment] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const authorized = session.status === 'authorized';
  const selectedDate = toIsoDate(days[dayIndex]);

  const restaurants = useQuery({ queryKey: ['restaurants'], queryFn: () => api.restaurants() });
  const restaurant = restaurants.data?.find((item) => item.id === cart.restaurantId);

  const slots = useQuery({
    queryKey: ['slots', cart.restaurantId, selectedDate],
    queryFn: () => api.slots(cart.restaurantId ?? '', selectedDate),
    enabled: cart.restaurantId !== null,
  });

  const reservations = useQuery({
    queryKey: ['reservations'],
    queryFn: () => api.reservations(),
    enabled: authorized,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    void slots.refetch();
  };

  const book = useMutation({
    mutationFn: () =>
      api.createReservation({
        restaurant_id: cart.restaurantId ?? '',
        reserved_at: slotIso ?? '',
        guests_count: guests,
        comment: comment.length > 0 ? comment : null,
        contact_name: null,
      }),
    onSuccess: () => {
      setSlotIso(null);
      setComment('');
      setFailure(null);
      invalidate();
    },
    onError: (error: ApiError) => setFailure(error.message),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelReservation(id),
    onSuccess: invalidate,
    onError: (error: ApiError) => setFailure(error.message),
  });

  const active = (reservations.data ?? []).filter(
    (item) => item.status === 'requested' || item.status === 'confirmed',
  );

  const chip = (label: string, selected: boolean, onPress: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          minHeight: theme.layout.minTouchTarget - theme.spacing.sm,
          paddingHorizontal: theme.spacing.base,
          borderRadius: theme.radius.pill,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: selected ? theme.colors.brand : theme.colors.border,
          backgroundColor: selected
            ? theme.colors.brand
            : pressed
              ? theme.colors.surfaceSunken
              : 'transparent',
          opacity: disabled ? 0.35 : 1,
        },
      ]}
    >
      <Text
        style={[
          theme.typography.bodyMedium,
          { color: selected ? theme.colors.textOnBrand : theme.colors.textPrimary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title="Бронь стола" subtitle="Столик в зале на нужное время" />

      <ScrollView
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing.xxxl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/restaurants')}
          style={[styles.row, { gap: theme.spacing.sm, minHeight: theme.layout.minTouchTarget }]}
        >
          <Ionicons name="location-outline" size={theme.spacing.lg} color={theme.colors.brand} />
          <Text
            numberOfLines={1}
            style={[theme.typography.bodyMedium, styles.grow, { color: theme.colors.textPrimary }]}
          >
            {restaurant?.name ?? 'Выберите ресторан'}
          </Text>
          <Text style={[theme.typography.caption, { color: theme.colors.brand }]}>Изменить</Text>
        </Pressable>

        <View style={{ gap: theme.spacing.md }}>
          <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
            Дата
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={[styles.rowWrap, { gap: theme.spacing.sm }]}>
              {days.map((day, index) =>
                chip(dayLabel(day, index), index === dayIndex, () => {
                  setDayIndex(index);
                  setSlotIso(null);
                }),
              )}
            </View>
          </ScrollView>
        </View>

        <View style={{ gap: theme.spacing.md }}>
          <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
            Время
          </Text>

          {slots.isPending ? (
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
              Смотрим свободные столы…
            </Text>
          ) : slots.isError ? (
            <Text style={[theme.typography.body, { color: theme.colors.danger }]}>
              {slots.error.message}
            </Text>
          ) : (
            <View style={[styles.rowWrap, { gap: theme.spacing.sm }]}>
              {(slots.data ?? []).map((slot) =>
                chip(
                  slot.label,
                  slot.starts_at === slotIso,
                  () => setSlotIso(slot.starts_at),
                  !slot.is_available,
                ),
              )}
            </View>
          )}
        </View>

        <View style={{ gap: theme.spacing.md }}>
          <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
            Гостей
          </Text>
          <View style={[styles.row, { gap: theme.spacing.lg }]}>
            <Pressable
              accessibilityRole="button"
              hitSlop={theme.hitSlop}
              onPress={() => setGuests(Math.max(1, guests - 1))}
            >
              <Ionicons
                name="remove-circle-outline"
                size={theme.spacing.xxl}
                color={theme.colors.textTertiary}
              />
            </Pressable>
            <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
              {guestsLabel(guests)}
            </Text>
            <Pressable
              accessibilityRole="button"
              hitSlop={theme.hitSlop}
              onPress={() => setGuests(Math.min(MAX_GUESTS, guests + 1))}
            >
              <Ionicons
                name="add-circle-outline"
                size={theme.spacing.xxl}
                color={theme.colors.brand}
              />
            </Pressable>
          </View>
        </View>

        <TextInput
          value={comment}
          onChangeText={setComment}
          placeholder="Пожелания: у окна, детский стул…"
          placeholderTextColor={theme.colors.textTertiary}
          style={[
            theme.typography.body,
            {
              color: theme.colors.textPrimary,
              backgroundColor: theme.colors.surfaceSunken,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.base,
              minHeight: theme.layout.minTouchTarget,
            },
          ]}
        />

        {failure ? (
          <Text style={[theme.typography.body, { color: theme.colors.danger }]}>{failure}</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={book.isPending || (authorized && slotIso === null)}
          onPress={() => {
            setFailure(null);
            if (!authorized) {
              router.push('/auth');
              return;
            }
            book.mutate();
          }}
          style={({ pressed }) => [
            styles.submit,
            {
              minHeight: theme.layout.minTouchTarget + theme.spacing.xs,
              borderRadius: theme.radius.pill,
              backgroundColor: pressed ? theme.colors.brandPressed : theme.colors.brand,
              opacity: book.isPending || (authorized && slotIso === null) ? 0.5 : 1,
            },
          ]}
        >
          <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
            {!authorized
              ? 'Войти и забронировать'
              : book.isPending
                ? 'Бронируем…'
                : 'Забронировать'}
          </Text>
        </Pressable>

        {active.length > 0 ? (
          <View style={{ gap: theme.spacing.md }}>
            <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
              Ваши брони
            </Text>

            {active.map((item) => (
              <View
                key={item.id}
                style={{
                  padding: theme.spacing.base,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.accentSubtle,
                  gap: theme.spacing.xxs,
                }}
              >
                <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
                  {formatDateTime(item.reserved_at)}
                </Text>
                <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
                  {item.restaurant_name} · {guestsLabel(item.guests_count)}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.accent }]}>
                  {STATUS_LABEL[item.status]}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={theme.hitSlop}
                  onPress={() => cancel.mutate(item.id)}
                  style={{ minHeight: theme.layout.minTouchTarget, justifyContent: 'center' }}
                >
                  <Text style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>
                    Отменить
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  grow: { flex: 1 },
  chip: { alignItems: 'center', justifyContent: 'center' },
  submit: { alignItems: 'center', justifyContent: 'center' },
});
