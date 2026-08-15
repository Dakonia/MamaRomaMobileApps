import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, mediaUrl } from '@/api/client';
import { EmptyState } from '@/components/empty-state';
import { PressableScale } from '@/components/pressable-scale';
import { formatPhone, phoneToUri } from '@/lib/format';
import { tenant } from '@/lib/tenant';
import { useCart } from '@/store/cart';
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
  const cart = useCart();
  const { id } = useLocalSearchParams<{ id: string }>();

  const heroHeight = width * 0.92;
  const scroll = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scroll.value = event.contentOffset.y;
  });

  const heroStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          scroll.value,
          [-heroHeight, 0, heroHeight],
          [0, 0, heroHeight * 0.4],
        ),
      },
      { scale: interpolate(scroll.value, [-heroHeight, 0], [1.6, 1], 'clamp') },
    ],
  }));

  const promos = useQuery({
    queryKey: ['promotions', cart.restaurantId],
    queryFn: () => api.promotions(cart.restaurantId ?? undefined),
  });

  const promotion = promos.data?.find((item) => item.id === id);

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

  // Адрес заведения импортёр дописывает отдельной строкой «Где: …»
  const [text, venue] = (promotion.description ?? '').split('\n\n');

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
          <View style={styles.center}>
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
        contentContainerStyle={{ paddingBottom: theme.spacing.huge * 2 }}
      >
        <View style={{ height: heroHeight - theme.spacing.xxl }} />

        <View
          style={{
            backgroundColor: theme.colors.background,
            borderTopLeftRadius: theme.radius.xxl,
            borderTopRightRadius: theme.radius.xxl,
            padding: theme.layout.screenPadding,
            paddingTop: theme.spacing.lg,
            gap: theme.spacing.md,
            minHeight: theme.spacing.huge * 5,
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

          {venue ? (
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <Ionicons
                name="location-outline"
                size={theme.spacing.lg}
                color={theme.colors.textTertiary}
              />
              <Text style={[theme.typography.body, styles.grow, { color: theme.colors.textSecondary }]}>
                {venue.replace(/^Где:\s*/, '')}
              </Text>
            </View>
          ) : null}

          {text ? (
            <Text
              style={[
                theme.typography.bodyLg,
                { color: theme.colors.textPrimary, marginTop: theme.spacing.xs },
              ]}
            >
              {text}
            </Text>
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
          onPress={() => {
            void Linking.openURL(phoneToUri(tenant.supportPhone));
          }}
          accessibilityLabel="Позвонить и записаться"
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
          <Ionicons name="call" size={theme.spacing.lg} color={theme.colors.textOnBrand} />
          <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
            Записаться · {formatPhone(tenant.supportPhone)}
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { position: 'absolute', top: 0, left: 0, right: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  veil: { position: 'absolute', top: 0, left: 0, right: 0 },
  grabber: { alignSelf: 'center' },
  label: { alignSelf: 'flex-start' },
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
