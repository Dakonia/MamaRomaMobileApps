import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, mediaUrl } from '@/api/client';
import { EmptyState } from '@/components/empty-state';
import { formatPrice } from '@/lib/format';
import { cartSubtotal, useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

export default function DishScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const { id } = useLocalSearchParams<{ id: string }>();

  // Меню уже загружено на главной — берём из того же запроса, лишней сети нет
  const menu = useQuery({
    queryKey: ['menu', cart.restaurantId],
    queryFn: () => api.menu(cart.restaurantId ?? undefined),
    enabled: cart.restaurantId !== null,
  });

  const dish = menu.data?.categories.flatMap((category) => category.dishes).find(
    (item) => item.id === id,
  );

  const category = menu.data?.categories.find((item) =>
    item.dishes.some((entry) => entry.id === id),
  );

  const quantity = cart.items.find((item) => item.dishId === id)?.quantity ?? 0;

  if (menu.isPending) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <View
          style={{
            height: 280,
            backgroundColor: theme.colors.skeleton,
          }}
        />
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

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: theme.spacing.huge * 2 }}>
        <View style={[styles.hero, { backgroundColor: theme.colors.surfaceSunken }]}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" transition={200} />
          ) : (
            <Ionicons
              name="restaurant-outline"
              size={theme.spacing.huge}
              color={theme.colors.textTertiary}
            />
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть"
            onPress={() => router.back()}
            hitSlop={theme.hitSlop}
            style={[
              styles.close,
              {
                top: insets.top + theme.spacing.sm,
                left: theme.layout.screenPadding,
                width: theme.layout.minTouchTarget,
                height: theme.layout.minTouchTarget,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.scrim,
              },
            ]}
          >
            <Ionicons name="close" size={theme.spacing.lg} color={theme.colors.textPrimary} />
          </Pressable>
        </View>

        <View style={{ padding: theme.layout.screenPadding, gap: theme.spacing.md }}>
          {category ? (
            <Text style={[theme.typography.overline, { color: theme.colors.brand }]}>
              {category.name}
            </Text>
          ) : null}

          <Text style={[theme.typography.display, { color: theme.colors.textPrimary }]}>
            {dish.name}
          </Text>

          {facts.length > 0 ? (
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
              {facts.join(' · ')}
            </Text>
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
                borderRadius: theme.radius.md,
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
      </ScrollView>

      {dish.is_available ? (
        <View
          style={[
            styles.bar,
            {
              paddingHorizontal: theme.layout.screenPadding,
              paddingTop: theme.spacing.md,
              paddingBottom: insets.bottom + theme.spacing.md,
              backgroundColor: theme.colors.surface,
              borderTopColor: theme.colors.divider,
              gap: theme.spacing.base,
            },
          ]}
        >
          <Text style={[theme.typography.display, styles.grow, { color: theme.colors.textPrimary }]}>
            {formatPrice(dish.price_kopecks)}
          </Text>

          {quantity > 0 ? (
            <View style={[styles.stepper, { gap: theme.spacing.base }]}>
              <Pressable
                accessibilityRole="button"
                hitSlop={theme.hitSlop}
                onPress={() => cart.setQuantity(dish.id, quantity - 1)}
              >
                <Ionicons
                  name="remove-circle"
                  size={theme.spacing.xxl}
                  color={theme.colors.brand}
                />
              </Pressable>
              <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
                {quantity}
              </Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={theme.hitSlop}
                onPress={() => cart.setQuantity(dish.id, quantity + 1)}
              >
                <Ionicons name="add-circle" size={theme.spacing.xxl} color={theme.colors.brand} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => cart.add(dish)}
              style={({ pressed }) => [
                styles.action,
                {
                  minHeight: theme.layout.minTouchTarget + theme.spacing.xs,
                  paddingHorizontal: theme.spacing.xxl,
                  borderRadius: theme.radius.pill,
                  backgroundColor: pressed ? theme.colors.brandPressed : theme.colors.brand,
                },
              ]}
            >
              <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
                В корзину
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {cart.items.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/cart')}
          style={[
            styles.cartHint,
            {
              bottom: insets.bottom + theme.spacing.huge + theme.spacing.lg,
              right: theme.layout.screenPadding,
              paddingHorizontal: theme.spacing.base,
              paddingVertical: theme.spacing.sm,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.accent,
            },
          ]}
        >
          <Text style={[theme.typography.caption, { color: theme.colors.textInverse }]}>
            В корзине {formatPrice(cartSubtotal(cart.items))}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: {
    height: 300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: { width: '100%', height: '100%' },
  close: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  grow: { flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  action: { alignItems: 'center', justifyContent: 'center' },
  cartHint: { position: 'absolute' },
});
