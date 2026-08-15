import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Dish } from '@/api/client';
import { DishRow } from '@/components/dish-row';
import { EmptyState } from '@/components/empty-state';
import { MenuSkeleton } from '@/components/menu-skeleton';
import { ScreenHeader } from '@/components/screen-header';
import { formatPrice } from '@/lib/format';
import { tenant } from '@/lib/tenant';
import { cartCount, cartSubtotal, useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

type Row =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'dish'; key: string; dish: Dish };

export default function MenuScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cart = useCart();

  const restaurants = useQuery({ queryKey: ['restaurants'], queryFn: () => api.restaurants() });

  // Пока ресторан не выбран, показываем меню первого — иначе экран пустой на старте
  useEffect(() => {
    const first = restaurants.data?.[0];
    if (cart.restaurantId === null && first) {
      cart.selectRestaurant(first.id);
    }
  }, [cart, restaurants.data]);

  const restaurant = restaurants.data?.find((item) => item.id === cart.restaurantId);

  const menu = useQuery({
    queryKey: ['menu', cart.restaurantId],
    queryFn: () => api.menu(cart.restaurantId ?? undefined),
    enabled: cart.restaurantId !== null,
  });

  const rows: Row[] = (menu.data?.categories ?? []).flatMap((category) => [
    { kind: 'header' as const, key: `c-${category.id}`, title: category.name },
    ...category.dishes.map((dish) => ({ kind: 'dish' as const, key: dish.id, dish })),
  ]);

  const quantityOf = (dishId: string) =>
    cart.items.find((item) => item.dishId === dishId)?.quantity ?? 0;

  const count = cartCount(cart.items);
  const subtotal = cartSubtotal(cart.items);

  const content = () => {
    if (menu.isPending || restaurants.isPending) {
      return <MenuSkeleton />;
    }

    if (menu.isError || restaurants.isError) {
      return (
        <EmptyState
          icon="cloud-offline-outline"
          title="Меню не загрузилось"
          description={(menu.error ?? restaurants.error)?.message ?? 'Попробуйте ещё раз'}
          actionLabel="Повторить"
          onAction={() => {
            void menu.refetch();
            void restaurants.refetch();
          }}
        />
      );
    }

    if (rows.length === 0) {
      return (
        <EmptyState
          icon="restaurant-outline"
          title="Меню пустое"
          description="Блюда появятся, как только их заведут в админке."
        />
      );
    }

    return (
      <FlashList
        data={rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        onRefresh={() => {
          void menu.refetch();
        }}
        refreshing={menu.isRefetching}
        contentContainerStyle={{
          paddingBottom: count > 0 ? theme.spacing.huge + theme.spacing.xxl : theme.spacing.xxxl,
        }}
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <Text
              style={[
                theme.typography.h2,
                {
                  color: theme.colors.textPrimary,
                  paddingHorizontal: theme.layout.screenPadding,
                  paddingTop: theme.spacing.lg,
                  paddingBottom: theme.spacing.xs,
                },
              ]}
            >
              {item.title}
            </Text>
          ) : (
            <DishRow
              dish={item.dish}
              quantity={quantityOf(item.dish.id)}
              onAdd={() => cart.add(item.dish)}
              onChangeQuantity={(quantity) => cart.setQuantity(item.dish.id, quantity)}
            />
          )
        }
      />
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title={tenant.branding.displayName} subtitle={tenant.branding.tagline} />

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/restaurants')}
        style={({ pressed }) => [
          styles.picker,
          {
            minHeight: theme.layout.minTouchTarget,
            paddingHorizontal: theme.layout.screenPadding,
            gap: theme.spacing.sm,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.divider,
            backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.background,
          },
        ]}
      >
        <Ionicons name="location-outline" size={theme.spacing.lg} color={theme.colors.brand} />
        <Text
          numberOfLines={1}
          style={[theme.typography.bodyMedium, styles.pickerText, { color: theme.colors.textPrimary }]}
        >
          {restaurant?.name ?? 'Выберите ресторан'}
        </Text>
        <Text style={[theme.typography.caption, { color: theme.colors.brand }]}>Изменить</Text>
      </Pressable>

      {content()}

      {count > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/cart')}
          style={({ pressed }) => [
            styles.cartBar,
            {
              left: theme.layout.screenPadding,
              right: theme.layout.screenPadding,
              bottom: insets.bottom + theme.spacing.sm,
              minHeight: theme.layout.minTouchTarget + theme.spacing.xs,
              paddingHorizontal: theme.spacing.lg,
              borderRadius: theme.radius.pill,
              backgroundColor: pressed ? theme.colors.brandPressed : theme.colors.brand,
              ...theme.elevation.raised,
            },
          ]}
        >
          <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
            Корзина · {count}
          </Text>
          <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
            {formatPrice(subtotal)}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pickerText: { flex: 1 },
  cartBar: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
