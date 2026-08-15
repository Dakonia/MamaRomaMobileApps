import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Dish } from '@/api/client';
import { CategoryBar, type CategoryChip } from '@/components/category-bar';
import { DishCard } from '@/components/dish-card';
import { EmptyState } from '@/components/empty-state';
import { MenuSkeleton } from '@/components/menu-skeleton';
import { PressableScale } from '@/components/pressable-scale';
import { PromoCarousel } from '@/components/promo-carousel';
import { formatPrice } from '@/lib/format';
import { tenant } from '@/lib/tenant';
import { cartCount, cartSubtotal, useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

// Конфигурация видимости должна быть стабильной ссылкой: список не терпит подмены на лету
const VIEWABILITY = { itemVisiblePercentThreshold: 40 };

type Row =
  | { kind: 'promos'; key: string }
  | { kind: 'popular'; key: string }
  | { kind: 'title'; key: string; categoryId: string; title: string }
  | { kind: 'pair'; key: string; categoryId: string; left: Dish; right: Dish | null };

export default function MenuScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cart = useCart();

  const listRef = useRef<FlashListRef<Row>>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const restaurants = useQuery({ queryKey: ['restaurants'], queryFn: () => api.restaurants() });

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

  const promos = useQuery({
    queryKey: ['promotions', cart.restaurantId],
    queryFn: () => api.promotions(cart.restaurantId ?? undefined),
  });

  const popular = useQuery({
    queryKey: ['popular', cart.restaurantId],
    queryFn: () => api.popular(cart.restaurantId ?? undefined),
  });

  const categories: CategoryChip[] = useMemo(
    () => (menu.data?.categories ?? []).map((item) => ({ id: item.id, title: item.name })),
    [menu.data],
  );

  const rows: Row[] = useMemo(() => {
    const result: Row[] = [];

    if ((promos.data ?? []).length > 0) {
      result.push({ kind: 'promos', key: 'promos' });
    }
    if ((popular.data ?? []).length > 0) {
      result.push({ kind: 'popular', key: 'popular' });
    }

    for (const category of menu.data?.categories ?? []) {
      result.push({
        kind: 'title',
        key: `t-${category.id}`,
        categoryId: category.id,
        title: category.name,
      });

      // Раскладываем блюда парами — сетка два в ряд без потери переработки списка
      for (let index = 0; index < category.dishes.length; index += 2) {
        result.push({
          kind: 'pair',
          key: `p-${category.id}-${index}`,
          categoryId: category.id,
          left: category.dishes[index],
          right: category.dishes[index + 1] ?? null,
        });
      }
    }

    return result;
  }, [menu.data, promos.data, popular.data]);

  const quantityOf = useCallback(
    (dishId: string) => cart.items.find((item) => item.dishId === dishId)?.quantity ?? 0,
    [cart.items],
  );

  const count = cartCount(cart.items);
  const subtotal = cartSubtotal(cart.items);
  const cardWidth = (width - theme.layout.screenPadding * 2 - theme.spacing.md) / 2;

  const jumpTo = (categoryId: string) => {
    const index = rows.findIndex((row) => row.kind === 'title' && row.categoryId === categoryId);
    if (index >= 0) {
      setActiveCategory(categoryId);
      listRef.current?.scrollToIndex({ index, animated: true, viewOffset: theme.spacing.sm });
    }
  };

  const onViewable = useRef(
    ({ viewableItems }: { viewableItems: { item: Row }[] }) => {
      const first = viewableItems.find(
        (entry) => entry.item.kind === 'title' || entry.item.kind === 'pair',
      );
      if (first && 'categoryId' in first.item) {
        setActiveCategory(first.item.categoryId);
      }
    },
  ).current;

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === 'promos') {
      return (
        <Animated.View entering={FadeIn.duration(theme.motion.duration.base)}>
          <PromoCarousel
            promotions={promos.data ?? []}
            onOpen={() => router.push('/promos')}
          />
        </Animated.View>
      );
    }

    if (item.kind === 'popular') {
      return (
        <View style={{ gap: theme.spacing.sm, paddingTop: theme.spacing.sm }}>
          <Text
            style={[
              theme.typography.h2,
              { color: theme.colors.textPrimary, paddingHorizontal: theme.layout.screenPadding },
            ]}
          >
            Часто заказывают
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: theme.layout.screenPadding,
              gap: theme.spacing.md,
              paddingBottom: theme.spacing.sm,
            }}
          >
            {(popular.data ?? []).map((dish) => (
              <DishCard
                key={`pop-${dish.id}`}
                dish={dish}
                width={cardWidth}
                quantity={quantityOf(dish.id)}
                onOpen={() => router.push(`/dish/${dish.id}`)}
                onAdd={() => cart.add(dish)}
                onChangeQuantity={(quantity) => cart.setQuantity(dish.id, quantity)}
              />
            ))}
          </ScrollView>
        </View>
      );
    }

    if (item.kind === 'title') {
      return (
        <Text
          style={[
            theme.typography.display,
            {
              color: theme.colors.textPrimary,
              paddingHorizontal: theme.layout.screenPadding,
              paddingTop: theme.spacing.xl,
              paddingBottom: theme.spacing.md,
            },
          ]}
        >
          {item.title}
        </Text>
      );
    }

    const right = item.right;

    return (
      <View
        style={[
          styles.pair,
          {
            paddingHorizontal: theme.layout.screenPadding,
            gap: theme.spacing.md,
            paddingBottom: theme.spacing.md,
          },
        ]}
      >
        <DishCard
          dish={item.left}
          quantity={quantityOf(item.left.id)}
          onOpen={() => router.push(`/dish/${item.left.id}`)}
          onAdd={() => cart.add(item.left)}
          onChangeQuantity={(quantity) => cart.setQuantity(item.left.id, quantity)}
        />

        {right ? (
          <DishCard
            dish={right}
            quantity={quantityOf(right.id)}
            onOpen={() => router.push(`/dish/${right.id}`)}
            onAdd={() => cart.add(right)}
            onChangeQuantity={(quantity) => cart.setQuantity(right.id, quantity)}
          />
        ) : (
          <View style={styles.filler} />
        )}
      </View>
    );
  };

  const body = () => {
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
        ref={listRef}
        data={rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        renderItem={renderRow}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={VIEWABILITY}
        onRefresh={() => {
          void menu.refetch();
          void promos.refetch();
          void popular.refetch();
        }}
        refreshing={menu.isRefetching}
        contentContainerStyle={{
          paddingBottom: count > 0 ? theme.spacing.huge + theme.spacing.xxl : theme.spacing.xxxl,
        }}
      />
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <View
        style={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.layout.screenPadding,
          paddingBottom: theme.spacing.xs,
        }}
      >
        <Text style={[theme.typography.h1, { color: theme.colors.textPrimary }]}>
          {tenant.branding.displayName}
        </Text>

        <PressableScale
          onPress={() => router.push('/restaurants')}
          accessibilityLabel="Выбрать ресторан"
          depth={0.97}
          style={[styles.picker, { gap: theme.spacing.xs, minHeight: theme.spacing.xxl }]}
        >
          <Ionicons name="location-outline" size={theme.spacing.base} color={theme.colors.brand} />
          <Text
            numberOfLines={1}
            style={[theme.typography.caption, styles.grow, { color: theme.colors.textSecondary }]}
          >
            {restaurant?.name ?? 'Выберите ресторан'}
          </Text>
          <Ionicons name="chevron-down" size={theme.spacing.base} color={theme.colors.textTertiary} />
        </PressableScale>
      </View>

      {categories.length > 0 ? (
        <View
          style={{
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.divider,
            backgroundColor: theme.colors.background,
          }}
        >
          <CategoryBar categories={categories} activeId={activeCategory} onSelect={jumpTo} />
        </View>
      ) : null}

      {body()}

      {count > 0 ? (
        <Animated.View
          entering={SlideInDown.springify().damping(18)}
          exiting={SlideOutDown.duration(theme.motion.duration.fast)}
          style={[
            styles.cartWrap,
            {
              left: theme.layout.screenPadding,
              right: theme.layout.screenPadding,
              bottom: insets.bottom + theme.spacing.sm,
            },
          ]}
        >
          <PressableScale
            onPress={() => router.push('/cart')}
            accessibilityLabel="Перейти в корзину"
            depth={0.97}
            style={[
              styles.cartBar,
              {
                minHeight: theme.layout.minTouchTarget + theme.spacing.xs,
                paddingHorizontal: theme.spacing.lg,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.brand,
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
          </PressableScale>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  picker: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  pair: { flexDirection: 'row' },
  filler: { flex: 1 },
  cartWrap: { position: 'absolute' },
  cartBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
