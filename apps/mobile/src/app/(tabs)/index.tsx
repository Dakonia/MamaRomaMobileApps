import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Dish } from '@/api/client';
import { CartPill } from '@/components/cart-pill';
import { CategoryBar, type CategoryChip } from '@/components/category-bar';
import { DishCard } from '@/components/dish-card';
import { EmptyState } from '@/components/empty-state';
import { MenuSkeleton } from '@/components/menu-skeleton';
import { PressableScale } from '@/components/pressable-scale';
import { PromoCarousel } from '@/components/promo-carousel';
import { SearchField } from '@/components/search-field';
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
  // Пока список едет к выбранному разделу, слежение за прокруткой молчит:
  // иначе по дороге он подсвечивает все промежуточные категории
  const jumpingUntil = useRef(0);
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;

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
    const needle = query.trim().toLowerCase();

    if (needle.length > 0) {
      const found = (menu.data?.categories ?? [])
        .flatMap((category) => category.dishes)
        .filter((dish) =>
          [dish.name, dish.composition, dish.description]
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLowerCase().includes(needle)),
        );

      result.push({
        kind: 'title',
        key: 'search',
        categoryId: 'search',
        title: found.length > 0 ? `Нашлось: ${found.length}` : 'Ничего не нашлось',
      });

      for (let index = 0; index < found.length; index += 2) {
        result.push({
          kind: 'pair',
          key: `s-${found[index].id}`,
          categoryId: 'search',
          left: found[index],
          right: found[index + 1] ?? null,
        });
      }

      return result;
    }

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
  }, [menu.data, promos.data, popular.data, query]);

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
      jumpingUntil.current = Date.now() + 900;
      setActiveCategory(categoryId);
      listRef.current?.scrollToIndex({ index, animated: true, viewOffset: theme.spacing.sm });
    }
  };

  const onViewable = useRef(
    ({ viewableItems }: { viewableItems: { item: Row }[] }) => {
      if (Date.now() < jumpingUntil.current) return;

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
            onOpen={(promoId) => router.push(`/promo/${promoId}`)}
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
                highlight
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
      const size = menu.data?.categories.find((entry) => entry.id === item.categoryId)?.dishes
        .length;

      return (
        <View
          style={{
            paddingHorizontal: theme.layout.screenPadding,
            paddingTop: theme.spacing.xl,
            paddingBottom: theme.spacing.md,
            gap: theme.spacing.xs,
          }}
        >
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: theme.colors.divider,
              marginBottom: theme.spacing.sm,
            }}
          />
          <View style={[styles.titleRow, { gap: theme.spacing.sm }]}>
            <Text style={[theme.typography.display, styles.grow, { color: theme.colors.textPrimary }]}>
              {item.title}
            </Text>
            {size ? (
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                {size}
              </Text>
            ) : null}
          </View>
        </View>
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
          paddingBottom: theme.layout.tabBarHeight + insets.bottom + theme.spacing.lg,
        }}
      />
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <View
        style={[
          styles.hero,
          {
            backgroundColor: theme.colors.hero,
            paddingTop: insets.top + theme.spacing.sm,
            borderBottomLeftRadius: theme.radius.xxl,
            borderBottomRightRadius: theme.radius.xxl,
          },
        ]}
      >
        <View
          style={[
            styles.heroTop,
            { paddingHorizontal: theme.layout.screenPadding, gap: theme.spacing.md },
          ]}
        >
          <View style={styles.grow}>
            <Text style={[theme.typography.h1, { color: theme.colors.onHero }]}>
              {tenant.branding.displayName}
            </Text>

            <PressableScale
              onPress={() => router.push('/restaurants')}
              accessibilityLabel="Выбрать ресторан"
              depth={0.97}
              style={[styles.picker, { gap: theme.spacing.xs, minHeight: theme.spacing.xxl }]}
            >
              <Ionicons
                name="location-outline"
                size={theme.spacing.base}
                color={theme.colors.onHeroMuted}
              />
              <Text
                numberOfLines={1}
                style={[theme.typography.caption, { color: theme.colors.onHeroMuted }]}
              >
                {restaurant?.name ?? 'Выберите ресторан'}
              </Text>
              <Ionicons
                name="chevron-down"
                size={theme.spacing.base}
                color={theme.colors.onHeroMuted}
              />
            </PressableScale>
          </View>

          <CartPill count={count} subtotal={subtotal} onPress={() => router.push('/cart')} />
        </View>

        <View
          style={{
            paddingHorizontal: theme.layout.screenPadding,
            paddingTop: theme.spacing.sm,
            // Без категорий шапке нужен собственный нижний отступ
            paddingBottom: searching ? theme.spacing.base : 0,
          }}
        >
          <SearchField value={query} onChange={setQuery} />
        </View>

        {categories.length > 0 && !searching ? (
          <CategoryBar categories={categories} activeId={activeCategory} onSelect={jumpTo} onHero />
        ) : null}
      </View>

      {body()}

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start' },
  picker: { flexDirection: 'row', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'baseline' },
  grow: { flex: 1 },
  pair: { flexDirection: 'row' },
  filler: { flex: 1 },
});
