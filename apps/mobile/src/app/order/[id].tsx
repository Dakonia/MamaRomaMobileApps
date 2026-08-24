import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, mediaUrl, type Order } from '@/api/client';
import { Confetti } from '@/components/confetti';
import { EmptyState } from '@/components/empty-state';
import { PressableScale } from '@/components/pressable-scale';
import { PrimaryButton } from '@/components/primary-button';
import { Skeleton } from '@/components/skeleton';
import { PushPrompt } from '@/components/push-prompt';
import { StageMark } from '@/components/stage-mark';
import { formatPhone, formatPoints, formatPrice, phoneToUri } from '@/lib/format';
import { tenant } from '@/lib/tenant';
import { useRefresher } from '@/components/refresher';
import { useTheme } from '@/theme/theme-provider';

/** Шаги, которые видит гость. Внутренних статусов больше, но ему важны эти. */
const STEPS: { key: string; delivery: string; pickup: string; icon: keyof typeof Ionicons.glyphMap }[] =
  [
    { key: 'accepted', delivery: 'Принят', pickup: 'Принят', icon: 'receipt-outline' },
    { key: 'cooking', delivery: 'Готовим', pickup: 'Готовим', icon: 'flame-outline' },
    { key: 'ready', delivery: 'Готов', pickup: 'Готов', icon: 'bag-check-outline' },
    { key: 'delivering', delivery: 'В пути', pickup: 'Ждёт вас', icon: 'car-outline' },
    { key: 'completed', delivery: 'Доставлен', pickup: 'Выдан', icon: 'checkmark-done-outline' },
  ];

/** Восемь статусов сервера ложатся на пять понятных гостю шагов. */
const STAGE: Record<Order['status'], number> = {
  created: 0,
  paid: 0,
  accepted: 0,
  cooking: 1,
  ready: 2,
  delivering: 3,
  completed: 4,
  cancelled: 0,
};

/** Заголовок в шапке под текущий статус. */
const HEADLINE: Record<Order['status'], string> = {
  created: 'Заказ принят',
  paid: 'Заказ оплачен',
  accepted: 'Ресторан принял заказ',
  cooking: 'Готовим ваш заказ',
  ready: 'Заказ готов',
  delivering: 'Курьер в пути',
  completed: 'Спасибо за заказ!',
  cancelled: 'Заказ отменён',
};

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** Кружок шага: выезжает пружиной, активный мягко пульсирует. */
function Step({
  index,
  icon,
  label,
  done,
  active,
  brand,
  typography,
  spacing,
}: {
  index: number;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  done: boolean;
  active: boolean;
  brand: string;
  typography: ReturnType<typeof useTheme>['typography'];
  spacing: ReturnType<typeof useTheme>['spacing'];
}) {
  const pop = useSharedValue(0);
  const breathe = useSharedValue(0);

  useEffect(() => {
    pop.value = withDelay(620 + index * 110, withSpring(1, { damping: 12, stiffness: 180 }));
  }, [index, pop]);

  useEffect(() => {
    if (!active) return;
    breathe.value = withRepeat(
      withSequence(withTiming(1, { duration: 900 }), withTiming(0, { duration: 900 })),
      -1,
      false,
    );
  }, [active, breathe]);

  const circle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.6 + 0.4 * pop.value + (active ? breathe.value * 0.06 : 0) }],
    opacity: pop.value,
  }));

  const halo = useAnimatedStyle(() => ({
    opacity: active ? 0.35 * (1 - breathe.value) : 0,
    transform: [{ scale: 1 + breathe.value * 0.7 }],
  }));

  const filled = done || active;

  return (
    <View style={styles.step}>
      <View style={styles.center}>
        <Animated.View
          style={[
            styles.halo,
            halo,
            { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFFFFF' },
          ]}
        />

        <Animated.View
          style={[
            styles.center,
            circle,
            {
              width: 34,
              height: 34,
              borderRadius: 17,
              borderWidth: 2,
              borderColor: filled ? '#FFFFFF' : 'rgba(255,255,255,0.4)',
              backgroundColor: filled ? '#FFFFFF' : '#B4392C',
            },
          ]}
        >
          <Ionicons
            name={done ? 'checkmark' : icon}
            size={16}
            color={filled ? brand : 'rgba(255,255,255,0.75)'}
          />
        </Animated.View>
      </View>

      <Text
        numberOfLines={1}
        style={[
          typography.overline,
          { marginTop: spacing.xs, color: filled ? '#FFFFFF' : 'rgba(255,255,255,0.6)' },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export default function OrderScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.order(id),
    // Открыли карточку — сразу спрашиваем свежий статус, кэш здесь вреден
    staleTime: 0,
    refetchOnMount: 'always',
    // Пока заказ в работе, обновляем статус сами
    refetchInterval: (query) =>
      query.state.data && ['completed', 'cancelled'].includes(query.state.data.status)
        ? false
        : 30_000,
  });

  // Потянуть вниз: статус заказа обновляется сам, но гость хочет проверить
  const refresher = useRefresher(() => refetch());


  // Праздник — только у свежего заказа, дальше своя анимация этапа
  const fresh = data ? ['created', 'paid'].includes(data.status) : false;
  const delivery = data?.type === 'delivery';
  const stage = data ? STAGE[data.status] : 0;
  const cancelled = data?.status === 'cancelled';

  // Полоса доезжает до текущего шага, по ней бежит блик, курьер едет на конце
  const progress = useSharedValue(0);
  const shine = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      620,
      withTiming(cancelled ? 0 : stage / (STEPS.length - 1), { duration: 700 }),
    );
  }, [cancelled, progress, stage]);

  const live = data !== undefined && !['completed', 'cancelled'].includes(data.status);

  useEffect(() => {
    if (!live) return;

    shine.value = withDelay(
      900,
      withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }), -1, false),
    );
  }, [live, shine]);

  const progressStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const shineStyle = useAnimatedStyle(() => ({
    opacity: shine.value < 0.75 ? 1 : 0,
    transform: [{ translateX: -120 + shine.value * 460 }],
  }));


  if (isPending) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.backgroundAlt }]}>
        <View
          style={{
            padding: theme.layout.screenPadding,
            paddingTop: insets.top + 80,
            gap: theme.spacing.md,
          }}
        >
          <Skeleton height={120} radius={theme.radius.xxl} />
          <Skeleton height={90} radius={theme.radius.xl} />
          <Skeleton height={200} radius={theme.radius.xl} />
        </View>
      </View>
    );
  }

  if (isError || data === undefined) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.backgroundAlt }]}>
        <EmptyState
          icon="cloud-offline-outline"
          title="Заказ не открылся"
          description={error?.message ?? 'Попробуйте ещё раз'}
          actionLabel="Повторить"
          onAction={() => {
            void refetch();
          }}
        />
      </View>
    );
  }

  const when = (() => {
    if (!data.delivery_at) return delivery ? 'Привезём как можно скорее' : 'Готовим прямо сейчас';

    const at = new Date(data.delivery_at);
    const today = new Date().getDate() === at.getDate();
    const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;

    return `${delivery ? 'Привезём' : 'Будет готов'} ${
      today ? `к ${clock}` : `${at.getDate()} ${MONTHS[at.getMonth()]} к ${clock}`
    }`;
  })();

  const summaryRow = (label: string, value: string, accent?: boolean) => (
    <View style={styles.rowBetween} key={label}>
      <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>{label}</Text>
      <Text
        style={[
          theme.typography.bodyMedium,
          { color: accent ? theme.colors.accent : theme.colors.textPrimary },
        ]}
      >
        {value}
      </Text>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.backgroundAlt }]}>
      <ScrollView
        refreshControl={refresher}
        contentContainerStyle={{
          paddingBottom: theme.spacing.huge * 2,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Праздник в момент оформления: галочка рисуется, номер проявляется */}
        <LinearGradient
          colors={[theme.colors.brand, theme.colors.brandPressed, theme.colors.hero]}
          locations={[0, 0.55, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={{
            paddingTop: insets.top + theme.spacing.xl,
            paddingBottom: theme.spacing.xxl,
            paddingHorizontal: theme.layout.screenPadding,
            alignItems: 'center',
            gap: theme.spacing.md,
            borderBottomLeftRadius: theme.radius.xxl,
            borderBottomRightRadius: theme.radius.xxl,
          }}
        >
          {/* Конфетти — только на свежем заказе. Дальше у каждого этапа своя
              анимация, иначе праздник теряет смысл */}
          {fresh ? (
            <Confetti colors={['#FFFFFF', '#F7D9A0', '#8FD3B6', 'rgba(255,255,255,0.7)']} />
          ) : null}

          <StageMark status={data.status} type={data.type} />

          <Animated.Text
            entering={FadeInDown.delay(300).duration(320)}
            style={[theme.typography.display, { color: '#FFFFFF', textAlign: 'center' }]}
          >
            {HEADLINE[data.status] ?? 'Заказ принят'}
          </Animated.Text>

          <Animated.Text
            entering={FadeInDown.delay(420).duration(320)}
            style={[
              theme.typography.body,
              { color: 'rgba(255,255,255,0.86)', textAlign: 'center' },
            ]}
          >
            № {data.number} · {when}
          </Animated.Text>

          {/* Путь заказа: полоса с бликом и едущим курьером */}
          <Animated.View
            entering={FadeIn.delay(520).duration(320)}
            style={{ alignSelf: 'stretch', marginTop: theme.spacing.lg }}
          >
            <View style={styles.track}>
              <View
                style={[
                  styles.line,
                  {
                    backgroundColor: 'rgba(0,0,0,0.18)',
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: 'rgba(255,255,255,0.18)',
                  },
                ]}
              />

              <Animated.View style={[styles.fill, progressStyle]}>
                <LinearGradient
                  colors={['#FFE8D9', '#FFFFFF']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.line}
                />

                {/* Блик пробегает по пройденному пути — заказ «живой» */}
                <Animated.View style={[styles.shine, shineStyle]}>
                  <LinearGradient
                    colors={[
                      'rgba(255,255,255,0)',
                      'rgba(255,255,255,0.85)',
                      'rgba(255,255,255,0)',
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.shineBand}
                  />
                </Animated.View>
              </Animated.View>

            </View>

            <View style={[styles.row, styles.steps]}>
              {STEPS.map((step, index) => (
                <Step
                  key={step.key}
                  index={index}
                  icon={step.icon}
                  label={delivery ? step.delivery : step.pickup}
                  done={index < stage}
                  active={index === stage && !cancelled}
                  brand={theme.colors.brand}
                  typography={theme.typography}
                  spacing={theme.spacing}
                />
              ))}
            </View>
          </Animated.View>

        </LinearGradient>

        <View style={{ padding: theme.layout.screenPadding, gap: theme.spacing.lg }}>
          {/* Разрешение спрашиваем здесь: заказ уже оформлен, и гостю правда
              важно узнать, когда он поедет */}
          {['completed', 'cancelled'].includes(data.status) ? null : <PushPrompt />}

          {/* Куда и откуда */}
          <Animated.View
            entering={FadeIn.delay(560).duration(320)}
            style={[
              theme.elevation.card,
              {
                padding: theme.spacing.base,
                borderRadius: theme.radius.xl,
                backgroundColor: theme.colors.surface,
                gap: theme.spacing.sm,
              },
            ]}
          >
            <View style={[styles.row, { gap: theme.spacing.md }]}>
              <Ionicons
                name={delivery ? 'car' : 'storefront'}
                size={18}
                color={theme.colors.brand}
              />
              <View style={styles.grow}>
                <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                  {delivery ? (data.address_text ?? 'Адрес доставки') : data.restaurant_name}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                  {delivery ? `Готовит ${data.restaurant_name}` : (data.restaurant_address ?? '')}
                  {data.restaurant_phone ? ` · ${formatPhone(data.restaurant_phone)}` : ''}
                </Text>
              </View>

              <PressableScale
                depth={0.92}
                accessibilityLabel={`Позвонить в ${data.restaurant_name}`}
                onPress={() => {
                  void Linking.openURL(
                    phoneToUri(data.restaurant_phone ?? tenant.supportPhone),
                  );
                }}
                style={[
                  styles.center,
                  {
                    width: theme.layout.minTouchTarget,
                    height: theme.layout.minTouchTarget,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.colors.brandSubtle,
                  },
                ]}
              >
                <Ionicons name="call" size={17} color={theme.colors.brand} />
              </PressableScale>
            </View>

            {data.comment ? (
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                «{data.comment}»
              </Text>
            ) : null}
          </Animated.View>

          {data.points_earned > 0 ? (
            <Animated.View
              entering={FadeIn.delay(620).duration(320)}
              style={[
                styles.row,
                {
                  gap: theme.spacing.md,
                  padding: theme.spacing.base,
                  borderRadius: theme.radius.xl,
                  backgroundColor: theme.colors.accentSubtle,
                },
              ]}
            >
              <Ionicons name="sparkles" size={18} color={theme.colors.accent} />
              <Text style={[theme.typography.bodyMedium, styles.grow, { color: theme.colors.accent }]}>
                Начислим {formatPoints(data.points_earned)} после выполнения
              </Text>
            </Animated.View>
          ) : null}

          {/* Состав с фотографиями */}
          <Animated.View
            entering={FadeIn.delay(680).duration(320)}
            style={[
              theme.elevation.card,
              {
                borderRadius: theme.radius.xl,
                backgroundColor: theme.colors.surface,
                overflow: 'hidden',
              },
            ]}
          >
            {data.items.map((item, index) => (
              <View
                key={item.id}
                style={[
                  styles.row,
                  {
                    gap: theme.spacing.md,
                    padding: theme.spacing.sm,
                    borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
                    borderTopColor: theme.colors.divider,
                  },
                ]}
              >
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: theme.radius.md,
                    overflow: 'hidden',
                    backgroundColor: theme.colors.surfaceSunken,
                  }}
                >
                  {item.image_url ? (
                    <Image
                      source={{ uri: mediaUrl(item.image_url) ?? '' }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                    />
                  ) : null}
                </View>

                <View style={styles.grow}>
                  <Text style={[theme.typography.body, { color: theme.colors.textPrimary }]}>
                    {item.name} × {item.quantity}
                  </Text>
                  {item.extras.length > 0 ? (
                    <Text style={[theme.typography.caption, { color: theme.colors.brand }]}>
                      + {item.extras.map((extra) => extra.name).join(', ')}
                    </Text>
                  ) : null}
                </View>

                <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                  {formatPrice(item.total_kopecks)}
                </Text>
              </View>
            ))}
          </Animated.View>

          <Animated.View
            entering={FadeIn.delay(740).duration(320)}
            style={{
              gap: theme.spacing.sm,
              padding: theme.spacing.base,
              borderRadius: theme.radius.xl,
              backgroundColor: theme.colors.surfaceSunken,
            }}
          >
            {summaryRow('Блюда', formatPrice(data.subtotal_kopecks))}
            {data.cutlery_kopecks > 0
              ? summaryRow(`Приборы · ${data.persons_count ?? 0}`, formatPrice(data.cutlery_kopecks))
              : null}
            {data.delivery_kopecks > 0
              ? summaryRow('Доставка', formatPrice(data.delivery_kopecks))
              : null}
            {data.promo_discount_kopecks > 0
              ? summaryRow(
                  `Промокод · ${data.promo_code}`,
                  `−${formatPrice(data.promo_discount_kopecks)}`,
                  true,
                )
              : null}
            {data.discount_kopecks > 0
              ? summaryRow('Списано баллами', `−${formatPrice(data.discount_kopecks)}`, true)
              : null}

            <View
              style={[
                styles.rowBetween,
                {
                  paddingTop: theme.spacing.sm,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.divider,
                },
              ]}
            >
              <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>Итого</Text>
              <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
                {formatPrice(data.total_kopecks)}
              </Text>
            </View>

            {data.change_from_kopecks ? (
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                Курьер привезёт сдачу с {formatPrice(data.change_from_kopecks)}
              </Text>
            ) : null}
          </Animated.View>
        </View>
      </ScrollView>

      <View
        style={{
          paddingHorizontal: theme.layout.screenPadding,
          paddingTop: theme.spacing.md,
          paddingBottom: insets.bottom + theme.spacing.md,
          backgroundColor: theme.colors.surface,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.divider,
        }}
      >
        <PrimaryButton label="Вернуться в меню" onPress={() => router.replace('/')} />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Закрыть"
        hitSlop={theme.hitSlop}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        style={[
          styles.close,
          styles.center,
          {
            top: insets.top + theme.spacing.xs,
            left: theme.spacing.md,
            width: theme.layout.minTouchTarget,
            height: theme.layout.minTouchTarget,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.heroRaised,
          },
        ]}
      >
        <Ionicons name="close" size={20} color={theme.colors.onHero} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  grow: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute' },
  track: { height: 8, justifyContent: 'center' },
  line: { height: 8, borderRadius: 4, width: '100%' },
  fill: { position: 'absolute', left: 0, height: 8, borderRadius: 4, overflow: 'hidden' },
  shine: { position: 'absolute', top: 0, bottom: 0, width: 120 },
  shineBand: { flex: 1 },
  // Кружки поверх линии: иначе она просвечивает сквозь незакрашенные шаги
  steps: { justifyContent: 'space-between', marginTop: -19, zIndex: 2 },
  step: { alignItems: 'center', width: 62 },
  halo: { position: 'absolute' },
});
