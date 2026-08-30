import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { api, mediaUrl, type ApiError, type Reservation, type Slot } from '@/api/client';
import { BookingDone } from '@/components/booking-done';
import { HallGallery } from '@/components/hall-gallery';
import { PizzaBackdrop } from '@/components/pizza-backdrop';
import { PressableScale } from '@/components/pressable-scale';
import { PrimaryButton } from '@/components/primary-button';
import { Skeleton } from '@/components/skeleton';
import { GuestLine } from '@/components/guest-line';
import { TextField } from '@/components/text-field';
import { dayLabel, guestsLabel, nextDays, toIsoDate } from '@/lib/dates';
import { track } from '@/lib/analytics';
import { keyboardScroll } from '@/lib/keyboard';
import { useCart } from '@/store/cart';
import { useSession } from '@/store/session';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRefresher } from '@/components/refresher';
import { useTheme } from '@/theme/theme-provider';

const DAYS_AHEAD = 14;
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** Поводы: гость отмечает одним касанием, ресторан заранее готовит зал. */
const OCCASIONS: { label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { label: 'День рождения', icon: 'gift-outline' },
  { label: 'Свидание', icon: 'heart-outline' },
  { label: 'Деловая встреча', icon: 'briefcase-outline' },
  { label: 'С детьми', icon: 'happy-outline' },
  { label: 'Большая компания', icon: 'people-outline' },
];

/**
 * Время суток: сетка на два десятка кнопок читается только разбитой на части.
 * Час берём из подписи — она уже в часовом поясе ресторана, а телефон гостя
 * может стоять в другом.
 */
function partOfDay(slot: Slot): 'day' | 'evening' {
  return Number(slot.label.slice(0, 2)) >= 17 ? 'evening' : 'day';
}

function isOpenNow(opens: string, closes: string): boolean {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const [openH, openM] = opens.split(':').map(Number);
  const [closeH, closeM] = closes.split(':').map(Number);
  const from = openH * 60 + openM;
  const to = closeH * 60 + closeM;
  return to > from ? minutes >= from && minutes <= to : minutes >= from || minutes <= to;
}

/** Плашка даты: день недели сверху, число крупно — как отрывной календарь. */
function DayCard({
  date,
  index,
  selected,
  onPress,
}: {
  date: Date;
  index: number;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pick = useDerivedValue(() => withSpring(selected ? 1 : 0, { damping: 15, stiffness: 170 }));

  // Карточка не растёт, а приподнимается: расти ей некуда — она упирается в край
  const animated = useAnimatedStyle(() => ({ transform: [{ translateY: -pick.value * 3 }] }));

  const weekend = date.getDay() === 0 || date.getDay() === 6;

  return (
    <Animated.View style={animated}>
      <PressableScale
        depth={0.96}
        accessibilityLabel={dayLabel(date, index)}
        onPress={onPress}
        style={[
          styles.day,
          selected ? theme.elevation.card : null,
          {
            paddingVertical: theme.spacing.md,
            borderRadius: theme.radius.lg,
            backgroundColor: selected ? theme.colors.brand : theme.colors.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: selected ? theme.colors.brand : theme.colors.border,
            gap: theme.spacing.xxs,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            theme.typography.overline,
            {
              letterSpacing: 0,
              color: selected
                ? 'rgba(255,255,255,0.85)'
                : weekend
                  ? theme.colors.brand
                  : theme.colors.textTertiary,
            },
          ]}
        >
          {index === 0 ? 'сегодня' : index === 1 ? 'завтра' : WEEKDAYS[date.getDay()]}
        </Text>

        <Text
          style={{
            fontFamily: theme.typography.h1.fontFamily,
            fontSize: 20,
            color: selected ? theme.colors.textOnBrand : theme.colors.textPrimary,
          }}
        >
          {date.getDate()}
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

/** Кнопка времени: выбранная наливается терракотой и слегка подрастает. */
function SlotChip({
  slot,
  selected,
  index,
  onPress,
}: {
  slot: Slot;
  selected: boolean;
  index: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const pick = useDerivedValue(() => withTiming(selected ? 1 : 0, { duration: 180 }));

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pick.value * 0.05 }],
  }));

  return (
    <Animated.View entering={FadeInDown.duration(240).delay(Math.min(index, 12) * 22)} style={animated}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={onPress}
        style={{
          paddingHorizontal: theme.spacing.base,
          paddingVertical: theme.spacing.sm,
          borderRadius: theme.radius.pill,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: selected ? theme.colors.brand : theme.colors.border,
          backgroundColor: selected ? theme.colors.brand : theme.colors.surface,
        }}
      >
        <Text
          style={[
            theme.typography.bodyMedium,
            { color: selected ? theme.colors.textOnBrand : theme.colors.textPrimary },
          ]}
        >
          {slot.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export default function BookingScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const session = useSession();
  const queryClient = useQueryClient();

  const days = useMemo(() => nextDays(DAYS_AHEAD), []);
  const [dayIndex, setDayIndex] = useState(0);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [guests, setGuests] = useState(2);
  const [occasion, setOccasion] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<Reservation | null>(null);

  const authorized = session.status === 'authorized';
  const selectedDate = toIsoDate(days[dayIndex]);

  const restaurants = useQuery({ queryKey: ['restaurants'], queryFn: () => api.restaurants() });
  const restaurant = restaurants.data?.find((item) => item.id === cart.restaurantId);

  /**
   * Залы сети для случая, когда ресторан ещё не выбран: по кадру с первых шести
   * точек. Порядок постоянный — витрина сети должна выглядеть одинаково у всех.
   */
  const hallShots = (restaurants.data ?? [])
    .map((item) => item.photos?.[0] ?? item.image_url)
    .filter((path): path is string => Boolean(path))
    .slice(0, 6)
    .map((path) => mediaUrl(path))
    .filter((uri): uri is string => Boolean(uri));

  const slots = useQuery({
    queryKey: ['slots', cart.restaurantId, selectedDate],
    queryFn: () => api.slots(cart.restaurantId ?? '', selectedDate),
    enabled: cart.restaurantId !== null,
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
        // Повод — это тоже пожелание к столу, ресторан читает его одной строкой
        comment: [occasion, comment.trim()].filter(Boolean).join('. ') || null,
        contact_name: null,
      }),
    onSuccess: (reservation) => {
      track('reservation_created', {
        guests: reservation.guests_count,
        occasion: occasion ?? null,
        days_ahead: dayIndex,
      });

      setDone(reservation);
      setSlotIso(null);
      setComment('');
      setOccasion(null);
      setFailure(null);
      invalidate();
    },
    onError: (error: ApiError) => setFailure(error.message),
  });

  // Занятое и уже прошедшее время не показываем: выбрать его нельзя,
  // а страницу оно растягивает вдвое
  const refresher = useRefresher(async () => {
    await Promise.all([slots.refetch(), restaurants.refetch()]);
  });

  const rows = (slots.data ?? []).filter((slot) => slot.is_available);
  const groups = [
    { key: 'day' as const, title: 'Днём', rows: rows.filter((slot) => partOfDay(slot) === 'day') },
    {
      key: 'evening' as const,
      title: 'Вечером',
      rows: rows.filter((slot) => partOfDay(slot) === 'evening'),
    },
  ].filter((group) => group.rows.length > 0);

  const ready = cart.restaurantId !== null && slotIso !== null;
  const chosen = rows.find((slot) => slot.starts_at === slotIso);

  const section = (title: string, hint?: string) => (
    <View style={{ gap: theme.spacing.xxs }}>
      <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>{title}</Text>
      {hint ? (
        <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>{hint}</Text>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.backgroundAlt }]}>
      {/* Тот же фон, что в корзине и профиле: за карточками плывут пиццы */}
      <PizzaBackdrop strength={0.45} />

      <ScrollView
        refreshControl={refresher}
        contentContainerStyle={{
          // Полоса вкладок занимает своё место в разметке и сама отступает от
          // системной полосы — добавлять её высоту сюда значит оставить пустоту
          paddingBottom: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
        {...keyboardScroll}
      >
        <HallGallery
          restaurant={restaurant}
          network={hallShots}
          loading={restaurants.isPending}
          open={
            restaurant ? isOpenNow(restaurant.opens_at, restaurant.closes_at) && !restaurant.is_paused : false
          }
          onChange={() => router.push('/restaurants')}
        />

        <View
          style={{
            padding: theme.layout.screenPadding,
            gap: theme.spacing.xl,
            paddingTop: theme.spacing.xxl,
          }}
        >
          <Animated.View entering={FadeInDown.duration(300)} style={{ gap: theme.spacing.md }}>
            {section('Когда придёте')}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -theme.layout.screenPadding }}
              contentContainerStyle={{
                paddingHorizontal: theme.layout.screenPadding,
                paddingVertical: theme.spacing.xs,
              }}
            >
              <View style={[styles.row, { gap: theme.spacing.sm }]}>
                {days.map((day, index) => (
                  <DayCard
                    key={day.toISOString()}
                    date={day}
                    index={index}
                    selected={index === dayIndex}
                    onPress={() => {
                      setDayIndex(index);
                      setSlotIso(null);
                    }}
                  />
                ))}
              </View>
            </ScrollView>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.duration(300).delay(60)}
            layout={LinearTransition}
            style={{ gap: theme.spacing.md }}
          >
            {section('Во сколько')}

            {cart.restaurantId === null ? (
              <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
                Сначала выберите ресторан — покажем его свободное время.
              </Text>
            ) : slots.isPending ? (
              <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((key) => (
                  <Skeleton key={key} width={78} height={40} radius={theme.radius.pill} />
                ))}
              </View>
            ) : slots.isError ? (
              <Text style={[theme.typography.body, { color: theme.colors.danger }]}>
                {slots.error.message}
              </Text>
            ) : groups.length === 0 ? (
              <View
                style={{
                  padding: theme.spacing.lg,
                  borderRadius: theme.radius.xl,
                  backgroundColor: theme.colors.surface,
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                }}
              >
                <Ionicons name="moon-outline" size={26} color={theme.colors.textTertiary} />
                <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                  {dayIndex === 0 ? 'На сегодня время закончилось' : 'На этот день мест нет'}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  Выберите другую дату — покажем свободное время.
                </Text>
              </View>
            ) : (
              groups.map((group) => (
                <View key={group.key} style={{ gap: theme.spacing.sm }}>
                  <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
                    {group.title}
                  </Text>
                  <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
                    {group.rows.map((slot, index) => (
                      <SlotChip
                        key={slot.starts_at}
                        slot={slot}
                        index={index}
                        selected={slot.starts_at === slotIso}
                        onPress={() => setSlotIso(slot.starts_at)}
                      />
                    ))}
                  </View>
                </View>
              ))
            )}
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(300).delay(120)} style={{ gap: theme.spacing.md }}>
            {section('Сколько вас')}

            <GuestLine value={guests} onChange={setGuests} />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(300).delay(180)} style={{ gap: theme.spacing.md }}>
            {section('Повод')}

            <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
              {OCCASIONS.map((item) => {
                const selected = occasion === item.label;

                return (
                  <PressableScale
                    key={item.label}
                    depth={0.97}
                    accessibilityLabel={item.label}
                    onPress={() => setOccasion(selected ? null : item.label)}
                    style={[
                      styles.row,
                      {
                        gap: theme.spacing.xs,
                        paddingHorizontal: theme.spacing.base,
                        paddingVertical: theme.spacing.sm,
                        borderRadius: theme.radius.pill,
                        backgroundColor: selected
                          ? theme.colors.accentSubtle
                          : theme.colors.surface,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: selected ? theme.colors.accent : theme.colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={item.icon}
                      size={15}
                      color={selected ? theme.colors.accent : theme.colors.textTertiary}
                    />
                    <Text
                      style={[
                        theme.typography.bodyMedium,
                        { color: selected ? theme.colors.accent : theme.colors.textPrimary },
                      ]}
                    >
                      {item.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(300).delay(240)}>
            <TextField label="Пожелания к столу" value={comment} onChangeText={setComment} />
          </Animated.View>


          <Animated.View
            entering={FadeInDown.duration(300).delay(300)}
            layout={LinearTransition}
            style={[
              theme.elevation.card,
              {
                padding: theme.spacing.base,
                borderRadius: theme.radius.xxl,
                backgroundColor: theme.colors.surface,
                gap: theme.spacing.md,
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
                    backgroundColor: ready ? theme.colors.accentSubtle : theme.colors.surfaceSunken,
                  },
                ]}
              >
                <Ionicons
                  name="restaurant-outline"
                  size={18}
                  color={ready ? theme.colors.accent : theme.colors.textTertiary}
                />
              </View>

              <View style={styles.grow}>
                <Text
                  numberOfLines={1}
                  style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}
                >
                  {ready
                    ? `${dayLabel(days[dayIndex], dayIndex)}, ${chosen?.label ?? ''} · ${guestsLabel(guests)}`
                    : 'Выберите дату и время'}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[theme.typography.caption, { color: theme.colors.textTertiary }]}
                >
                  {restaurant?.name ?? 'Ресторан не выбран'}
                </Text>
              </View>
            </View>

            <PrimaryButton
              label={!authorized ? 'Войти и забронировать' : 'Забронировать'}
              loading={book.isPending}
              disabled={authorized && !ready}
              onPress={() => {
                setFailure(null);
                if (!authorized) {
                  router.push('/auth');
                  return;
                }
                book.mutate();
              }}
            />
          </Animated.View>

          {failure ? (
            <Animated.View entering={FadeIn} style={[styles.row, { gap: theme.spacing.sm }]}>
              <Ionicons name="alert-circle" size={18} color={theme.colors.danger} />
              <Text style={[theme.typography.body, styles.grow, { color: theme.colors.danger }]}>
                {failure}
              </Text>
            </Animated.View>
          ) : null}

        </View>
      </ScrollView>

      <BookingDone
        reservation={done}
        phone={restaurant?.phone}
        onClose={() => setDone(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  grow: { flex: 1 },
  center: { textAlign: 'center' },
  icon: { alignItems: 'center', justifyContent: 'center' },
  day: { width: 76, alignItems: 'center', justifyContent: 'center' },
});
