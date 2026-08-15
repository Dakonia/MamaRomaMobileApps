import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import { formatPrice } from '@/lib/format';
import { cartSubtotal, useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

export default function DishScreen() {
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

  // Фото уезжает медленнее текста и слегка приближается при оттягивании вниз
  const heroStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(scroll.value, [-heroHeight, 0, heroHeight], [0, 0, heroHeight * 0.4]) },
      { scale: interpolate(scroll.value, [-heroHeight, 0], [1.6, 1], 'clamp') },
    ],
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
    dish.calories ? `${dish.calories} ккал` : null,
  ].filter((value): value is string => value !== null);

  const addToCart = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    cart.add(dish);
  };

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
              name="restaurant-outline"
              size={theme.spacing.huge}
              color={theme.colors.textTertiary}
            />
          </View>
        )}
      </Animated.View>

      <Animated.ScrollView
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

          {category ? (
            <Text style={[theme.typography.overline, { color: theme.colors.brand }]}>
              {category.name}
            </Text>
          ) : null}

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
            borderRadius: theme.radius.pill,
            overflow: 'hidden',
          },
        ]}
      >
        <BlurView intensity={40} tint="dark" style={[StyleSheet.absoluteFill, styles.center]}>
          <Ionicons name="close" size={theme.spacing.lg} color="#FFFFFF" />
        </BlurView>
      </PressableScale>

      {dish.is_available ? (
        <BlurView
          intensity={theme.isDark ? 40 : 60}
          tint={theme.isDark ? 'dark' : 'light'}
          style={[
            styles.bar,
            {
              paddingHorizontal: theme.layout.screenPadding,
              paddingTop: theme.spacing.md,
              paddingBottom: insets.bottom + theme.spacing.md,
              borderTopColor: theme.colors.divider,
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
        </BlurView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { position: 'absolute', top: 0, left: 0, right: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  grabber: { alignSelf: 'center' },
  facts: { flexDirection: 'row', flexWrap: 'wrap' },
  close: { position: 'absolute' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  grow: { flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  action: { alignItems: 'center', justifyContent: 'center' },
});
