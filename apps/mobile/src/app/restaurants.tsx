import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, mediaUrl, type City, type Restaurant } from '@/api/client';
import { EmptyState } from '@/components/empty-state';
import { PressableScale } from '@/components/pressable-scale';
import { Grabber } from '@/components/screen-header';
import { SearchField } from '@/components/search-field';
import { Skeleton } from '@/components/skeleton';
import { distanceKm, formatDistance } from '@/lib/geo';
import { useCoords } from '@/lib/use-coords';
import { useCart } from '@/store/cart';
import { useRefresher } from '@/components/refresher';
import { useTheme } from '@/theme/theme-provider';

/** «11:00:00» → «11:00». */
const hhmm = (value: string) => value.slice(0, 5);

/** Открыт ли ресторан прямо сейчас. */
function isOpen(restaurant: Restaurant): boolean {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const [openH, openM] = restaurant.opens_at.split(':').map(Number);
  const [closeH, closeM] = restaurant.closes_at.split(':').map(Number);

  const opens = openH * 60 + openM;
  const closes = closeH * 60 + closeM;

  // Заведение может закрываться после полуночи
  return closes > opens ? minutes >= opens && minutes <= closes : minutes >= opens || minutes <= closes;
}

/** Карточка точки: адрес, метро, часы и — если знаем — расстояние до неё. */
function RestaurantCard({
  restaurant,
  selected,
  distance,
  onPress,
}: {
  restaurant: Restaurant;
  selected: boolean;
  distance?: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const photo = mediaUrl(restaurant.image_url);
  const open = isOpen(restaurant);

  return (
    <PressableScale
      depth={0.98}
      accessibilityLabel={restaurant.name}
      onPress={onPress}
      style={[
        styles.card,
        selected ? theme.elevation.card : null,
        {
          gap: theme.spacing.md,
          padding: theme.spacing.md,
          borderRadius: theme.radius.xl,
          backgroundColor: selected ? theme.colors.brandSubtle : theme.colors.surfaceSunken,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? theme.colors.brand : theme.colors.border,
        },
      ]}
    >
      {photo ? (
        <Image
          source={{ uri: photo }}
          style={{
            width: 64,
            height: 64,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.skeleton,
          }}
          contentFit="cover"
          transition={200}
        />
      ) : null}

      <View style={styles.grow}>
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <Text
            numberOfLines={1}
            style={[theme.typography.bodyMedium, styles.grow, { color: theme.colors.textPrimary }]}
          >
            {restaurant.address}
          </Text>

          {distance === undefined ? null : (
            <View
              style={[
                styles.row,
                {
                  gap: theme.spacing.xxs,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: theme.spacing.xxs,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.colors.surface,
                },
              ]}
            >
              <Ionicons name="navigate" size={11} color={theme.colors.accent} />
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {formatDistance(distance)}
              </Text>
            </View>
          )}
        </View>

        {restaurant.metro ? (
          <View style={[styles.row, { gap: theme.spacing.xxs }]}>
            <Ionicons name="subway" size={12} color={theme.colors.textTertiary} />
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
              {restaurant.metro}
            </Text>
          </View>
        ) : null}

        <View style={[styles.row, { gap: theme.spacing.sm, marginTop: 2 }]}>
          <Text
            style={[
              theme.typography.caption,
              { color: open ? theme.colors.accent : theme.colors.textTertiary },
            ]}
          >
            {open ? 'Открыт' : 'Закрыт'} · {hhmm(restaurant.opens_at)}–{hhmm(restaurant.closes_at)}
          </Text>

          {restaurant.is_paused ? (
            <Text
              numberOfLines={1}
              style={[theme.typography.caption, { color: theme.colors.warning }]}
            >
              {restaurant.pause_reason ?? 'на паузе'}
            </Text>
          ) : null}
        </View>
      </View>

      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={20}
        color={selected ? theme.colors.brand : theme.colors.border}
      />
    </PressableScale>
  );
}

export default function RestaurantsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const here = useCoords();
  const [query, setQuery] = useState('');

  const restaurants = useQuery({ queryKey: ['restaurants'], queryFn: () => api.restaurants() });
  const cities = useQuery({ queryKey: ['cities'], queryFn: () => api.cities() });

  // Сколько до каждой точки: считаем один раз и переиспользуем в списке
  const distances = useMemo(() => {
    const map = new Map<string, number>();
    if (!here.coords) return map;

    for (const restaurant of restaurants.data ?? []) {
      map.set(restaurant.id, distanceKm(here.coords, restaurant));
    }

    return map;
  }, [here.coords, restaurants.data]);

  // Группируем по городам: у сети 34 точки в десяти городах, сплошным списком
  // это нечитаемо
  const groups = useMemo(() => {
    const text = query.trim().toLowerCase();
    const byCity = new Map<string, { city: City; rows: Restaurant[] }>();

    for (const city of cities.data ?? []) {
      byCity.set(city.id, { city, rows: [] });
    }

    for (const restaurant of restaurants.data ?? []) {
      if (
        text &&
        !restaurant.name.toLowerCase().includes(text) &&
        !restaurant.address.toLowerCase().includes(text) &&
        !(restaurant.metro ?? '').toLowerCase().includes(text)
      ) {
        continue;
      }
      byCity.get(restaurant.city_id)?.rows.push(restaurant);
    }

    // Внутри города ближайшие сверху: гость почти всегда забирает рядом с собой
    for (const group of byCity.values()) {
      group.rows.sort(
        (a, b) => (distances.get(a.id) ?? Infinity) - (distances.get(b.id) ?? Infinity),
      );
    }

    // Города тоже по близости: свой оказывается первым сам собой
    return [...byCity.values()]
      .filter((group) => group.rows.length > 0)
      .sort(
        (a, b) =>
          (distances.get(a.rows[0].id) ?? Infinity) - (distances.get(b.rows[0].id) ?? Infinity),
      );
  }, [cities.data, restaurants.data, query, distances]);

  // Три ближайшие точки отдельным блоком наверху
  const nearest = useMemo(() => {
    if (!here.coords || query.trim()) return [];

    return [...(restaurants.data ?? [])]
      .filter((restaurant) => distances.has(restaurant.id))
      .sort((a, b) => (distances.get(a.id) ?? 0) - (distances.get(b.id) ?? 0))
      .slice(0, 3);
  }, [here.coords, restaurants.data, distances, query]);

  const refresher = useRefresher(() => restaurants.refetch());

  const choose = (restaurant: Restaurant) => {
    cart.setMode('pickup');
    cart.selectPickup(restaurant.id);
    router.back();
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <View
        style={{
          paddingTop: theme.spacing.sm,
          paddingHorizontal: theme.layout.screenPadding,
          gap: theme.spacing.md,
        }}
      >
        <Grabber />

        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть"
            hitSlop={theme.hitSlop}
            onPress={() => router.back()}
            style={[
              styles.circle,
              {
                width: theme.layout.minTouchTarget,
                height: theme.layout.minTouchTarget,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.surfaceSunken,
              },
            ]}
          >
            <Ionicons name="chevron-back" size={22} color={theme.colors.textPrimary} />
          </Pressable>

          <Text style={[theme.typography.h1, styles.grow, { color: theme.colors.textPrimary }]}>
            Рестораны
          </Text>
        </View>

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Улица, метро или район"
          onLight
        />
      </View>

      <ScrollView
        refreshControl={refresher}
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          paddingBottom: insets.bottom + theme.spacing.xxxl,
          gap: theme.spacing.xl,
          flexGrow: 1,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {cart.items.length > 0 ? (
          <Text style={[theme.typography.caption, { color: theme.colors.warning }]}>
            Цены в ресторанах различаются — при смене корзина очистится
          </Text>
        ) : null}

        {/* Пока не знаем, где гость, — предлагаем сказать: список сразу станет полезнее */}
        {here.askable && !restaurants.isPending ? (
          <PressableScale
            depth={0.99}
            accessibilityLabel="Показать ближайшие рестораны"
            onPress={here.ask}
            style={[
              styles.row,
              {
                gap: theme.spacing.md,
                padding: theme.spacing.md,
                borderRadius: theme.radius.xl,
                backgroundColor: theme.colors.accentSubtle,
              },
            ]}
          >
            <Ionicons name="navigate-circle" size={22} color={theme.colors.accent} />
            <View style={styles.grow}>
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                Показать ближайшие
              </Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                Отсортируем рестораны по расстоянию от вас
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
          </PressableScale>
        ) : null}

        {nearest.length > 0 ? (
          <Animated.View
            entering={FadeIn.duration(200)}
            layout={LinearTransition}
            style={{ gap: theme.spacing.md }}
          >
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <Ionicons name="navigate" size={14} color={theme.colors.accent} />
              <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
                Рядом с вами
              </Text>
            </View>

            {nearest.map((restaurant) => (
              <RestaurantCard
                key={restaurant.id}
                restaurant={restaurant}
                selected={restaurant.id === cart.restaurantId}
                distance={distances.get(restaurant.id)}
                onPress={() => choose(restaurant)}
              />
            ))}
          </Animated.View>
        ) : null}

        {restaurants.isPending ? (
          [0, 1, 2].map((key) => <Skeleton key={key} height={96} radius={theme.radius.xl} />)
        ) : groups.length === 0 ? (
          <EmptyState
            icon="search-outline"
            art="search"
            title="Ничего не нашли"
            description="Попробуйте другую улицу или станцию метро."
          />
        ) : (
          groups.map((group) => (
            <Animated.View
              key={group.city.id}
              entering={FadeIn.duration(200)}
              layout={LinearTransition}
              style={{ gap: theme.spacing.md }}
            >
              <View style={[styles.row, { gap: theme.spacing.sm }]}>
                <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
                  {group.city.name}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                  {group.rows.length}
                </Text>
              </View>

              {group.rows.map((restaurant) => (
                <RestaurantCard
                  key={restaurant.id}
                  restaurant={restaurant}
                  selected={restaurant.id === cart.restaurantId}
                  distance={distances.get(restaurant.id)}
                  onPress={() => choose(restaurant)}
                />
              ))}
            </Animated.View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  circle: { alignItems: 'center', justifyContent: 'center' },
  card: { flexDirection: 'row', alignItems: 'center' },
});
