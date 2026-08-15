import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api/client';
import { EmptyState } from '@/components/empty-state';
import { formatPrice } from '@/lib/format';
import { useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

export default function RestaurantsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cart = useCart();

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['restaurants'],
    queryFn: () => api.restaurants(),
  });

  if (isError) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <EmptyState
          icon="cloud-offline-outline"
          title="Не удалось загрузить рестораны"
          description={error.message}
          actionLabel="Повторить"
          onAction={() => {
            void refetch();
          }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          paddingTop: insets.top + theme.spacing.lg,
          gap: theme.spacing.md,
          paddingBottom: theme.spacing.xxxl,
        }}
      >
        <Text style={[theme.typography.h1, { color: theme.colors.textPrimary }]}>Рестораны</Text>

        {cart.items.length > 0 ? (
          <Text style={[theme.typography.caption, { color: theme.colors.warning }]}>
            Цены в ресторанах различаются, поэтому при смене корзина очистится.
          </Text>
        ) : null}

        {isPending ? (
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
            Загружаем…
          </Text>
        ) : null}

        {(data ?? []).map((restaurant) => {
          const selected = restaurant.id === cart.restaurantId;

          return (
            <Pressable
              key={restaurant.id}
              accessibilityRole="button"
              onPress={() => {
                cart.selectRestaurant(restaurant.id);
                router.back();
              }}
              style={({ pressed }) => [
                styles.card,
                {
                  padding: theme.spacing.base,
                  borderRadius: theme.radius.lg,
                  gap: theme.spacing.base,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: selected ? theme.colors.brand : theme.colors.border,
                  backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
                },
              ]}
            >
              <View style={styles.cardText}>
                <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
                  {restaurant.name}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  {restaurant.address}
                  {restaurant.metro ? ` · м. ${restaurant.metro}` : ''}
                </Text>
                <Text
                  style={[
                    theme.typography.caption,
                    { color: theme.colors.textTertiary, marginTop: theme.spacing.xxs },
                  ]}
                >
                  Доставка от {formatPrice(restaurant.delivery_min_order_kopecks)}
                  {restaurant.free_delivery_from_kopecks
                    ? ` · бесплатно от ${formatPrice(restaurant.free_delivery_from_kopecks)}`
                    : ''}
                </Text>
              </View>

              {selected ? (
                <Ionicons
                  name="checkmark-circle"
                  size={theme.spacing.xl}
                  color={theme.colors.brand}
                />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardText: { flex: 1 },
});
