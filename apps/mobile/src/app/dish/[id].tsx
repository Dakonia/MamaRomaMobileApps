import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useEffect } from 'react';
import Animated, {
  Easing,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, mediaUrl } from '@/api/client';
import { EmptyState } from '@/components/empty-state';
import { PressableScale } from '@/components/pressable-scale';
import { formatPrice } from '@/lib/format';
import { cartSubtotal, useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

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

  const heroHeight = width * 0.92;

  // Прямоугольник, из которого раскрывается снимок. Без него открываем сразу
  const from =
    x && y && w && h
      ? { x: Number(x), y: Number(y), width: Number(w), height: Number(h) }
      : null;

  const grow = useSharedValue(from === null ? 1 : 0);
  const scroll = useSharedValue(0);

  useEffect(() => {
    if (from === null) return;
    grow.value = withTiming(1, {
      duration: 380,
      easing: Easing.bezier(0.2, 0, 0, 1),
    });
    // Замер приходит один раз при открытии, пересчитывать нечего
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = useAnimatedScrollHandler((event) => {
    scroll.value = event.contentOffset.y;
  });

  // Снимок разворачивается из сетки на весь экран, а потом живёт параллаксом
  const heroStyle = useAnimatedStyle(() => {
    const progress = grow.value;
    const start = from ?? { x: 0, y: 0, width, height: heroHeight };

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
        { scale: interpolate(scroll.value, [-heroHeight, 0], [1.6, 1], 'clamp') },
      ],
    };
  });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(grow.value, [0, 0.35, 1], [0, 1, 1]),
  }));

  // Сплошной фон догоняет размытие: пока снимок растёт, меню ещё просвечивает
  const sheetVeilStyle = useAnimatedStyle(() => ({
    opacity: interpolate(grow.value, [0, 0.75, 1], [0, 0.4, 1]),
  }));

  // Текст и панель догоняют снимок, а не появляются одновременно с ним
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(grow.value, [0, 0.6, 1], [0, 0, 1]),
    transform: [{ translateY: interpolate(grow.value, [0, 1], [theme.spacing.xxl, 0]) }],
  }));

  // Меню уже загружено на главной — берём из того же запроса, лишней сети нет
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
  const facts = [
    dish.weight_grams ? `${dish.weight_grams} г` : null,
    dish.volume_ml ? `${dish.volume_ml} мл` : null,
  ].filter((value): value is string => value !== null);

  const badges = [
    dish.is_new ? { text: 'Новинка', background: theme.colors.brand } : null,
    dish.is_spicy ? { text: 'Остро', background: theme.colors.danger } : null,
    dish.is_vegetarian ? { text: 'Веган', background: theme.colors.accent } : null,
  ].filter((badge): badge is { text: string; background: string } => badge !== null);

  const gram = (value: number | null | undefined) =>
    value === null || value === undefined ? null : `${Math.round(value)} г`;

  const nutrition = [
    dish.calories ? { label: 'ккал', value: String(dish.calories) } : null,
    gram(dish.proteins_g) ? { label: 'белки', value: gram(dish.proteins_g) ?? '' } : null,
    gram(dish.fats_g) ? { label: 'жиры', value: gram(dish.fats_g) ?? '' } : null,
    gram(dish.carbs_g) ? { label: 'углеводы', value: gram(dish.carbs_g) ?? '' } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);

  const addToCart = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    cart.add(dish);
  };

  return (
    <View style={styles.root}>
      {/* Под карточкой размывается само меню — оттуда мы и пришли */}
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]} pointerEvents="none">
        <BlurView
          intensity={theme.isDark ? 60 : 40}
          tint={theme.isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme.colors.background },
            sheetVeilStyle,
          ]}
        />
      </Animated.View>

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
              name="restaurant-outline"
              size={theme.spacing.huge}
              color={theme.colors.textTertiary}
            />
          </View>
        )}

        {/* Мягкое затемнение сверху: под ним читается любая иконка, а круг не нужен */}
        <LinearGradient
          colors={['rgba(0,0,0,0.42)', 'rgba(0,0,0,0)']}
          style={[styles.veil, { height: theme.spacing.huge * 2 }]}
          pointerEvents="none"
        />
      </Animated.View>

      <Animated.ScrollView
        style={contentStyle}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: theme.spacing.huge * 2 }}
      >
        <View style={{ height: heroHeight - theme.spacing.xxl }} />

        {/* Контент лежит листом поверх фотографии — приём, который делает экран объёмным */}
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

          <View style={[styles.facts, { gap: theme.spacing.sm }]}>
            {category ? (
              <Text style={[theme.typography.overline, { color: theme.colors.brand }]}>
                {category.name}
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

          <Text style={[theme.typography.display, { color: theme.colors.textPrimary }]}>
            {dish.name}
          </Text>

          {facts.length > 0 ? (
            <View style={[styles.facts, { gap: theme.spacing.sm }]}>
              {facts.map((fact) => (
                <View
                  key={fact}
                  style={{
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.xs,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.colors.surfaceSunken,
                  }}
                >
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    {fact}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {nutrition.length > 0 ? (
            <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
              <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
                Пищевая ценность порции
              </Text>

              <View style={[styles.nutrition, { gap: theme.spacing.sm }]}>
                {nutrition.map((item) => (
                  <View
                    key={item.label}
                    style={[
                      styles.nutritionCell,
                      {
                        paddingVertical: theme.spacing.md,
                        borderRadius: theme.radius.lg,
                        backgroundColor: theme.colors.surfaceSunken,
                        gap: theme.spacing.xxs,
                      },
                    ]}
                  >
                    <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
                      {item.value}
                    </Text>
                    <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                      {item.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {dish.description ? (
            <Text style={[theme.typography.bodyLg, { color: theme.colors.textPrimary }]}>
              {dish.description}
            </Text>
          ) : null}

          {dish.composition ? (
            <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.sm }}>
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
                marginTop: theme.spacing.sm,
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
                styles.stepper,
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
                <Ionicons name="remove-circle" size={theme.spacing.xxl} color={theme.colors.brand} />
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  grabber: { alignSelf: 'center' },
  facts: { flexDirection: 'row', flexWrap: 'wrap' },
  nutrition: { flexDirection: 'row' },
  nutritionCell: { flex: 1, alignItems: 'center' },
  close: { position: 'absolute' },
  veil: { position: 'absolute', top: 0, left: 0, right: 0 },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  barInner: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  action: { alignItems: 'center', justifyContent: 'center' },
});
