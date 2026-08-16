import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, mediaUrl } from '@/api/client';
import { EmptyState } from '@/components/empty-state';
import { PressableScale } from '@/components/pressable-scale';
import { formatPrice } from '@/lib/format';
import { cartSubtotal, useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

// Лёгкий перелёт в конце — движение читается как живое, а не как разгон по линейке
const SPRING = { damping: 17, stiffness: 130, mass: 0.9 };

export default function DishScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cart = useCart();
  const { id, x, y, w, h } = useLocalSearchParams<{
    id: string;
    x?: string;
    y?: string;
    w?: string;
    h?: string;
  }>();

  const heroHeight = width;

  // Замер из сетки. Мусорные значения отбрасываем — из-за них раскрытие дёргалось
  const rect =
    x && y && w && h && Number(w) > 40 && Number(h) > 40
      ? { x: Number(x), y: Number(y), width: Number(w), height: Number(h) }
      : null;

  const grow = useSharedValue(rect === null ? 1 : 0);
  const scroll = useSharedValue(0);

  useEffect(() => {
    if (rect === null) return;

    // Стартуем со следующего кадра: до первой отрисовки пружина срывается
    const frame = requestAnimationFrame(() => {
      grow.value = withSpring(1, SPRING);
    });
    return () => cancelAnimationFrame(frame);
    // Замер приходит один раз при открытии
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = useAnimatedScrollHandler((event) => {
    scroll.value = event.contentOffset.y;
  });

  const start = rect ?? { x: 0, y: 0, width, height: heroHeight };

  const heroStyle = useAnimatedStyle(() => {
    const progress = Math.min(grow.value, 1);
    const parallax = interpolate(
      scroll.value,
      [-heroHeight, 0, heroHeight],
      [0, 0, heroHeight * 0.4],
    );

    return {
      left: interpolate(progress, [0, 1], [start.x, 0]),
      top: interpolate(progress, [0, 1], [start.y, 0]),
      width: interpolate(progress, [0, 1], [start.width, width]),
      height: interpolate(progress, [0, 1], [start.height, heroHeight]),
      borderRadius: interpolate(progress, [0, 1], [theme.radius.xl, 0]),
      transform: [
        { translateY: parallax * progress },
        { scale: interpolate(scroll.value, [-heroHeight, 0], [1.5, 1], 'clamp') },
      ],
    };
  });

  // Название переезжает из-под карточки на снимок и по дороге вырастает
  const titleStyle = useAnimatedStyle(() => {
    const progress = Math.min(grow.value, 1);
    return {
      left: interpolate(progress, [0, 1], [start.x + theme.spacing.md, theme.layout.screenPadding]),
      top: interpolate(
        progress,
        [0, 1],
        [start.y + start.height + theme.spacing.xs, heroHeight - theme.spacing.huge],
      ),
      width: interpolate(progress, [0, 1], [start.width, width - theme.layout.screenPadding * 2]),
      fontSize: interpolate(
        progress,
        [0, 1],
        [theme.typography.bodyMedium.fontSize, theme.typography.display.fontSize],
      ),
      opacity: interpolate(progress, [0, 0.12, 1], [0, 1, 1]),
    };
  });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.min(grow.value, 1), [0, 0.35, 1], [0, 1, 1]),
  }));

  const veilStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.min(grow.value, 1), [0, 0.8, 1], [0, 0.35, 1]),
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.min(grow.value, 1), [0, 0.62, 1], [0, 0, 1]),
    transform: [
      { translateY: interpolate(Math.min(grow.value, 1), [0, 1], [theme.spacing.xxl, 0]) },
    ],
  }));

  const menu = useQuery({
    queryKey: ['menu', cart.restaurantId],
    queryFn: () => api.menu(cart.restaurantId ?? undefined),
    enabled: cart.restaurantId !== null,
  });

  const dish = menu.data?.categories
    .flatMap((category) => category.dishes)
    .find((item) => item.id === id);

  const category = menu.data?.categories.find((item) =>
    item.dishes.some((entry) => entry.id === id),
  );

  const quantity = cart.items.find((item) => item.dishId === id)?.quantity ?? 0;

  if (menu.isPending) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <View style={{ height: heroHeight, backgroundColor: theme.colors.skeleton }} />
      </View>
    );
  }

  if (dish === undefined) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <EmptyState
          icon="restaurant-outline"
          title="Блюдо не найдено"
          description="Похоже, его убрали из меню."
          actionLabel="Назад"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  const photo = mediaUrl(dish.image_url);

  const badges = [
    dish.is_new ? { text: 'Новинка', background: theme.colors.brand } : null,
    dish.is_spicy ? { text: 'Остро', background: theme.colors.danger } : null,
    dish.is_vegetarian ? { text: 'Веган', background: theme.colors.accent } : null,
  ].filter((badge): badge is { text: string; background: string } => badge !== null);

  const round = (value: number | null | undefined) =>
    value === null || value === undefined ? null : String(Math.round(value));

  const nutrition = [
    { label: 'ккал', value: dish.calories ? String(dish.calories) : null, unit: '' },
    { label: 'белки', value: round(dish.proteins_g), unit: 'г' },
    { label: 'жиры', value: round(dish.fats_g), unit: 'г' },
    { label: 'углеводы', value: round(dish.carbs_g), unit: 'г' },
  ].filter((item): item is { label: string; value: string; unit: string } => item.value !== null);

  const measure = [
    dish.weight_grams ? `${dish.weight_grams} г` : null,
    dish.volume_ml ? `${dish.volume_ml} мл` : null,
  ].filter((value): value is string => value !== null);

  const addToCart = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    cart.add(dish);
  };

  return (
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]} pointerEvents="none">
        <BlurView
          intensity={theme.isDark ? 60 : 40}
          tint={theme.isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background }, veilStyle]}
        />
      </Animated.View>

      <Animated.View
        style={[styles.hero, { backgroundColor: theme.colors.surfaceSunken }, heroStyle]}
      >
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <Ionicons
              name="restaurant-outline"
              size={theme.spacing.huge}
              color={theme.colors.textTertiary}
            />
          </View>
        )}

        <LinearGradient
          colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']}
          style={[styles.veilTop, { height: theme.spacing.huge * 2 }]}
          pointerEvents="none"
        />
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)']}
          style={[styles.veilBottom, { height: theme.spacing.huge * 2.4 }]}
          pointerEvents="none"
        />
      </Animated.View>

      <Animated.Text
        numberOfLines={2}
        style={[
          styles.title,
          {
            color: '#FFFFFF',
            fontFamily: theme.typography.display.fontFamily,
            lineHeight: theme.typography.display.lineHeight,
          },
          titleStyle,
        ]}
      >
        {dish.name}
      </Animated.Text>

      <Animated.ScrollView
        style={contentStyle}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: theme.spacing.huge * 2.5 }}
      >
        <View style={{ height: heroHeight - theme.spacing.lg }} />

        <View
          style={{
            backgroundColor: theme.colors.background,
            borderTopLeftRadius: theme.radius.xxl,
            borderTopRightRadius: theme.radius.xxl,
            padding: theme.layout.screenPadding,
            paddingTop: theme.spacing.lg,
            gap: theme.spacing.base,
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

          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            {category ? (
              <Text style={[theme.typography.overline, { color: theme.colors.brand }]}>
                {category.name}
              </Text>
            ) : null}

            {measure.length > 0 ? (
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                {measure.join(' · ')}
              </Text>
            ) : null}

            {badges.map((badge) => (
              <View
                key={badge.text}
                style={{
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: theme.spacing.xxs,
                  borderRadius: theme.radius.sm,
                  backgroundColor: badge.background,
                }}
              >
                <Text style={[theme.typography.overline, { color: theme.colors.onHero }]}>
                  {badge.text}
                </Text>
              </View>
            ))}
          </View>

          {nutrition.length > 0 ? (
            <View
              style={[
                styles.nutrition,
                {
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surfaceSunken,
                  paddingVertical: theme.spacing.base,
                },
              ]}
            >
              {nutrition.map((item, index) => (
                <View
                  key={item.label}
                  style={[
                    styles.cell,
                    { gap: theme.spacing.xxs },
                    index > 0
                      ? {
                          borderLeftWidth: StyleSheet.hairlineWidth,
                          borderLeftColor: theme.colors.border,
                        }
                      : null,
                  ]}
                >
                  <Text style={[theme.typography.h2, { color: theme.colors.textPrimary }]}>
                    {item.value}
                    {item.unit ? (
                      <Text
                        style={[theme.typography.caption, { color: theme.colors.textTertiary }]}
                      >
                        {' '}
                        {item.unit}
                      </Text>
                    ) : null}
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                    {item.label}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {dish.description ? (
            <Text style={[theme.typography.bodyLg, { color: theme.colors.textPrimary }]}>
              {dish.description}
            </Text>
          ) : null}

          {dish.composition ? (
            <View style={{ gap: theme.spacing.xs }}>
              <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
                Состав
              </Text>
              <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
                {dish.composition}
              </Text>
            </View>
          ) : null}

          {!dish.is_available ? (
            <View
              style={{
                padding: theme.spacing.base,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.dangerSubtle,
              }}
            >
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>
                Сегодня закончилось. Загляните завтра или выберите другой ресторан.
              </Text>
            </View>
          ) : null}
        </View>
      </Animated.ScrollView>

      <Animated.View style={[StyleSheet.absoluteFill, contentStyle]} pointerEvents="box-none">
        <PressableScale
          onPress={() => router.back()}
          accessibilityLabel="Закрыть"
          depth={0.9}
          style={[
            styles.close,
            styles.center,
            {
              // Под системной строкой, а не поверх часов
              top: insets.top + theme.spacing.xs,
              left: theme.spacing.md,
              width: theme.layout.minTouchTarget,
              height: theme.layout.minTouchTarget,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.overlay,
            },
          ]}
        >
          <Ionicons name="chevron-down" size={theme.spacing.xl} color="#FFFFFF" />
        </PressableScale>
      </Animated.View>

      {dish.is_available ? (
        <Animated.View style={[styles.bar, contentStyle]}>
          <BlurView
            intensity={theme.isDark ? 40 : 60}
            tint={theme.isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.barInner,
              {
                paddingHorizontal: theme.layout.screenPadding,
                paddingTop: theme.spacing.md,
                paddingBottom: insets.bottom + theme.spacing.md,
                gap: theme.spacing.base,
              },
            ]}
          >
            <View style={styles.grow}>
              <Text style={[theme.typography.display, { color: theme.colors.textPrimary }]}>
                {formatPrice(dish.price_kopecks)}
              </Text>
              {cart.items.length > 0 ? (
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                  В корзине {formatPrice(cartSubtotal(cart.items))}
                </Text>
              ) : null}
            </View>

            {quantity > 0 ? (
              <View
                style={[
                  styles.row,
                  {
                    gap: theme.spacing.md,
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.colors.brandSubtle,
                  },
                ]}
              >
                <PressableScale
                  onPress={() => cart.setQuantity(dish.id, quantity - 1)}
                  accessibilityLabel="Убрать порцию"
                  depth={0.85}
                  style={styles.center}
                >
                  <Ionicons
                    name="remove-circle"
                    size={theme.spacing.xxl}
                    color={theme.colors.brand}
                  />
                </PressableScale>

                <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
                  {quantity}
                </Text>

                <PressableScale
                  onPress={() => cart.setQuantity(dish.id, quantity + 1)}
                  accessibilityLabel="Добавить порцию"
                  depth={0.85}
                  style={styles.center}
                >
                  <Ionicons name="add-circle" size={theme.spacing.xxl} color={theme.colors.brand} />
                </PressableScale>
              </View>
            ) : (
              <PressableScale
                onPress={addToCart}
                accessibilityLabel="Добавить в корзину"
                depth={0.94}
                style={[
                  styles.action,
                  {
                    minHeight: theme.layout.minTouchTarget + theme.spacing.xs,
                    paddingHorizontal: theme.spacing.xxl,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.colors.brand,
                    ...theme.elevation.raised,
                  },
                ]}
              >
                <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
                  В корзину
                </Text>
              </PressableScale>
            )}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { position: 'absolute', overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  veilTop: { position: 'absolute', top: 0, left: 0, right: 0 },
  veilBottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  title: { position: 'absolute' },
  grabber: { alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  grow: { flex: 1 },
  nutrition: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center' },
  close: { position: 'absolute' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  barInner: { flexDirection: 'row', alignItems: 'center' },
  action: { alignItems: 'center', justifyContent: 'center' },
});
