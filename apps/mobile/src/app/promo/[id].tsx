import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, mediaUrl } from '@/api/client';
import { phoneToUri } from '@/lib/format';
import { EmptyState } from '@/components/empty-state';
import { PressableScale } from '@/components/pressable-scale';
import { track } from '@/lib/analytics';
import { useTheme } from '@/theme/theme-provider';

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export default function PromoScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();

  const promos = useQuery({
    queryKey: ['promotions', 'all'],
    queryFn: () => api.promotions(),
  });

  const promotion = promos.data?.find((item) => item.id === id);

  // Какие акции открывают и какие из них делятся — по этому видно, что цепляет
  useEffect(() => {
    if (promotion) track('promo_opened', { title: promotion.title });
  }, [promotion]);

  const restaurants = useQuery({
    queryKey: ['restaurants'],
    queryFn: () => api.restaurants(),
    enabled: (promotion?.restaurant_ids.length ?? 0) > 0,
  });

  const venues = (restaurants.data ?? []).filter((restaurant) =>
    promotion?.restaurant_ids.includes(restaurant.id),
  );

  // Картинка занимает свою высоту, а не заданную наперёд: афиша вытянута
  // вверх, баннер доставки — вширь, и резать нельзя ни ту, ни другую
  const photoWidth = promotion?.image_width ?? 0;
  const photoHeight = promotion?.image_height ?? 0;
  const heroHeight =
    photoWidth > 0 && photoHeight > 0
      ? width * Math.min(1.25, Math.max(0.6, photoHeight / photoWidth))
      : width * 0.92;
  const scroll = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scroll.value = event.contentOffset.y;
  });

  const heroStyle = useAnimatedStyle(() => ({
    // Вниз картинка не сползает: раньше она выныривала из-под текста в конце
    transform: [
      {
        translateY: interpolate(
          scroll.value,
          [-heroHeight, 0, heroHeight],
          [0, 0, -heroHeight * 0.25],
          'clamp',
        ),
      },
      { scale: interpolate(scroll.value, [-heroHeight, 0], [1.6, 1], 'clamp') },
    ],
  }));

  if (promos.isPending) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <View style={{ height: heroHeight, backgroundColor: theme.colors.skeleton }} />
      </View>
    );
  }

  if (promotion === undefined) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <EmptyState
          icon="pricetags-outline"
          title="Акция не найдена"
          description="Возможно, она уже закончилась."
          actionLabel="Назад"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  const photo = mediaUrl(promotion.image_url);
  const starts = whenLabel(promotion.starts_at);
  const ends = whenLabel(promotion.ends_at);

  // Текст приходит с сайта построчно: список, адрес, телефон — каждый своей строкой
  const lines = (promotion.description ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Animated.View
        style={[
          styles.hero,
          { height: heroHeight, backgroundColor: theme.colors.surfaceSunken },
          heroStyle,
        ]}
      >
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={220}
          />
        ) : (
          <View style={styles.fill}>
            <Ionicons
              name="pricetags-outline"
              size={theme.spacing.huge}
              color={theme.colors.textTertiary}
            />
          </View>
        )}

        <LinearGradient
          colors={['rgba(0,0,0,0.42)', 'rgba(0,0,0,0)']}
          style={[styles.veil, { height: theme.spacing.huge * 2 }]}
          pointerEvents="none"
        />
      </Animated.View>

      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: theme.spacing.huge * 2 }}
      >
        <View style={{ height: heroHeight }} />

        <View
          style={{
            backgroundColor: theme.colors.background,
            borderTopLeftRadius: theme.radius.xxl,
            borderTopRightRadius: theme.radius.xxl,
            padding: theme.layout.screenPadding,
            paddingTop: theme.spacing.lg,
            gap: theme.spacing.md,
            flexGrow: 1,
          }}
        >
          <View
            style={[
              styles.grabber,
              {
                width: theme.spacing.xxxl,
                height: theme.spacing.xs,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.border,
              },
            ]}
          />

          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <View style={styles.grow}>
              {promotion.label ? (
                <View
                  style={[
                    styles.label,
                    {
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: theme.spacing.xxs,
                      borderRadius: theme.radius.pill,
                      backgroundColor: theme.colors.brand,
                    },
                  ]}
                >
                  <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
                    {promotion.label}
                  </Text>
                </View>
              ) : null}
            </View>

            {promotion.source_url ? (
              <PressableScale
                onPress={() => {
                  track('promo_shared', { title: promotion.title });
                  void Share.share({
                    message: `${promotion.title}\n${promotion.source_url}`,
                    url: promotion.source_url ?? '',
                  });
                }}
                accessibilityLabel="Поделиться акцией"
                depth={0.9}
                hitSlop={theme.spacing.md}
                style={{
                  width: theme.spacing.xxxl,
                  height: theme.spacing.xxxl,
                  borderRadius: theme.spacing.xxxl / 2,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="share-outline" size={19} color={theme.colors.textSecondary} />
              </PressableScale>
            ) : null}
          </View>

          <Text style={[theme.typography.display, { color: theme.colors.textPrimary }]}>
            {promotion.title}
          </Text>

          {starts || ends ? (
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <Ionicons name="calendar-outline" size={theme.spacing.lg} color={theme.colors.accent} />
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.accent }]}>
                {starts && ends ? `${starts} — ${ends}` : (starts ?? `до ${ends}`)}
              </Text>
            </View>
          ) : null}

          {lines.length > 0 ? (
            <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.xs }}>
              {lines.map((line, position) => {
                const bullet = /^[•\-–]\s*/.test(line);

                return (
                  <View
                    key={`${position}-${line.slice(0, 12)}`}
                    style={[styles.row, { gap: theme.spacing.sm }]}
                  >
                    {bullet ? (
                      <View
                        style={[
                          styles.bullet,
                          { marginTop: theme.spacing.sm, backgroundColor: theme.colors.brand },
                        ]}
                      />
                    ) : null}

                    <Text
                      style={[
                        theme.typography.bodyLg,
                        styles.grow,
                        { color: bullet ? theme.colors.textSecondary : theme.colors.textPrimary },
                      ]}
                    >
                      {bullet ? line.replace(/^[•\-–]\s*/, '') : line}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          {venues.length > 0 ? (
            <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.base }}>
              <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
                {venues.length === 1 ? 'Где проходит' : `Участвуют ${venues.length} ресторанов`}
              </Text>

              {venues.map((venue) => (
                <View
                  key={venue.id}
                  style={[
                    styles.row,
                    {
                      gap: theme.spacing.md,
                      padding: theme.spacing.md,
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.colors.surfaceSunken,
                    },
                  ]}
                >
                  <Ionicons name="location" size={theme.spacing.lg} color={theme.colors.brand} />

                  <View style={styles.grow}>
                    <Text
                      style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}
                    >
                      {venue.name}
                    </Text>
                    {venue.metro ? (
                      <Text
                        style={[theme.typography.caption, { color: theme.colors.textTertiary }]}
                      >
                        м. {venue.metro}
                      </Text>
                    ) : null}
                  </View>

                  {venue.phone ? (
                    <PressableScale
                      onPress={() => {
                        void Linking.openURL(phoneToUri(venue.phone ?? ''));
                      }}
                      accessibilityLabel={`Позвонить в ресторан ${venue.name}`}
                      depth={0.92}
                      style={[
                        styles.center,
                        {
                          width: theme.layout.minTouchTarget,
                          height: theme.layout.minTouchTarget,
                          borderRadius: theme.radius.pill,
                          backgroundColor: theme.colors.brand,
                        },
                      ]}
                    >
                      <Ionicons name="call" size={17} color={theme.colors.textOnBrand} />
                    </PressableScale>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </Animated.ScrollView>

      <PressableScale
        onPress={() => router.back()}
        accessibilityLabel="Закрыть"
        depth={0.9}
        style={[
          styles.close,
          {
            top: insets.top > 0 ? theme.spacing.md : theme.spacing.lg,
            left: theme.spacing.md,
            width: theme.layout.minTouchTarget,
            height: theme.layout.minTouchTarget,
          },
          styles.center,
        ]}
      >
        <Ionicons name="chevron-down" size={theme.spacing.xl} color="#FFFFFF" />
      </PressableScale>

      {promotion.show_in_menu ? (
        <View
          style={[
            styles.bar,
            {
              paddingHorizontal: theme.layout.screenPadding,
              paddingTop: theme.spacing.md,
              paddingBottom: insets.bottom + theme.spacing.md,
              backgroundColor: theme.colors.surface,
              borderTopColor: theme.colors.divider,
            },
          ]}
        >
          <PressableScale
            onPress={() => router.replace('/')}
            accessibilityLabel="Перейти в меню"
            depth={0.96}
            style={[
              styles.action,
              {
                minHeight: theme.layout.minTouchTarget + theme.spacing.xs,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.brand,
                gap: theme.spacing.sm,
                ...theme.elevation.raised,
              },
            ]}
          >
            <Ionicons name="bag-handle" size={theme.spacing.lg} color={theme.colors.textOnBrand} />
            <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
              Собрать заказ
            </Text>
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { position: 'absolute', top: 0, left: 0, right: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  veil: { position: 'absolute', top: 0, left: 0, right: 0 },
  grabber: { alignSelf: 'center' },
  label: { alignSelf: 'flex-start' },
  bullet: { width: 5, height: 5, borderRadius: 3 },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  close: { position: 'absolute' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
