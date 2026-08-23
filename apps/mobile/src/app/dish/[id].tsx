import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  useAnimatedScrollHandler,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, mediaUrl } from '@/api/client';
import { DishCard } from '@/components/dish-card';
import { EmptyState } from '@/components/empty-state';
import { ExtraIcon } from '@/components/extra-icon';
import { ExtrasSheet } from '@/components/extras-sheet';
import { PressableScale } from '@/components/pressable-scale';
import { formatPrice, plural } from '@/lib/format';
import { cartSubtotal, lineKey, useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

export default function DishScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cart = useCart();
  const { id } = useLocalSearchParams<{ id: string }>();

  const heroHeight = width;
  const scroll = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler((event) => {
    scroll.value = event.contentOffset.y;
  });

  // Вход в блюдо: снимок «доезжает» с лёгкого приближения, а текст поднимается
  // следом. Экран при этом проявляется — вместе это читается как наезд камеры
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
  }, [enter]);

  const heroStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          scroll.value,
          [-heroHeight, 0, heroHeight],
          [0, 0, heroHeight * 0.4],
        ),
      },
      {
        scale:
          interpolate(scroll.value, [-heroHeight, 0], [1.5, 1], 'clamp') *
          (1.07 - enter.value * 0.07),
      },
    ],
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 26 }],
  }));

  // Оттянуть вниз, чтобы закрыть: экран едет за пальцем с сопротивлением,
  // отпустили далеко — уходит вниз, близко — возвращается пружиной
  const pull = useSharedValue(0);
  const leaving = useSharedValue(false);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const swipeDown = Gesture.Pan()
    .activeOffsetY([-14, 14])
    .onUpdate((event) => {
      // Тянем только с самого верха списка, иначе жест мешает прокрутке
      if (scroll.value > 4 || event.translationY <= 0 || leaving.value) return;
      pull.value = event.translationY;
    })
    .onEnd((event) => {
      if (leaving.value) return;

      if (pull.value > 130 || event.velocityY > 900) {
        leaving.value = true;
        pull.value = withTiming(700, { duration: 260, easing: Easing.in(Easing.cubic) });
        runOnJS(close)();
        return;
      }

      pull.value = withSpring(0, { damping: 18, stiffness: 200 });
    });

  const screenStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: pull.value },
      // Чем дальше оттянули, тем меньше карточка — как будто уходит вглубь
      { scale: 1 - Math.min(pull.value, 400) / 2600 },
    ],
    borderRadius: Math.min(pull.value, 200) / 5,
    overflow: 'hidden',
  }));

  const cardWidth = (width - theme.layout.screenPadding * 2 - theme.spacing.md) / 2;

  const related = useQuery({
    queryKey: ['related', id, cart.restaurantId],
    queryFn: () => api.related(id, cart.restaurantId ?? undefined),
    enabled: Boolean(id),
  });

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

  const [picked, setPicked] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Одна и та же пицца с разными добавками — разные строки корзины
  const lineId = lineKey(
    id ?? '',
    picked.map((extraId: string) => ({ id: extraId, name: '', priceKopecks: 0 })),
  );
  const quantity = cart.items.find((item) => item.key === lineId)?.quantity ?? 0;

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

  // Состав приходит строкой через запятую — разбираем на плашки,
  // так он читается как список, а не как абзац
  const ingredients = (dish.composition ?? '')
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));

  const chosenExtras = (dish.extras ?? []).filter((extra) => picked.includes(extra.id));
  const extrasPrice = chosenExtras.reduce((sum, extra) => sum + extra.price_kopecks, 0);

  const addToCart = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    cart.add(
      dish,
      chosenExtras.map((extra) => ({
        id: extra.id,
        name: extra.name,
        priceKopecks: extra.price_kopecks,
      })),
    );
    setPicked([]);
  };

  return (
    <GestureDetector gesture={swipeDown}>
      <Animated.View style={[styles.root, screenStyle, { backgroundColor: theme.colors.background }]}>
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
            transition={200}
            placeholder={dish.image_blurhash ? { blurhash: dish.image_blurhash } : undefined}
            placeholderContentFit="cover"
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
      </Animated.View>

      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: theme.spacing.huge * 2.5 }}
      >
        <View style={{ height: heroHeight - theme.spacing.lg }} />

        <Animated.View
          style={[
            sheetStyle,
            {
              backgroundColor: theme.colors.background,
              borderTopLeftRadius: theme.radius.xxl,
              borderTopRightRadius: theme.radius.xxl,
              padding: theme.layout.screenPadding,
              paddingTop: theme.spacing.lg,
              gap: theme.spacing.base,
              minHeight: theme.spacing.huge * 5,
            },
          ]}
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

          <Text style={[theme.typography.display, { color: theme.colors.textPrimary }]}>
            {dish.name}
          </Text>

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
            <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.xs }}>
              <Text style={[theme.typography.h2, { color: theme.colors.textPrimary }]}>
                О блюде
              </Text>

              <View
                style={{
                  borderLeftWidth: theme.spacing.xxs,
                  borderLeftColor: theme.colors.brand,
                  paddingLeft: theme.spacing.base,
                  paddingVertical: theme.spacing.xxs,
                }}
              >
                <Text
                  style={[
                    theme.typography.bodyLg,
                    {
                      color: theme.colors.textPrimary,
                      lineHeight: theme.typography.bodyLg.lineHeight + theme.spacing.xs,
                    },
                  ]}
                >
                  {dish.description}
                </Text>
              </View>
            </View>
          ) : null}

          {ingredients.length > 0 ? (
            <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.xs }}>
              <Text style={[theme.typography.h2, { color: theme.colors.textPrimary }]}>Состав</Text>

              <View
                style={{
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surfaceSunken,
                  padding: theme.spacing.base,
                }}
              >
                <Text
                  style={[
                    theme.typography.bodyLg,
                    {
                      color: theme.colors.textPrimary,
                      lineHeight: theme.typography.bodyLg.lineHeight + theme.spacing.xs,
                    },
                  ]}
                >
                  {ingredients.map((item, index) => (
                    <Text key={item}>
                      {index > 0 ? (
                        <Text style={{ color: theme.colors.brand }}>{'  ·  '}</Text>
                      ) : null}
                      {item}
                    </Text>
                  ))}
                </Text>
              </View>
            </View>
          ) : null}

          {(dish.extras ?? []).length > 0 ? (
            <View style={{ gap: theme.spacing.sm }}>
              {/* Пара добавок помещается кнопками. Полсотни — только списком,
                  поэтому у пиццы открывается окно выбора */}
              {(dish.extras ?? []).length <= 3 ? (
                (dish.extras ?? []).map((extra) => {
                  const on = picked.includes(extra.id);

                  return (
                    <PressableScale
                      key={extra.id}
                      depth={0.985}
                      accessibilityLabel={`${on ? 'Убрать' : 'Добавить'} ${extra.name}`}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setPicked((current) =>
                          on ? current.filter((id) => id !== extra.id) : [...current, extra.id],
                        );
                      }}
                      style={[
                        styles.row,
                        theme.elevation.card,
                        {
                          gap: theme.spacing.base,
                          padding: theme.spacing.base,
                          borderRadius: theme.radius.xl,
                          borderWidth: on ? 1.5 : StyleSheet.hairlineWidth,
                          borderColor: on ? theme.colors.brand : theme.colors.border,
                          backgroundColor: on ? theme.colors.brandSubtle : theme.colors.surface,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.center,
                          {
                            width: 46,
                            height: 46,
                            borderRadius: theme.radius.pill,
                            backgroundColor: on ? theme.colors.brand : theme.colors.brandSubtle,
                          },
                        ]}
                      >
                        {on ? (
                          <Ionicons name="checkmark" size={22} color={theme.colors.textOnBrand} />
                        ) : (
                          <ExtraIcon name={extra.name} size={24} color={theme.colors.brand} />
                        )}
                      </View>

                      <View style={styles.grow}>
                        <Text
                          style={[theme.typography.h3, { color: theme.colors.textPrimary }]}
                        >
                          {extra.name.charAt(0).toUpperCase() + extra.name.slice(1)}
                        </Text>
                        <Text
                          style={[theme.typography.caption, { color: theme.colors.textTertiary }]}
                        >
                          {on ? 'Добавлено к блюду' : 'Добавить к блюду'}
                        </Text>
                      </View>

                      <View
                        style={{
                          paddingHorizontal: theme.spacing.base,
                          paddingVertical: theme.spacing.sm,
                          borderRadius: theme.radius.pill,
                          backgroundColor: on ? theme.colors.brand : theme.colors.surfaceSunken,
                        }}
                      >
                        <Text
                          style={[
                            theme.typography.button,
                            { color: on ? theme.colors.textOnBrand : theme.colors.textPrimary },
                          ]}
                        >
                          +{formatPrice(extra.price_kopecks)}
                        </Text>
                      </View>
                    </PressableScale>
                  );
                })
              ) : (
                <>
                  <PressableScale
                    depth={0.985}
                    accessibilityLabel="Выбрать добавки"
                    onPress={() => setPickerOpen(true)}
                    style={[
                      styles.row,
                      {
                        gap: theme.spacing.md,
                        padding: theme.spacing.base,
                        borderRadius: theme.radius.lg,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor:
                          chosenExtras.length > 0 ? theme.colors.brand : theme.colors.border,
                        backgroundColor:
                          chosenExtras.length > 0 ? theme.colors.brandSubtle : theme.colors.surface,
                      },
                    ]}
                  >
                    <Ionicons name="add-circle-outline" size={22} color={theme.colors.brand} />

                    <View style={styles.grow}>
                      <Text
                        style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}
                      >
                        Добавки
                      </Text>
                      <Text
                        style={[theme.typography.caption, { color: theme.colors.textTertiary }]}
                      >
                        {chosenExtras.length > 0
                          ? `Выбрано ${chosenExtras.length} · +${formatPrice(extrasPrice)}`
                          : `${(dish.extras ?? []).length} ${plural(
                              (dish.extras ?? []).length,
                              'вариант',
                              'варианта',
                              'вариантов',
                            )}`}
                      </Text>
                    </View>

                    <Ionicons name="chevron-forward" size={18} color={theme.colors.textTertiary} />
                  </PressableScale>

                  {chosenExtras.length > 0 ? (
                    <View style={[styles.row, { gap: theme.spacing.xs }]}>
                      {chosenExtras.map((extra) => (
                        <PressableScale
                          key={extra.id}
                          depth={0.95}
                          accessibilityLabel={`Убрать ${extra.name}`}
                          onPress={() =>
                            setPicked((current) => current.filter((id) => id !== extra.id))
                          }
                          style={[
                            styles.row,
                            {
                              gap: theme.spacing.xxs,
                              paddingLeft: theme.spacing.md,
                              paddingRight: theme.spacing.sm,
                              paddingVertical: theme.spacing.xs,
                              marginBottom: theme.spacing.xs,
                              borderRadius: theme.radius.pill,
                              backgroundColor: theme.colors.surfaceSunken,
                            },
                          ]}
                        >
                          <Text
                            style={[theme.typography.caption, { color: theme.colors.textPrimary }]}
                          >
                            {extra.name}
                          </Text>
                          <Ionicons name="close" size={13} color={theme.colors.textTertiary} />
                        </PressableScale>
                      ))}
                    </View>
                  ) : null}
                </>
              )}
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
        </Animated.View>

        {(related.data ?? []).length > 0 ? (
          <Text
            style={[
              theme.typography.h2,
              {
                color: theme.colors.textPrimary,
                backgroundColor: theme.colors.background,
                paddingHorizontal: theme.layout.screenPadding,
                paddingTop: theme.spacing.xl,
              },
            ]}
          >
            С этим берут
          </Text>
        ) : null}

        {(related.data ?? []).length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: theme.layout.screenPadding,
              paddingTop: theme.spacing.md,
              gap: theme.spacing.md,
            }}
            style={{ backgroundColor: theme.colors.background }}
          >
            {(related.data ?? []).map((item) => (
              <DishCard
                key={item.id}
                dish={item}
                width={cardWidth}
                quantity={cart.items.find((row) => row.dishId === item.id)?.quantity ?? 0}
                onOpen={() => router.push(`/dish/${item.id}`)}
                onAdd={() => cart.add(item)}
                onChangeQuantity={(next) => cart.setQuantity(item.id, next)}
              />
            ))}
          </ScrollView>
        ) : null}
      </Animated.ScrollView>

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <PressableScale
          onPress={() => router.back()}
          accessibilityLabel="Назад"
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
          <Ionicons name="chevron-back" size={theme.spacing.xl} color="#FFFFFF" />
        </PressableScale>
      </View>

      <ExtrasSheet
        visible={pickerOpen}
        extras={dish.extras ?? []}
        picked={picked}
        onToggle={(extraId) =>
          setPicked((current) =>
            current.includes(extraId)
              ? current.filter((id) => id !== extraId)
              : [...current, extraId],
          )
        }
        onClose={() => setPickerOpen(false)}
      />

      {dish.is_available ? (
        <View
          style={[
            styles.bar,
            {
              backgroundColor: theme.colors.surface,
              borderTopColor: theme.colors.divider,
            },
          ]}
        >
          <View
            style={[
              styles.barInner,
              {
                paddingHorizontal: theme.layout.screenPadding,
                paddingTop: theme.spacing.sm,
                paddingBottom: insets.bottom > 0 ? insets.bottom : theme.spacing.base,
                gap: theme.spacing.base,
              },
            ]}
          >
            <View style={styles.grow}>
              <Text style={[theme.typography.display, { color: theme.colors.textPrimary }]}>
                {formatPrice(dish.price_kopecks + extrasPrice)}
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
                    gap: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.sm,
                    minHeight: theme.layout.minTouchTarget + theme.spacing.xs,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.colors.brand,
                  },
                ]}
              >
                <PressableScale
                  onPress={() => cart.setQuantity(lineId, quantity - 1)}
                  accessibilityLabel="Убрать порцию"
                  depth={0.85}
                  style={[styles.center, { width: theme.spacing.xxl }]}
                >
                  <Ionicons name="remove" size={theme.spacing.lg} color={theme.colors.textOnBrand} />
                </PressableScale>

                <Text
                  style={[
                    theme.typography.button,
                    styles.counter,
                    { color: theme.colors.textOnBrand, minWidth: theme.spacing.lg },
                  ]}
                >
                  {quantity}
                </Text>

                <PressableScale
                  onPress={() => cart.setQuantity(lineId, quantity + 1)}
                  accessibilityLabel="Добавить порцию"
                  depth={0.85}
                  style={[styles.center, { width: theme.spacing.xxl }]}
                >
                  <Ionicons name="add" size={theme.spacing.lg} color={theme.colors.textOnBrand} />
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
        </View>
      ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  veilTop: { position: 'absolute', top: 0, left: 0, right: 0 },
  veilBottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  title: { position: 'absolute' },
  grabber: { alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  counter: { textAlign: 'center' },
  grow: { flex: 1 },
  nutrition: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center' },
  close: { position: 'absolute' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barInner: { flexDirection: 'row', alignItems: 'center' },
  action: { alignItems: 'center', justifyContent: 'center' },
});
