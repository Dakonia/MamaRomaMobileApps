import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Dish } from '@/api/client';
import { DeliveryStatus, PickupStatus } from '@/components/delivery-status';
import { HeroPhoto } from '@/components/hero-photo';
import { ModeHeader } from '@/components/mode-header';
import { CategoryBar, type CategoryChip } from '@/components/category-bar';
import { DishCard } from '@/components/dish-card';
import { DishPeek } from '@/components/dish-peek';
import { EmptyState } from '@/components/empty-state';
import { MenuSkeleton } from '@/components/menu-skeleton';
import { PressableScale } from '@/components/pressable-scale';
import { PromoCarousel } from '@/components/promo-carousel';
import { ActiveOrder } from '@/components/active-order';
import { AppDialog } from '@/components/app-dialog';
import { SearchField } from '@/components/search-field';
import { formatPrice } from '@/lib/format';
import { tenant } from '@/lib/tenant';
import { distanceKm } from '@/lib/geo';
import { useCoords } from '@/lib/use-coords';
import { cartSubtotal, useCart } from '@/store/cart';
import { useSession } from '@/store/session';
import { keyboardScroll } from '@/lib/keyboard';
import { mapsAvailable } from '@/lib/tenant';
import { useRefresher } from '@/components/refresher';
import { useTheme } from '@/theme/theme-provider';

// Список с анимированной прокруткой: доля сворачивания считается на UI-потоке,
// иначе каждый кадр дёргает JS и меню подтормаживает
const AnimatedFlashList = Animated.createAnimatedComponent(FlashList<Row>);

/** Свой раздел под хиты: настоящей категории с таким кодом в меню нет. */
const POPULAR = 'popular';

// Конфигурация видимости должна быть стабильной ссылкой: список не терпит подмены на лету
const VIEWABILITY = { itemVisiblePercentThreshold: 40 };

type Row =
  | { kind: 'order'; key: string }
  | { kind: 'notice'; key: string }
  | { kind: 'promos'; key: string }
  | { kind: 'title'; key: string; categoryId: string; title: string }
  | { kind: 'pair'; key: string; categoryId: string; left: Dish; right: Dish | null };

export default function MenuScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cart = useCart();

  const listRef = useRef<FlashListRef<Row>>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  // Пока список едет к выбранному разделу, слежение за прокруткой молчит:
  // иначе по дороге он подсвечивает все промежуточные категории
  const jumpingUntil = useRef(0);
  // Прокрутка по номеру строки не переставляет элемент, который уже виден,
  // поэтому доводим вручную: держим ссылки на заголовки, текущее смещение
  // списка и его верхнюю границу на экране
  const titleNodes = useRef<Record<string, View | null>>({});
  const scrollOffset = useSharedValue(0);
  /**
   * Шапка сжимается при прокрутке: переключатель и адрес уезжают, остаются
   * поиск и категории. Уезжают именно сдвигом — высоту никто не меняет, иначе
   * список пересобирается на каждом кадре и прокрутка дёргается
   */
  const topHeight = useSharedValue(0);
  const [heroHeight, setHeroHeight] = useState(0);
  const [topSize, setTopSize] = useState(0);

  const collapse = useDerivedValue(() => {
    if (topHeight.value === 0) return 0;

    // Ниже нуля не опускаемся: при потяжке смещение отрицательное, и без
    // ограничения шапка ехала вниз — над ней открывалась белая полоса
    return Math.max(0, Math.min(1, scrollOffset.value / topHeight.value));
  });
  const [query, setQuery] = useState('');
  // Блюдо, которое гость держит пальцем: показываем крупно, не уходя с меню
  const [peek, setPeek] = useState<Dish | null>(null);
  const searching = query.trim().length > 0;

  const restaurants = useQuery({ queryKey: ['restaurants'], queryFn: () => api.restaurants() });

  const session = useSession();
  const authorized = session.status === 'authorized';

  const addresses = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.addresses(),
    enabled: authorized,
  });

  // Адрес доставки: выбранный гостем или основной
  const address =
    (addresses.data ?? []).find((row) => row.id === cart.addressId) ??
    (addresses.data ?? []).find((row) => row.is_default) ??
    null;

  // На доставку ресторан назначает зона адреса, на самовывоз выбирает гость
  useEffect(() => {
    if (cart.mode !== 'delivery') return;

    // Нет адреса или он вне зоны — ресторана нет вовсе. Иначе в шапке остаётся
    // чужой ресторан: от прошлого гостя или от прошлого адреса
    if (!address?.restaurant_id || !address.delivery_covered) {
      if (cart.restaurantId !== null) cart.selectRestaurant(null);
      return;
    }

    if (address.restaurant_id !== cart.restaurantId) {
      cart.selectRestaurant(address.restaurant_id);
    }
  }, [cart, address]);

  const restaurant = restaurants.data?.find((item) => item.id === cart.restaurantId);

  // Разрешение не спрашиваем: если оно уже есть, подставим ближайший ресторан
  const here = useCoords();

  /**
   * Шапка складывается один раз за проход, а не тянется следом за пальцем.
   * Высота — свойство разметки: пересчитывать её на каждый кадр значит
   * заставлять список перестраиваться шестьдесят раз в секунду, и на неновых
   * телефонах прокрутка от этого дёргается. Порог на складывание и на возврат
   * разный, иначе шапка хлопает у самой границы.
   */
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollOffset.value = event.contentOffset.y;
  });

  // Вся шапка едет вверх ровно на высоту уезжающего блока — поиск и категории
  // останавливаются под строкой состояния и дальше стоят
  const heroSlide = useAnimatedStyle(() => ({
    transform: [{ translateY: -topHeight.value * collapse.value }],
  }));

  // Уезжающий блок гаснет по дороге, чтобы не мелькать под строкой состояния
  const topBlock = useAnimatedStyle(() => ({ opacity: 1 - collapse.value }));

  // Меню грузим всегда: пока адрес не выбран, показываем общее по сети —
  // иначе гость видит один скелетон и не понимает, что делать
  // Возврат на экран — перечитываем меню: стоп-лист меняется в течение дня
  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ['menu'] });
    }, [queryClient]),
  );

  const menu = useQuery({
    queryKey: ['menu', cart.restaurantId],
    queryFn: () => api.menu(cart.restaurantId ?? undefined),
  });

  // Условия зоны для строки статуса: время в пути и порог бесплатной доставки
  const delivery = useQuery({
    queryKey: ['delivery', address?.id],
    queryFn: () =>
      api.resolveDelivery(address?.latitude ?? 0, address?.longitude ?? 0, address?.city_id),
    enabled: cart.mode === 'delivery' && address?.latitude != null,
  });

  // Что писать в шапке: адрес и ресторан на доставке, сам ресторан на самовывозе
  const headline = (() => {
    if (cart.mode === 'pickup') {
      return {
        title: restaurant?.name ?? 'Выберите ресторан',
        subtitle: restaurant ? 'Заберёте сами' : 'Нажмите, чтобы выбрать',
        warning: restaurant === undefined,
      };
    }

    if (!authorized) {
      return { title: 'Войдите, чтобы сохранить адрес', subtitle: 'Или закажите самовывоз', warning: true };
    }

    if (!address) {
      return { title: 'Укажите адрес доставки', subtitle: 'Определим ближайший ресторан', warning: true };
    }

    // full_text уже включает населённый пункт — сами его не подставляем
    const where = address.full_text;

    if (!address.delivery_covered) {
      return {
        title: where,
        subtitle: address.restaurant_name
          ? `${address.restaurant_name} сейчас не возит`
          : 'Сюда пока не доставляем',
        warning: true,
      };
    }

    return { title: where, subtitle: `Везёт ${address.restaurant_name}`, warning: false };
  })();

  // Ресторан сменился — переносим корзину в его меню и рассказываем, что изменилось
  const [moveReport, setMoveReport] = useState<{
    unavailable: string[];
    repriced: string[];
  } | null>(null);
  const movedFor = useRef<string | null>(null);
  useEffect(() => {
    const dishes = menu.data?.categories.flatMap((category) => category.dishes) ?? [];
    if (cart.restaurantId === null || dishes.length === 0) return;
    if (movedFor.current === cart.restaurantId) return;

    movedFor.current = cart.restaurantId;
    if (cart.items.length === 0) return;

    const report = cart.moveTo(cart.restaurantId, dishes);
    if (report.unavailable.length === 0 && report.repriced.length === 0) return;

    setMoveReport({
      unavailable: report.unavailable,
      repriced: report.repriced.map((row) => `${row.name} · ${formatPrice(row.to)}`),
    });
  }, [cart, menu.data]);

  /**
   * Какой ресторан подставить на самовывозе: прошлый выбор, потом ближайший к
   * гостю, потом ресторан его адреса. Список открываем, только если выбрать
   * не из чего — раньше он всплывал при каждом переключении.
   */
  const pickupChoice = useCallback((): string | null => {
    const rows = (restaurants.data ?? []).filter((row) => row.has_pickup);
    if (rows.length === 0) return null;

    const saved = rows.find((row) => row.id === cart.pickupRestaurantId);
    if (saved) return saved.id;

    const from =
      here.coords ??
      (address?.latitude != null && address.longitude != null
        ? { latitude: address.latitude, longitude: address.longitude }
        : null);

    if (from) {
      const closest = [...rows].sort((a, b) => distanceKm(from, a) - distanceKm(from, b))[0];
      return closest.id;
    }

    const byAddress = rows.find((row) => row.id === address?.restaurant_id);
    return (byAddress ?? rows[0]).id;
  }, [restaurants.data, cart.pickupRestaurantId, here.coords, address]);

  useEffect(() => {
    if (cart.mode !== 'pickup' || cart.restaurantId !== null) return;

    const choice = pickupChoice();
    if (choice) cart.selectPickup(choice);
  }, [cart, pickupChoice]);


  const promos = useQuery({
    queryKey: ['promotions', 'menu', cart.restaurantId],
    queryFn: () => api.promotions(cart.restaurantId ?? undefined, true),
  });

  const popular = useQuery({
    queryKey: ['popular', cart.restaurantId],
    queryFn: () => api.popular(cart.restaurantId ?? undefined),
  });

  /**
   * Хиты — такая же категория меню, только собранная нами и поставленная
   * первой. Отдельной полкой их принимали за что-то своё, хотя это те же блюда
   */
  const categories: CategoryChip[] = useMemo(() => {
    const own = (menu.data?.categories ?? []).map((item) => ({ id: item.id, title: item.name }));

    return (popular.data ?? []).length > 0
      ? [{ id: POPULAR, title: 'Популярное' }, ...own]
      : own;
  }, [menu.data, popular.data]);

  // Потянуть вниз: заново читаем меню, акции, хиты и статус заказа
  const refresher = useRefresher(async () => {
    await Promise.all([
      menu.refetch(),
      promos.refetch(),
      popular.refetch(),
      queryClient.invalidateQueries({ queryKey: ['orders'] }),
    ]);
  }, heroHeight);

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

    // Активный заказ — первым делом: за статусом не нужно никуда ходить
    if (authorized) {
      result.push({ kind: 'order', key: 'active-order' });
    }

    if ((promos.data ?? []).length > 0) {
      result.push({ kind: 'promos', key: 'promos' });
    }

    // Ресторан ещё не определён — предупреждаем, что меню общее по сети.
    // Ставим под акциями: сразу под шапкой блок выглядел тревожно
    if (cart.restaurantId === null) {
      result.push({ kind: 'notice', key: 'notice' });
    }
    // Популярное — первая категория, до пиццы
    const hits = popular.data ?? [];

    if (hits.length > 0) {
      result.push({
        kind: 'title',
        key: `t-${POPULAR}`,
        categoryId: POPULAR,
        title: 'Популярное',
      });

      for (let index = 0; index < hits.length; index += 2) {
        result.push({
          kind: 'pair',
          key: `p-${POPULAR}-${index}`,
          categoryId: POPULAR,
          left: hits[index],
          right: hits[index + 1] ?? null,
        });
      }
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

  // Одно блюдо может лежать в корзине несколькими строками — с разными
  // добавками. На карточке в меню показываем общее количество
  const quantityOf = useCallback(
    (dishId: string) =>
      cart.items
        .filter((item) => item.dishId === dishId)
        .reduce((sum, item) => sum + item.quantity, 0),
    [cart.items],
  );

  const subtotal = cartSubtotal(cart.items);
  /**
   * ШИРИНА КАРТОЧКИ БЛЮДА = сколько осталось от экрана, поделить на колонки.
   *
   *   width                  — ширина экрана телефона
   *   screenPadding * 2      — поля слева и справа, по 16
   *   spacing.md             — один промежуток между колонками, 12
   *   / 2                    — ДВЕ КОЛОНКИ
   *
   * Три колонки: промежутков станет два, а делить надо на три —
   *   (width - theme.layout.screenPadding * 2 - theme.spacing.md * 2) / 3
   * Заодно уменьшите numberOfLines в dish-card.tsx с 2 до 1:
   * в узкую карточку название и состав по две строки не влезут.
   */
  const cardWidth = (width - theme.layout.screenPadding * 2 - theme.spacing.md) / 2;

  const jumpTo = async (categoryId: string) => {
    const index = rows.findIndex((row) => row.kind === 'title' && row.categoryId === categoryId);
    const list = listRef.current;
    if (index < 0 || list === null) return;

    jumpingUntil.current = Date.now() + 1600;
    setActiveCategory(categoryId);

    // Сначала прыгаем примерно — после этого заголовок точно отрисован
    await list.scrollToIndex({ index, animated: true, viewPosition: 0 });

    // Затем измеряем, где он оказался на экране, и сдвигаем список на разницу
    for (let pass = 0; pass < 2; pass += 1) {
      const shift = await measureShift(categoryId);
      if (shift === null || Math.abs(shift) < 2) break;

      await list.scrollToOffset({
        offset: Math.max(0, scrollOffset.value + shift),
        animated: pass === 0,
      });
    }
  };

  const measureShift = (categoryId: string) =>
    new Promise<number | null>((resolve) => {
      const node = titleNodes.current[categoryId];
      if (!node) {
        resolve(null);
        return;
      }
      // Заголовок должен встать под неуезжающей частью шапки, а она плавает
      // поверх списка — поэтому вычитаем её высоту, а не верх списка
      node.measureInWindow((_x, y) => resolve(y - Math.max(0, heroHeight - topSize)));
    });

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
    if (item.kind === 'order') {
      return (
        <View
          style={{
            paddingHorizontal: theme.layout.screenPadding,
            paddingTop: theme.spacing.base,
            paddingBottom: theme.spacing.base,
          }}
        >
          <ActiveOrder />
        </View>
      );
    }

    if (item.kind === 'notice') {
      const guest = session.status === 'authorized';
      const outside = cart.mode === 'delivery' && address !== null && !address.delivery_covered;

      return (
        <Animated.View
          entering={FadeIn.duration(theme.motion.duration.base)}
          style={{
            marginHorizontal: theme.layout.screenPadding,
            marginTop: theme.spacing.base,
            marginBottom: theme.spacing.base,
            padding: theme.spacing.base,
            gap: theme.spacing.sm,
            borderRadius: theme.radius.lg,
            backgroundColor: outside ? theme.colors.dangerSubtle : theme.colors.surface,
          }}
        >
          <View style={[styles.rowBetween, { gap: theme.spacing.sm }]}>
            <Ionicons
              name={outside ? 'alert-circle' : 'information-circle-outline'}
              size={18}
              color={outside ? theme.colors.danger : theme.colors.brand}
            />
            <Text
              style={[
                theme.typography.bodyMedium,
                styles.grow,
                { color: outside ? theme.colors.danger : theme.colors.textPrimary },
              ]}
            >
              {outside ? 'По этому адресу доставки нет' : 'Меню всей сети'}
            </Text>
          </View>

          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {outside
              ? 'Заказ можно забрать самим — выберите ресторан и заберите готовое.'
              : 'В вашем ресторане набор блюд и цены могут отличаться. Укажите адрес — покажем его меню.'}
          </Text>

          <View style={[styles.rowBetween, { gap: theme.spacing.sm }]}>
            <PressableScale
              depth={0.96}
              accessibilityLabel={outside ? 'Перейти к самовывозу' : 'Указать адрес'}
              onPress={() => {
                if (outside) {
                  cart.setMode('pickup');
                  if (cart.pickupRestaurantId) cart.selectRestaurant(cart.pickupRestaurantId);
                  return;
                }

                if (!guest) router.push('/auth');
                else router.push('/addresses');
              }}
              style={{
                paddingHorizontal: theme.spacing.base,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.radius.pill,
                backgroundColor: outside ? theme.colors.danger : theme.colors.brand,
              }}
            >
              <Text
                style={[
                  theme.typography.button,
                  { color: outside ? theme.colors.onDanger : theme.colors.textOnBrand },
                ]}
              >
                {outside ? 'Забрать самим' : guest ? 'Указать адрес' : 'Войти и указать адрес'}
              </Text>
            </PressableScale>
          </View>
        </Animated.View>
      );
    }

    if (item.kind === 'promos') {
      const frame = width - theme.layout.screenPadding * 2;

      return (
        <Animated.View
          entering={FadeIn.duration(theme.motion.duration.base)}
          style={{ paddingTop: theme.spacing.base, paddingBottom: theme.spacing.sm }}
        >
          {/* Полку акций держит рамка, а не заливка: цветной блок спорил с
              каталогом, а обводка просто отделяет её от блюд */}
          <View
            style={{
              marginHorizontal: theme.layout.screenPadding,
              borderWidth: 1.5,
              borderColor: theme.colors.brand,
              borderRadius: theme.radius.xl,
              paddingTop: theme.spacing.xs,
              paddingBottom: theme.spacing.xs,
            }}
          >
            <PromoCarousel
              promotions={promos.data ?? []}
              onOpen={(promoId) => router.push(`/promo/${promoId}`)}
              boxWidth={frame}
              gutter={theme.spacing.md}
            />
          </View>

          {/* Подпись и ссылка сидят на самой рамке — как ярлыки на коробке.
              Так они ничего не добавляют к высоте полки */}
          <View
            style={[
              styles.rowBetween,
              styles.legend,
              {
                top: theme.spacing.base - 8,
                left: theme.layout.screenPadding + theme.spacing.base,
                gap: theme.spacing.xs,
                paddingHorizontal: theme.spacing.sm,
                backgroundColor: theme.colors.backgroundAlt,
              },
            ]}
          >
            <Ionicons name="pricetag" size={12} color={theme.colors.brand} />
            <Text style={[theme.typography.overline, { color: theme.colors.brand }]}>
              Акции на доставку
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Все акции"
            hitSlop={theme.hitSlop}
            onPress={() => router.push('/(tabs)/promos')}
            style={[
              styles.rowBetween,
              styles.legend,
              {
                top: theme.spacing.base - 8,
                right: theme.layout.screenPadding + theme.spacing.base,
                gap: theme.spacing.xxs,
                paddingHorizontal: theme.spacing.sm,
                backgroundColor: theme.colors.backgroundAlt,
              },
            ]}
          >
            <Text style={[theme.typography.overline, { color: theme.colors.brand }]}>все</Text>
            <Ionicons name="chevron-forward" size={12} color={theme.colors.brand} />
          </Pressable>
        </Animated.View>
      );
    }

    if (item.kind === 'title') {
      const size = menu.data?.categories.find((entry) => entry.id === item.categoryId)?.dishes
        .length;

      return (
        <View
          ref={(node) => {
            titleNodes.current[item.categoryId] = node;
          }}
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
          onPeek={() => setPeek(item.left)}
          onAdd={() => cart.add(item.left)}
          onChangeQuantity={(quantity) => cart.setQuantity(item.left.id, quantity)}
        />

        {right ? (
          <DishCard
            dish={right}
            quantity={quantityOf(right.id)}
            onOpen={() => router.push(`/dish/${right.id}`)}
            onPeek={() => setPeek(right)}
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
    // Под шапкой: она плавает поверх, места в разметке не занимает
    const under = (node: React.ReactNode) => (
      <View style={[styles.grow, { paddingTop: heroHeight }]}>{node}</View>
    );

    if (menu.isPending || restaurants.isPending) {
      return under(<MenuSkeleton />);
    }

    if (menu.isError || restaurants.isError) {
      return under(
        <EmptyState
          icon="cloud-offline-outline"
          title="Меню не загрузилось"
          description={(menu.error ?? restaurants.error)?.message ?? 'Попробуйте ещё раз'}
          actionLabel="Повторить"
          onAction={() => {
            void menu.refetch();
            void restaurants.refetch();
          }}
        />,
      );
    }

    if (rows.length === 0) {
      return under(
        <EmptyState
          icon="restaurant-outline"
          title="Меню пустое"
          description="Блюда появятся, как только их заведут в админке."
        />,
      );
    }

    return (
      <AnimatedFlashList
        refreshControl={refresher}
        ref={listRef}
        {...keyboardScroll}
        onScroll={onScroll}
        scrollEventThrottle={16}
        data={rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        renderItem={renderRow}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={VIEWABILITY}
        contentContainerStyle={{
          // Список лежит под шапкой во весь экран: отступ сверху постоянный,
          // поэтому съезжающая шапка ничего не пересобирает
          paddingTop: heroHeight,
          // Полоса вкладок занимает своё место в разметке и сама отступает от
          // системной полосы — добавлять её высоту сюда значит оставить пустоту
          paddingBottom: theme.spacing.xl,
        }}
      />
    );
  };

  return (
    // Поле списка чуть теплее белой карточки: иначе блюдо белым по белому
    // держится на одной тени и край блока не читается
    <View style={[styles.root, { backgroundColor: theme.colors.backgroundAlt }]}>
      {/* Пиццы плывут за лентой: сначала фон, потом всё остальное поверх */}
      <AppDialog
        visible={moveReport !== null}
        icon="swap-horizontal"
        title="Меню ресторана другое"
        description={[
          moveReport?.unavailable.length
            ? `Здесь не готовят: ${moveReport.unavailable.join(', ')}. Блюда остались в корзине — уберите их или выберите другой ресторан.`
            : null,
          moveReport?.repriced.length
            ? `Цены обновились: ${moveReport.repriced.join(', ')}`
            : null,
        ]
          .filter(Boolean)
          .join('\n\n')}
        confirmLabel="Открыть корзину"
        cancelLabel="Понятно"
        onConfirm={() => {
          setMoveReport(null);
          router.push('/(tabs)/cart');
        }}
        onCancel={() => setMoveReport(null)}
      />

      <Animated.View
        key={cart.mode}
        entering={FadeIn.duration(260)}
        style={styles.grow}
      >
        {body()}
      </Animated.View>

      <Animated.View
        style={[
          styles.hero,
          heroSlide,
          {
            backgroundColor: theme.colors.hero,
            paddingTop: insets.top + theme.spacing.sm,
            borderBottomLeftRadius: theme.radius.xxl,
            borderBottomRightRadius: theme.radius.xxl,
          },
        ]}
        onLayout={(event) => {
          // Категории приходят вместе с меню, и шапка тогда становится выше:
          // держим её размер в курсе, иначе она накрывает первый блок списка
          const size = event.nativeEvent.layout.height;
          if (size > 0) setHeroHeight((known) => (Math.abs(known - size) > 1 ? size : known));
        }}
      >
        <HeroPhoto />

        <Animated.View
          style={[
            topBlock,
            // Без обрезки схлопнутый блок вылезает поверх поиска
            styles.clip,
            { paddingHorizontal: theme.layout.screenPadding, gap: theme.spacing.md },
          ]}
          onLayout={(event) => {
            const size = event.nativeEvent.layout.height;
            topHeight.value = size;
            if (size > 0) setTopSize((known) => (Math.abs(known - size) > 1 ? size : known));
          }}
        >
          {/* Переключатель и корзина в одном ряду, адрес — во всю ширину под ними:
              иначе растущая корзина сжимала адрес и он выглядел обрубленным */}
          <ModeHeader
            mode={cart.mode}
            onMode={(mode) => {
              cart.setMode(mode);

              // Ресторан подставляем сами: спрашиваем, только если сеть ещё
              // не загрузилась и подставить нечего
              if (mode === 'pickup') {
                const choice = pickupChoice();
                if (choice) cart.selectPickup(choice);
                else router.push('/restaurants');
              }
            }}
            compact
          />

          <ModeHeader
            mode={cart.mode}
            onMode={cart.setMode}
            title={headline.title}
            subtitle={headline.subtitle}
            warning={headline.warning}
            onPress={() => {
              if (cart.mode === 'pickup') {
                router.push('/restaurants');
                return;
              }

              // Адрес привязан к гостю: сначала вход, потом сам адрес
              if (!authorized) {
                router.push({ pathname: '/auth', params: { next: 'address' } });
                return;
              }

              router.push(
                addresses.data?.length
                  ? '/addresses'
                  : mapsAvailable
                    ? '/address-map'
                    : '/address-form',
              );
            }}
            lineOnly
          />

          {cart.mode === 'delivery' ? (
            <DeliveryStatus
              delivery={delivery.data ?? null}
              subtotalKopecks={subtotal}
              hasAddress={address != null}
            />
          ) : (
            <PickupStatus
              opensAt={restaurant?.opens_at}
              closesAt={restaurant?.closes_at}
              paused={restaurant?.is_paused ? (restaurant.pause_reason ?? 'На паузе') : null}
            />
          )}
        </Animated.View>

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
          <CategoryBar
            categories={categories}
            activeId={activeCategory}
            onSelect={(categoryId) => void jumpTo(categoryId)}
            onHero
          />
        ) : null}
      </Animated.View>

      <DishPeek
        dish={peek}
        onClose={() => setPeek(null)}
        onOpen={() => {
          const dish = peek;
          setPeek(null);
          if (dish) router.push(`/dish/${dish.id}`);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 2, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  clip: { overflow: 'hidden' },
  rowBetween: { flexDirection: 'row', alignItems: 'center' },
  picker: { flexDirection: 'row', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'baseline' },
  grow: { flex: 1 },
  pair: { flexDirection: 'row' },
  filler: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  legend: { position: 'absolute' },
});
