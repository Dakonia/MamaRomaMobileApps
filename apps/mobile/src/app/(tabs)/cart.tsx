import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
/**
 * Список берём из gesture-handler, а не из react-native: обычный ScrollView на
 * Android забирает касание себе, и свайп по экрану до жеста не доходил
 */
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeInDown,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { api, mediaUrl, type Address, type ApiError } from '@/api/client';
import { AnimatedPrice } from '@/components/animated-price';
import { AppDialog } from '@/components/app-dialog';
import { ExtraPortionsDialog } from '@/components/extra-portions-dialog';
import {
  CartLine,
  FreeDeliveryBar,
  PaymentPicker,
  PersonsRow,
  PointsCard,
  CommentField,
  PromoField,
  TimePicker,
  UpsellShelf,
  type PaymentMethod,
} from '@/components/cart-pieces';
import { EmptyState } from '@/components/empty-state';
import { ExtraIcon } from '@/components/extra-icon';
import { FlyingDish, type FlightStart } from '@/components/flying-dish';
import { PizzaBackdrop } from '@/components/pizza-backdrop';
import { PressableScale } from '@/components/pressable-scale';
import { PrimaryButton } from '@/components/primary-button';
import { RepeatOrder } from '@/components/repeat-order';
import { Skeleton } from '@/components/skeleton';
import { formatPrice } from '@/lib/format';
import { keyboardScroll } from '@/lib/keyboard';
import { tenant } from '@/lib/tenant';
import { cartCount, cartSubtotal, useCart } from '@/store/cart';
import { usePushAsk } from '@/store/push-ask';
import { track } from '@/lib/analytics';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

// Разделы, к которым уместен сыр
const CHEESE_CATEGORIES = ['pasta', 'rizotto'];

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** «11:00:00» → минуты от полуночи. */
function minutesOf(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

// Кухня не отдаёт заказы с первой минуты смены: раньше этого времени
// после открытия доставку не предлагаем
const WARMUP_MINUTES = 90;

/**
 * Слоты доставки внутри рабочих часов. Если сегодня окно уже закрылось,
 * предлагаем завтрашние — заказать «на сейчас» в нерабочее время нельзя.
 */
function timeSlots(
  opensAt: string | null,
  closesAt: string | null,
  openNow: boolean,
): { iso: string | null; label: string }[] {
  const slots: { iso: string | null; label: string }[] = [];

  // «Как можно скорее» имеет смысл, только пока доставка работает
  if (openNow) slots.push({ iso: null, label: 'Как можно скорее' });

  const opens = opensAt ? minutesOf(opensAt) : 0;
  const closes = closesAt ? minutesOf(closesAt) : 24 * 60;

  const now = new Date();
  const earliest = new Date(now.getTime() + 45 * 60_000);
  earliest.setMinutes(earliest.getMinutes() > 30 ? 60 : 30, 0, 0);

  let cursor = new Date(earliest);
  const startOfDay = (date: Date, minutes: number) => {
    const result = new Date(date);
    result.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return result;
  };

  // Слишком рано или уже поздно — переносим на ближайшее рабочее окно
  const todayOpens = startOfDay(now, opens + WARMUP_MINUTES);
  const todayCloses = startOfDay(now, closes);
  if (cursor < todayOpens) cursor = todayOpens;
  if (cursor > todayCloses) {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000);
    cursor = startOfDay(tomorrow, opens + WARMUP_MINUTES);
  }

  const tomorrow = cursor.getDate() !== now.getDate();
  const limit = startOfDay(cursor, closes);

  for (let step = 0; step < 12 && cursor <= limit; step += 1) {
    const hh = String(cursor.getHours()).padStart(2, '0');
    const mm = String(cursor.getMinutes()).padStart(2, '0');
    slots.push({
      iso: cursor.toISOString(),
      label: tomorrow ? `Завтра ${hh}:${mm}` : `${hh}:${mm}`,
    });
    cursor = new Date(cursor.getTime() + 30 * 60_000);
  }

  return slots;
}

export default function CartScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const session = useSession();
  const queryClient = useQueryClient();

  /**
   * Способ оплаты не выбран заранее намеренно: гость сам спускается к нему, а
   * заодно видит промокод, баллы и приборы — раньше кнопка была активна сразу,
   * и до этих пунктов почти никто не доходил
   */
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [comment, setComment] = useState('');
  const [usePoints, setUsePoints] = useState(false);
  const [persons, setPersons] = useState(0);
  const [changeFrom, setChangeFrom] = useState('');
  const [deliveryAt, setDeliveryAt] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [pickingAddress, setPickingAddress] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [extraPortions, setExtraPortions] = useState(1);
  const [flight, setFlight] = useState<FlightStart | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const paymentY = useRef(0);

  const subtotal = cartSubtotal(cart.items);
  const count = cartCount(cart.items);
  const authorized = session.status === 'authorized';
  const delivery = cart.mode === 'delivery';

  const toMenu = () => router.navigate('/(tabs)');

  // Закрыть корзину — вернуться туда, откуда в неё зашли, а не всегда в меню
  const back = () => (router.canGoBack() ? router.back() : toMenu());


  // Куда летит миниатюра и как отзывается сумма заказа
  const basket = useRef<View>(null);
  const [target, setTarget] = useState({ x: 0, y: 0 });
  const bounce = useSharedValue(0);

  const basketStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + bounce.value * 0.08 }],
  }));

  const measureBasket = () =>
    basket.current?.measureInWindow((x, y, width, height) =>
      setTarget({ x: x + width / 2 - 24, y: y + height / 2 - 24 }),
    );

  /**
   * Свайп вправо закрывает корзину: это вкладка, системного жеста назад тут нет.
   * Экран едет за пальцем — иначе непонятно, что жест вообще есть
   */
  const slide = useSharedValue(0);

  const swipeBack = Gesture.Pan()
    .activeOffsetX(18)
    .failOffsetY([-40, 40])
    .onUpdate((event) => {
      slide.value = Math.max(0, event.translationX);
    })
    .onEnd((event) => {
      if (event.translationX > 90 || (event.translationX > 40 && event.velocityX > 600)) {
        runOnJS(back)();
      }

      slide.value = withSpring(0, { damping: 22, stiffness: 220 });
    });

  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: slide.value }] }));

  const addresses = useQuery({
    queryKey: ['addresses'],
    queryFn: api.addresses,
    enabled: authorized && delivery,
  });

  // Открыли корзину — сверяем меню заново: за это время блюдо могли снять
  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ['menu'] });
      void queryClient.invalidateQueries({ queryKey: ['checkout'] });
    }, [queryClient]),
  );

  const menu = useQuery({
    queryKey: ['menu', cart.restaurantId],
    queryFn: () => api.menu(cart.restaurantId ?? undefined),
    enabled: cart.items.length > 0,
  });

  const restaurants = useQuery({
    queryKey: ['restaurants'],
    queryFn: () => api.restaurants(),
    enabled: cart.restaurantId !== null,
    select: (rows) => rows.find((row) => row.id === cart.restaurantId) ?? null,
  });

  const history = useQuery({
    queryKey: ['orders'],
    queryFn: api.orders,
    enabled: authorized && cart.items.length === 0,
  });

  // В корзине храним только цену и количество — остальное берём из меню
  const details = useMemo(() => {
    const map = new Map<string, { photo: string | null; note: string | null; sold: boolean }>();

    for (const category of menu.data?.categories ?? []) {
      for (const dish of category.dishes) {
        map.set(dish.id, {
          photo: dish.image_url ? (mediaUrl(dish.image_url) ?? null) : null,
          note: dish.weight_grams
            ? `${dish.weight_grams} г`
            : dish.volume_ml
              ? `${dish.volume_ml} мл`
              : null,
          sold: dish.is_available !== false,
        });
      }
    }

    return map;
  }, [menu.data]);

  const address: Address | null = useMemo(() => {
    const rows = addresses.data ?? [];
    if (rows.length === 0) return null;
    return (
      rows.find((row) => row.id === cart.addressId) ??
      rows.find((row) => row.is_default) ??
      rows[0]
    );
  }, [addresses.data, cart.addressId]);

  // Адрес выбирает ресторан: на него же уйдёт заказ
  useEffect(() => {
    if (!delivery || address === null) return;
    if (address.restaurant_id && address.restaurant_id !== cart.restaurantId) {
      cart.selectRestaurant(address.restaurant_id);
    }
    if (cart.addressId !== address.id) cart.selectAddress(address.id);
  }, [address, cart, delivery]);

  const preview = useQuery({
    queryKey: [
      'checkout',
      cart.restaurantId,
      cart.mode,
      address?.id,
      subtotal,
      count,
      usePoints,
      promoCode,
      persons,
      deliveryAt,
    ],
    enabled: authorized && cart.items.length > 0 && cart.restaurantId !== null,
    // Пока считается новый счёт, держим на экране прошлый: иначе при каждом
    // нажатии блоки исчезают и появляются заново — экран дёргается
    placeholderData: (previous) => previous,
    queryFn: () =>
      api.checkoutPreview({
        restaurant_id: cart.restaurantId ?? '',
        type: cart.mode,
        items: cart.items.map((item) => ({
          dish_id: item.dishId,
          quantity: item.quantity,
          extra_ids: (item.extras ?? []).map((extra) => extra.id),
        })),
        address_latitude: delivery ? (address?.latitude ?? null) : null,
        address_longitude: delivery ? (address?.longitude ?? null) : null,
        persons_count: persons,
        delivery_at: deliveryAt,
        points_to_spend: usePoints ? 100_000 : 0,
        promo_code: promoCode,
      }),
  });

  const bill = preview.data;


  const slots = useMemo(
    () =>
      timeSlots(
        bill?.delivery_opens_at ?? null,
        bill?.delivery_closes_at ?? null,
        bill?.delivery_open_now ?? true,
      ),
    [bill?.delivery_opens_at, bill?.delivery_closes_at, bill?.delivery_open_now],
  );

  // Доставка закрыта — «как можно скорее» не предлагаем: подставляем
  // ближайшее рабочее время, иначе кнопка оформления просто не сработает
  // Закрыто и предзаказ выключен — выбирать время не из чего, заказ не примут
  const closedNow = bill?.delivery_open_now === false;
  const noPreorder = closedNow && bill?.preorder_enabled === false;
  const pickupClosed = noPreorder || (!delivery && closedNow);

  useEffect(() => {
    if (slots.length === 0 || pickupClosed) return;
    if (deliveryAt === null && slots[0].iso !== null) setDeliveryAt(slots[0].iso);
  }, [deliveryAt, pickupClosed, slots]);

  // Причину берём из расчёта — сервер знает и про стоп-лист, и про меню
  // ресторана; меню в кэше нужно лишь для мгновенной отрисовки
  const blocked = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of bill?.unavailable ?? []) map.set(row.dish_id, row.reason);

    for (const item of cart.items) {
      if (!map.has(item.dishId) && details.get(item.dishId)?.sold === false) {
        map.set(item.dishId, 'Закончилось');
      }
    }

    return map;
  }, [bill?.unavailable, cart.items, details]);


  // «С этим покупают» к первому блюду корзины: соусы и напитки к горячему
  const related = useQuery({
    queryKey: ['related', cart.items[0]?.dishId, cart.restaurantId],
    enabled: cart.items.length > 0,
    queryFn: () => api.related(cart.items[0].dishId, cart.restaurantId ?? undefined),
  });

  // К пасте и ризотто обычно берут сыр: подсказку берём из того же правила,
  // что и в карточке блюда, и предлагаем прямо к строке корзины
  const extraHint = useMemo(() => {
    // Сыр предлагаем только к пасте и ризотто: пицце он ни к чему
    const dishes = new Map(
      (menu.data?.categories ?? [])
        .filter((category) => CHEESE_CATEGORIES.includes(category.slug))
        .flatMap((category) => category.dishes.map((dish) => [dish.id, dish] as const)),
    );

    const lines = cart.items.filter((item) => {
      const dish = dishes.get(item.dishId);
      if (dish === undefined) return false;
      return dish.extras.some(
        (extra) =>
          extra.is_recommended && !(item.extras ?? []).some((row) => row.id === extra.id),
      );
    });

    if (lines.length === 0) return null;

    const extra = (dishes.get(lines[0].dishId)?.extras ?? []).find(
      (row) => row.is_recommended,
    );
    if (extra === undefined) return null;

    return {
      extra,
      lines,
      portions: lines.reduce((sum, line) => sum + line.quantity, 0),
    };
  }, [cart.items, menu.data]);

  const upsell = (related.data ?? [])
    .filter((dish) => !cart.items.some((item) => item.dishId === dish.id))
    .slice(0, 4);

  const createOrder = useMutation({
    mutationFn: () => {
      track('checkout_started', {
        type: cart.mode,
        payment,
        positions: cart.items.length,
        total: Math.round((bill?.total_kopecks ?? 0) / 100),
      });

      return api.createOrder({
        restaurant_id: cart.restaurantId ?? '',
        type: cart.mode,
        payment_method: payment ?? 'cash_on_delivery',
        // Ссылку на адрес сервер разложит по частям для кассы: курьеру нужны
        // квартира, подъезд и домофон отдельными полями
        address_id: delivery ? (address?.id ?? null) : null,
        address_text: delivery ? (address?.full_text ?? null) : null,
        address_latitude: delivery ? (address?.latitude ?? null) : null,
        address_longitude: delivery ? (address?.longitude ?? null) : null,
        delivery_at: deliveryAt,
        persons_count: persons,
        change_from_kopecks:
          payment === 'cash_on_delivery' && changeFrom.length > 0
            ? Number(changeFrom) * 100
            : null,
        promo_code: promoCode,
        comment: comment.length > 0 ? comment : null,
        points_to_spend: bill?.points_to_spend ?? 0,
        items: cart.items.map((item) => ({
          dish_id: item.dishId,
          quantity: item.quantity,
          extra_ids: (item.extras ?? []).map((extra) => extra.id),
        })),
      });
    },
    onSuccess: (order) => {
      track('order_created', {
        type: order.type,
        payment: order.payment_method,
        // Деньги в аналитике храним в рублях: копейки там нечитаемы
        total: Math.round(order.total_kopecks / 100),
        points_spent: Math.round((order.points_spent ?? 0) / 100),
        promo: order.promo_code ?? null,
      });

      usePushAsk.getState().revive();
      cart.clear();
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void session.restore();
      router.replace(`/order/${order.id}`);
    },
    onError: (error: ApiError) => {
      track('order_failed', { reason: error.message.slice(0, 80) });
      setFailure(error.message);
    },
  });

  const header = (
    <View
      style={[
        styles.line,
        {
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.sm,
          paddingBottom: theme.spacing.sm,
          gap: theme.spacing.xs,
          backgroundColor: theme.colors.backgroundAlt,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.divider,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Назад в меню"
        hitSlop={theme.hitSlop}
        onPress={back}
        style={[
          styles.center,
          { width: theme.layout.minTouchTarget, height: theme.layout.minTouchTarget },
        ]}
      >
        <Ionicons name="chevron-back" size={26} color={theme.colors.textPrimary} />
      </Pressable>

      <View style={styles.grow}>
        <Text style={[theme.typography.h2, { color: theme.colors.textPrimary }]}>Корзина</Text>
        {count > 0 ? (
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            {count} {count === 1 ? 'позиция' : count < 5 ? 'позиции' : 'позиций'} ·{' '}
            {delivery ? 'доставка' : 'самовывоз'}
          </Text>
        ) : null}
      </View>

      {count > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Очистить корзину"
          hitSlop={theme.hitSlop}
          onPress={() => setClearing(true)}
          style={[
            styles.center,
            { width: theme.layout.minTouchTarget, height: theme.layout.minTouchTarget },
          ]}
        >
          <Ionicons name="trash-outline" size={20} color={theme.colors.textTertiary} />
        </Pressable>
      ) : null}
    </View>
  );

  if (cart.items.length === 0) {
    const last = history.data?.[0];

    // Пустая корзина закрывается тем же свайпом: иначе жест то есть, то нет
    return (
      <GestureDetector gesture={swipeBack}>
      <Animated.View
        style={[styles.root, slideStyle, { backgroundColor: theme.colors.backgroundAlt }]}
      >
        <PizzaBackdrop strength={0.45} />

        {header}

        <EmptyState
          icon="bag-handle-outline"
          art="cart"
          title="Корзина пуста"
          description="Загляните в меню — там есть что выбрать."
          actionLabel="В меню"
          onAction={toMenu}
        />

        {last ? (
          <View
            style={{
              padding: theme.layout.screenPadding,
              paddingBottom: insets.bottom + theme.spacing.xl,
            }}
          >
            {/* Повторить прошлый заказ — самый короткий путь к следующему */}
            <RepeatOrder order={last} />
          </View>
        ) : null}
      </Animated.View>
      </GestureDetector>
    );
  }

  const block = (
    title: string,
    icon: keyof typeof Ionicons.glyphMap,
    children: React.ReactNode,
  ) => (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={[styles.line, { gap: theme.spacing.xs }]}>
        <Ionicons name={icon} size={14} color={theme.colors.textTertiary} />
        <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );

  const summaryRow = (label: string, value: string, tone?: 'accent') => (
    <View key={label} style={styles.summaryRow}>
      <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>{label}</Text>
      <Text
        style={[
          theme.typography.bodyMedium,
          theme.tabularNums,
          { color: tone === 'accent' ? theme.colors.accent : theme.colors.textPrimary },
        ]}
      >
        {value}
      </Text>
    </View>
  );

  // Адрес вне зоны: ресторана нет, счёт не считается — говорим об этом сами
  const outsideZone = delivery && address !== null && !address.delivery_covered;
  // Что написать про срок: закрыто, ко времени или «за N минут».
  // Ночью нельзя ни привезти, ни забрать — текст один для обоих режимов
  const when = (() => {
    if (deliveryAt !== null) {
      const slot = slots.find((row) => row.iso === deliveryAt);
      const verb = delivery ? 'привезём' : 'приготовим';
      return slot ? `${verb} ${slot.label.toLowerCase()}` : 'ко времени';
    }

    if (closedNow) {
      const opens = (bill?.delivery_opens_at ?? '').slice(0, 5);
      return opens ? `сейчас закрыто, откроется в ${opens}` : 'сейчас закрыто';
    }

    if (!delivery) return 'заберёте сами';
    return bill?.delivery_minutes ? `привезём за ${bill.delivery_minutes} мин` : 'готовим и везём';
  })();

  const blocker = outsideZone
    ? 'По этому адресу доставки нет — можно забрать самим'
    : (bill?.blocker ?? null);
  const needsAddress = delivery && authorized && address === null;
  const total = bill?.total_kopecks ?? subtotal;

  return (
    <GestureDetector gesture={swipeBack}>
      <Animated.View
        style={[styles.root, slideStyle, { backgroundColor: theme.colors.backgroundAlt }]}
      >
        <PizzaBackdrop strength={0.45} />

        {header}

        <ScrollView
          ref={scroller}
          contentContainerStyle={{
            padding: theme.layout.screenPadding,
            gap: theme.spacing.xl,
            paddingBottom: theme.spacing.huge * 2,
          }}
          showsVerticalScrollIndicator={false}
          {...keyboardScroll}
        >
          {/* Куда и откуда — сразу наверху: это самое частое, что правят */}
          {delivery ? (
            <PressableScale
              depth={0.99}
              accessibilityLabel="Адрес доставки"
              onPress={() => {
                if (!authorized) router.push('/auth');
                else if ((addresses.data ?? []).length === 0) router.push('/address-form');
                else setPickingAddress((open) => !open);
              }}
              style={[
                styles.line,
                theme.elevation.card,
                {
                  gap: theme.spacing.md,
                  padding: theme.spacing.base,
                  borderRadius: theme.radius.xl,
                  backgroundColor: theme.colors.surface,
                },
              ]}
            >
              <View
                style={[
                  styles.center,
                  {
                    width: 42,
                    height: 42,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.colors.brandSubtle,
                  },
                ]}
              >
                <Ionicons name="location" size={20} color={theme.colors.brand} />
              </View>

              <View style={[styles.grow, { gap: 2 }]}>
                <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
                  куда везём
                </Text>
                <Text
                  numberOfLines={1}
                  style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}
                >
                  {address ? address.full_text : 'Укажите адрес доставки'}
                </Text>
                {/* Под адресом всегда понятно, кто везёт и когда: закрытый
                    ресторан не должен обещать «привезём за 60 минут» */}
                <Text
                  style={[
                    theme.typography.caption,
                    { color: outsideZone ? theme.colors.danger : theme.colors.textTertiary },
                  ]}
                >
                  {outsideZone
                    ? 'Доставки сюда нет'
                    : address?.restaurant_name
                      ? `${address.restaurant_name} · ${when}`
                      : 'Определим ресторан по адресу'}
                </Text>
              </View>

              <Ionicons
                name={pickingAddress ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={theme.colors.textTertiary}
              />
            </PressableScale>
          ) : (
            <View
              style={[
                styles.line,
                theme.elevation.card,
                {
                  gap: theme.spacing.md,
                  padding: theme.spacing.base,
                  borderRadius: theme.radius.xl,
                  backgroundColor: theme.colors.surface,
                },
              ]}
            >
              <View
                style={[
                  styles.center,
                  {
                    width: 42,
                    height: 42,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.colors.brandSubtle,
                  },
                ]}
              >
                <Ionicons name="storefront" size={20} color={theme.colors.brand} />
              </View>

              <View style={[styles.grow, { gap: 2 }]}>
                <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
                  забираете сами
                </Text>
                <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                  {bill?.restaurant_name ?? 'Ресторан не выбран'}
                </Text>
              </View>

              <Pressable accessibilityRole="button" hitSlop={theme.hitSlop} onPress={back}>
                <Text style={[theme.typography.caption, { color: theme.colors.brand }]}>
                  сменить
                </Text>
              </Pressable>
            </View>
          )}

          {outsideZone ? (
            <Animated.View
              entering={FadeIn.duration(200)}
              style={{
                gap: theme.spacing.sm,
                padding: theme.spacing.base,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.dangerSubtle,
              }}
            >
              <View style={[styles.line, { gap: theme.spacing.sm }]}>
                <Ionicons name="alert-circle" size={18} color={theme.colors.danger} />
                <Text
                  style={[theme.typography.bodyMedium, styles.grow, { color: theme.colors.danger }]}
                >
                  По этому адресу доставки нет
                </Text>
              </View>

              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                Заказ можно забрать самим или выбрать другой адрес — доставка сюда пока не ездит.
              </Text>

              <View style={[styles.line, { gap: theme.spacing.sm }]}>
                <PressableScale
                  depth={0.96}
                  accessibilityLabel="Перейти к самовывозу"
                  onPress={() => {
                    cart.setMode('pickup');
                    if (cart.pickupRestaurantId) cart.selectRestaurant(cart.pickupRestaurantId);
                  }}
                  style={{
                    paddingHorizontal: theme.spacing.base,
                    paddingVertical: theme.spacing.sm,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.colors.danger,
                  }}
                >
                  <Text style={[theme.typography.button, { color: theme.colors.onDanger }]}>
                    Забрать самим
                  </Text>
                </PressableScale>

                <PressableScale
                  depth={0.96}
                  accessibilityLabel="Выбрать другой адрес"
                  onPress={() => setPickingAddress(true)}
                  style={{
                    paddingHorizontal: theme.spacing.base,
                    paddingVertical: theme.spacing.sm,
                    borderRadius: theme.radius.pill,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.colors.danger,
                  }}
                >
                  <Text style={[theme.typography.button, { color: theme.colors.danger }]}>
                    Другой адрес
                  </Text>
                </PressableScale>
              </View>
            </Animated.View>
          ) : null}

          {pickupClosed ? (
            <Animated.View
              entering={FadeIn.duration(200)}
              style={{
                gap: theme.spacing.xs,
                padding: theme.spacing.base,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.dangerSubtle,
              }}
            >
              <View style={[styles.line, { gap: theme.spacing.sm }]}>
                <Ionicons name="moon" size={18} color={theme.colors.danger} />
                <Text
                  style={[theme.typography.bodyMedium, styles.grow, { color: theme.colors.danger }]}
                >
                  {delivery ? 'Доставка сейчас закрыта' : 'Ресторан сейчас закрыт'}
                </Text>
              </View>

              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                Заказы принимаем с {(bill?.delivery_opens_at ?? '').slice(0, 5)} до{' '}
                {(bill?.delivery_closes_at ?? '').slice(0, 5)}. Корзина сохранится.
              </Text>
            </Animated.View>
          ) : null}

          {/* Другие адреса гостя: выбор прямо здесь, без ухода в профиль */}
          {pickingAddress && delivery ? (
            <Animated.View entering={FadeInDown.duration(200)} style={{ gap: theme.spacing.sm }}>
              {(addresses.data ?? []).map((row) => {
                const picked = row.id === address?.id;

                return (
                  <PressableScale
                    key={row.id}
                    depth={0.99}
                    accessibilityLabel={row.full_text}
                    onPress={() => {
                      cart.selectAddress(row.id);
                      if (row.restaurant_id) cart.selectRestaurant(row.restaurant_id);
                      setPickingAddress(false);
                    }}
                    style={[
                      styles.line,
                      {
                        gap: theme.spacing.md,
                        padding: theme.spacing.base,
                        borderRadius: theme.radius.lg,
                        borderWidth: picked ? 1.5 : StyleSheet.hairlineWidth,
                        borderColor: picked ? theme.colors.brand : theme.colors.border,
                        backgroundColor: picked ? theme.colors.brandSubtle : theme.colors.surface,
                      },
                    ]}
                  >
                    <Ionicons
                      name={picked ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={picked ? theme.colors.brand : theme.colors.border}
                    />
                    <View style={styles.grow}>
                      <Text style={[theme.typography.body, { color: theme.colors.textPrimary }]}>
                        {row.full_text}
                      </Text>
                      {row.restaurant_name ? (
                        <Text
                          style={[theme.typography.caption, { color: theme.colors.textTertiary }]}
                        >
                          {row.restaurant_name}
                        </Text>
                      ) : null}
                    </View>
                  </PressableScale>
                );
              })}

              <PressableScale
                depth={0.98}
                accessibilityLabel="Добавить адрес"
                onPress={() => {
                  setPickingAddress(false);
                  router.push('/address-form');
                }}
                style={[
                  styles.line,
                  {
                    gap: theme.spacing.sm,
                    padding: theme.spacing.base,
                    borderRadius: theme.radius.lg,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderStyle: 'dashed',
                    borderColor: theme.colors.brand,
                  },
                ]}
              >
                <Ionicons name="add-circle-outline" size={20} color={theme.colors.brand} />
                <Text style={[theme.typography.bodyMedium, { color: theme.colors.brand }]}>
                  Добавить адрес
                </Text>
              </PressableScale>
            </Animated.View>
          ) : null}

          <Animated.View
            layout={LinearTransition}
            style={[
              theme.elevation.card,
              {
                borderRadius: theme.radius.xl,
                backgroundColor: theme.colors.surface,
                overflow: 'hidden',
              },
            ]}
          >
            {/* Шапка блока: кто готовит и на сколько собрано */}
            <Animated.View
              ref={basket}
              onLayout={measureBasket}
              style={[
                styles.line,
                basketStyle,
                {
                  gap: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.base,
                  paddingVertical: theme.spacing.md,
                  backgroundColor: theme.colors.brandSubtle,
                },
              ]}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: theme.radius.md,
                  overflow: 'hidden',
                  backgroundColor: theme.colors.surface,
                }}
              >
                {restaurants.data?.image_url ? (
                  <Image
                    source={{ uri: mediaUrl(restaurants.data.image_url) ?? '' }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.center, StyleSheet.absoluteFill]}>
                    <Ionicons name="storefront" size={16} color={theme.colors.brand} />
                  </View>
                )}
              </View>

              <View style={styles.grow}>
                <Text
                  numberOfLines={1}
                  style={[theme.typography.bodyMedium, { color: theme.colors.brand }]}
                >
                  {restaurants.data?.name ?? 'Ваш заказ'}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.brand }]}>
                  {when}
                </Text>
              </View>
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.brand }]}>
                {formatPrice(subtotal)}
              </Text>
            </Animated.View>

            {cart.items.map((item, index) => (
              <Animated.View
                key={item.key}
                entering={FadeIn.duration(180)}
                style={
                  index > 0
                    ? {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: theme.colors.divider,
                      }
                    : undefined
                }
              >
                <CartLine
                  item={item}
                  photo={details.get(item.dishId)?.photo ?? null}
                  note={details.get(item.dishId)?.note ?? null}
                  unavailable={
                    blocked.has(item.dishId)
                      ? blocked.get(item.dishId)?.startsWith('Закончилось')
                        ? 'Закончилось'
                        : 'Недоступно'
                      : null
                  }
                  onChange={(quantity) => cart.setQuantity(item.key, quantity)}
                  onOpen={() => router.push(`/dish/${item.dishId}`)}
                />
              </Animated.View>
            ))}

            <PressableScale
              depth={0.99}
              accessibilityLabel="Добавить ещё блюдо"
              onPress={back}
              style={[
                styles.line,
                {
                  gap: theme.spacing.sm,
                  padding: theme.spacing.base,
                  justifyContent: 'center',
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.divider,
                },
              ]}
            >
              <Ionicons name="add-circle-outline" size={18} color={theme.colors.brand} />
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.brand }]}>
                Добавить ещё блюдо
              </Text>
            </PressableScale>
          </Animated.View>

          {extraHint !== null ? (
            <Animated.View entering={FadeIn.duration(220)}>
              <PressableScale
                depth={0.985}
                accessibilityLabel={`Добавить ${extraHint.extra.name}`}
                onPress={() => {
                  setExtraPortions(1);
                  setExtraOpen(true);
                }}
                style={[
                  styles.line,
                  {
                    gap: theme.spacing.sm,
                    paddingVertical: theme.spacing.sm,
                    paddingLeft: theme.spacing.sm,
                    paddingRight: theme.spacing.xs,
                    borderRadius: theme.radius.pill,
                    borderWidth: 1.5,
                    borderColor: theme.colors.accent,
                    backgroundColor: theme.colors.accentSubtle,
                  },
                ]}
              >
                <ExtraIcon name={extraHint.extra.name} size={22} color={theme.colors.accent} />

                <Text
                  numberOfLines={1}
                  style={[theme.typography.bodyMedium, styles.grow, { color: theme.colors.textPrimary }]}
                >
                  Не забудьте сыр · {formatPrice(extraHint.extra.price_kopecks)}
                </Text>

                <View
                  style={{
                    paddingHorizontal: theme.spacing.base,
                    paddingVertical: theme.spacing.xs,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.colors.accent,
                  }}
                >
                  <Text style={[theme.typography.button, { color: theme.colors.onAccent }]}>
                    Добавить
                  </Text>
                </View>
              </PressableScale>
            </Animated.View>
          ) : null}

          {upsell.length > 0
            ? block(
                'К вашему заказу',
                'add-circle-outline',
                <UpsellShelf
                  dishes={upsell}
                  photo={(dish) => mediaUrl(dish.image_url) ?? null}
                  onAdd={(dish, from) => {
                    const uri = mediaUrl(dish.image_url);
                    if (from && uri) {
                      measureBasket();
                      setFlight({ ...from, uri });
                    } else {
                      cart.add(dish);
                    }
                  }}
                />,
              )
            : null}

          {delivery && bill?.free_delivery_from_kopecks ? (
            <FreeDeliveryBar
              subtotal={subtotal}
              freeFrom={bill.free_delivery_from_kopecks}
              left={bill.to_free_delivery_kopecks ?? 0}
            />
          ) : null}

          {pickupClosed
            ? null
            : block(
                delivery ? 'Когда привезти' : 'Когда забрать',
                'time-outline',
                <View style={{ gap: theme.spacing.xs }}>
                  <TimePicker slots={slots} value={deliveryAt} onChange={setDeliveryAt} />
                  {bill?.delivery_open_now === false ? (
                    <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>
                      Сегодня доставка закрыта — принимаем заказы на завтра, с{' '}
                      {(bill?.delivery_opens_at ?? '').slice(0, 5)}
                    </Text>
                  ) : null}

                  <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                    {delivery
                      ? 'Точное время может отличаться на ±20 минут: зависит от загрузки кухни и курьеров'
                      : 'Заказ будет готов к выбранному времени, ±20 минут по загрузке кухни'}
                  </Text>
                </View>,
              )}

          <PersonsRow
            value={persons}
            priceKopecks={bill?.cutlery_price_kopecks ?? 0}
            onChange={setPersons}
          />

          {authorized && bill ? (
            <PointsCard
              balance={bill.points_balance}
              maxToSpend={bill.max_points_to_spend}
              spending={usePoints}
              earned={bill.points_earned}
              onToggle={setUsePoints}
            />
          ) : null}

          {authorized
            ? block(
                'Промокод',
                'pricetag-outline',
                <PromoField
                  value={promoCode ?? ''}
                  applied={bill?.promo_code ?? null}
                  error={bill?.promo_error ?? null}
                  onApply={(code) => setPromoCode(code.length > 0 ? code : null)}
                  onClear={() => setPromoCode(null)}
                />,
              )
            : null}

          {/* Запоминаем, где начинается оплата: подсказка над кнопкой ведёт сюда */}
          <View onLayout={(event) => (paymentY.current = event.nativeEvent.layout.y)}>
            {block(
              'Оплата',
              'wallet-outline',
              <PaymentPicker
                value={payment}
                onChange={setPayment}
                allowOnline={tenant.features.onlinePayment}
                changeFrom={changeFrom}
                onChangeFrom={setChangeFrom}
              />,
            )}
          </View>

          <CommentField value={comment} onChange={setComment} />

          <View
            style={{
              gap: theme.spacing.sm,
              padding: theme.spacing.base,
              borderRadius: theme.radius.xl,
              backgroundColor: theme.colors.surfaceSunken,
            }}
          >
            {summaryRow(`Блюда · ${count}`, formatPrice(subtotal))}

            {bill === undefined && authorized ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Skeleton height={16} radius={theme.radius.sm} />
                <Skeleton height={16} radius={theme.radius.sm} />
              </View>
            ) : null}

            {delivery && bill !== undefined
              ? summaryRow(
                  'Доставка',
                  bill.delivery_kopecks > 0 ? formatPrice(bill.delivery_kopecks) : 'бесплатно',
                  bill.delivery_kopecks === 0 ? 'accent' : undefined,
                )
              : null}

            {bill && bill.cutlery_kopecks > 0
              ? summaryRow(`Приборы · ${persons}`, formatPrice(bill.cutlery_kopecks))
              : null}

            {bill && bill.promo_discount_kopecks > 0
              ? summaryRow(
                  `Промокод · ${bill.promo_code}`,
                  `−${formatPrice(bill.promo_discount_kopecks)}`,
                  'accent',
                )
              : null}

            {bill && bill.discount_kopecks > 0
              ? summaryRow(
                  `Баллы · ${bill.points_to_spend}`,
                  `−${formatPrice(bill.discount_kopecks)}`,
                  'accent',
                )
              : null}

            <View
              style={[
                styles.summaryRow,
                {
                  paddingTop: theme.spacing.sm,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.divider,
                },
              ]}
            >
              <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>Итого</Text>
              <AnimatedPrice
                kopecks={total}
                style={{ ...theme.typography.h3, color: theme.colors.textPrimary }}
              />
            </View>
          </View>

        </ScrollView>

        {/* Кнопка у самого края: на этом экране полосы вкладок нет */}
        <View
          style={{
            paddingHorizontal: theme.layout.screenPadding,
            paddingTop: theme.spacing.md,
            paddingBottom: insets.bottom + theme.spacing.md,
            gap: theme.spacing.sm,
            backgroundColor: theme.colors.surface,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.divider,
          }}
        >
          {failure !== null ? (
            <View
              style={[
                styles.line,
                {
                  gap: theme.spacing.sm,
                  padding: theme.spacing.sm,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.dangerSubtle,
                },
              ]}
            >
              <Ionicons name="close-circle" size={16} color={theme.colors.danger} />
              <Text style={[theme.typography.caption, styles.grow, { color: theme.colors.danger }]}>
                {failure}
              </Text>
            </View>
          ) : null}

          {blocker ?? needsAddress ? (
            <View
              style={[
                styles.line,
                {
                  gap: theme.spacing.sm,
                  padding: theme.spacing.sm,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.dangerSubtle,
                },
              ]}
            >
              <Ionicons name="alert-circle" size={16} color={theme.colors.danger} />
              <Text
                style={[theme.typography.caption, styles.grow, { color: theme.colors.danger }]}
              >
                {needsAddress ? 'Добавьте адрес доставки' : blocker}
              </Text>

              {blocked.size > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={theme.hitSlop}
                  onPress={() =>
                    cart.dropItems(
                      cart.items.filter((row) => blocked.has(row.dishId)).map((row) => row.key),
                    )
                  }
                >
                  <Text style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>
                    убрать
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* Пока оплата не выбрана, кнопка ждёт — и подсказка ведёт к ней вниз */}
          {authorized && payment === null ? (
            <PressableScale
              depth={0.99}
              accessibilityLabel="Перейти к выбору оплаты"
              onPress={() =>
                scroller.current?.scrollTo({ y: Math.max(0, paymentY.current - 12), animated: true })
              }
              style={[
                styles.line,
                {
                  gap: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.base,
                  paddingVertical: theme.spacing.sm,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.brandSubtle,
                },
              ]}
            >
              <Ionicons name="arrow-down-circle" size={18} color={theme.colors.brand} />
              <Text style={[theme.typography.bodyMedium, styles.grow, { color: theme.colors.brand }]}>
                Осталось выбрать оплату
              </Text>
              <Text style={[theme.typography.caption, { color: theme.colors.brand }]}>
                показать
              </Text>
            </PressableScale>
          ) : null}

          <View style={[styles.line, { gap: theme.spacing.base }]}>
            <View style={{ gap: 2 }}>
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                к оплате
              </Text>
              <AnimatedPrice
                kopecks={total}
                style={{ ...theme.typography.h2, color: theme.colors.textPrimary }}
              />
            </View>

            <View style={styles.grow}>
              <PrimaryButton
                label={
                  !authorized
                    ? 'Войти и оформить'
                    : createOrder.isPending
                      ? 'Оформляем…'
                      : 'Оформить заказ'
                }
                loading={createOrder.isPending}
                disabled={authorized && (blocker !== null || needsAddress || payment === null)}
                onPress={() => {
                  setFailure(null);
                  if (!authorized) {
                    router.push('/auth');
                    return;
                  }
                  createOrder.mutate();
                }}
              />
            </View>
          </View>
        </View>

        <FlyingDish
          flight={flight}
          target={target}
          onDone={() => {
            const dish = upsell.find((item) => mediaUrl(item.image_url) === flight?.uri);
            if (dish) cart.add(dish);
            bounce.value = withSequence(withSpring(1, { damping: 8 }), withSpring(0, { damping: 12 }));
            setFlight(null);
          }}
        />

        {/* Порций пасты в заказе может быть несколько — гость выбирает, ко
            скольким добавить сыр */}
        {extraHint !== null ? (
          <ExtraPortionsDialog
            visible={extraOpen}
            title={extraHint.extra.name}
            priceKopecks={extraHint.extra.price_kopecks}
            max={extraHint.portions}
            value={extraPortions}
            onChange={setExtraPortions}
            onCancel={() => setExtraOpen(false)}
            onConfirm={() => {
              let left = extraPortions;

              for (const line of extraHint.lines) {
                if (left <= 0) break;
                const take = Math.min(left, line.quantity);
                cart.addExtra(line.key, take, {
                  id: extraHint.extra.id,
                  name: extraHint.extra.name,
                  priceKopecks: extraHint.extra.price_kopecks,
                });
                left -= take;
              }

              setExtraOpen(false);
            }}
          />
        ) : null}

        <AppDialog
          visible={clearing}
          icon="trash"
          danger
          title="Очистить корзину?"
          description="Все выбранные блюда уберём. Это нельзя отменить."
          confirmLabel="Очистить"
          onConfirm={() => {
            cart.clear();
            setClearing(false);
          }}
          onCancel={() => setClearing(false)}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  line: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
});
