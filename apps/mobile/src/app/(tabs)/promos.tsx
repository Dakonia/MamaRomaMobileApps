import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, mediaUrl, type Promotion } from '@/api/client';
import { EmptyState } from '@/components/empty-state';
import { PizzaBackdrop } from '@/components/pizza-backdrop';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenHeader } from '@/components/screen-header';
import { Skeleton } from '@/components/skeleton';
import { useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** Раздел ленты: крупные карточки для доставки, плитка для афиш. */
type Block = {
  key: string;
  title: string;
  note?: string;
  layout: 'wide' | 'tiles';
  promotions: Promotion[];
};

/** Пропорция кадра самой картинки: так ничего не обрезается.
 *  Совсем узкие и совсем высокие всё же придерживаем, чтобы лента не рвалась. */
function ratio(promotion: Promotion): number {
  const width = promotion.image_width ?? 0;
  const height = promotion.image_height ?? 0;
  if (width < 1 || height < 1) return 1.5;
  return Math.min(1.9, Math.max(0.8, width / height));
}

function until(promotion: Promotion): string | null {
  if (!promotion.ends_at) return null;
  const date = new Date(promotion.ends_at);
  return `До ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** Мероприятие живёт до даты, постоянное предложение — без срока. */
function isEvent(promotion: Promotion): boolean {
  return promotion.ends_at !== null || promotion.starts_at !== null;
}

/** Сколько дней осталось до события: старт, если он впереди, иначе окончание. */
function daysLeft(promotion: Promotion): number | null {
  const now = Date.now();
  const start = promotion.starts_at ? new Date(promotion.starts_at).getTime() : null;
  const end = promotion.ends_at ? new Date(promotion.ends_at).getTime() : null;
  const moment = start !== null && start > now ? start : end;

  if (moment === null || moment < now) return null;
  return Math.round((moment - now) / 86_400_000);
}

function soonLabel(days: number): string {
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'завтра';
  if (days < 5) return `через ${days} дня`;
  return `через ${days} дней`;
}

function preview(promotion: Promotion): string | null {
  if (!promotion.description) return null;
  return promotion.description.replace(/\s*\n\s*/g, ' ');
}

/** Мягкая пульсация: ближайшее событие само притягивает взгляд. */
function SoonBadge({ label }: { label: string }) {
  const theme = useTheme();
  const beat = useSharedValue(0);

  useEffect(() => {
    beat.value = withRepeat(
      withSequence(withTiming(1, { duration: 900 }), withTiming(0, { duration: 900 })),
      -1,
      false,
    );
  }, [beat]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.75 + 0.25 * beat.value,
    transform: [{ scale: 0.97 + 0.03 * beat.value }],
  }));

  return (
    <Animated.View
      style={[
        style,
        {
          alignSelf: 'flex-start',
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.xxs,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.accent,
        },
      ]}
    >
      <Text style={[theme.typography.overline, { color: theme.colors.onAccent }]}>{label}</Text>
    </Animated.View>
  );
}

export default function PromosScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cart = useCart();
  const [tab, setTab] = useState<string | null>(null);

  // Пока список наверху, панель сливается с фоном; как только карточки уезжают
  // под неё — появляется линия и лёгкая тень, иначе они наползают друг на друга
  const scrolled = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrolled.value = withTiming(event.contentOffset.y > 6 ? 1 : 0, { duration: 160 });
  });

  const barStyle = useAnimatedStyle(() => ({
    borderBottomColor: theme.colors.divider,
    borderBottomWidth: scrolled.value * StyleSheet.hairlineWidth,
    shadowOpacity: scrolled.value * 0.08,
  }));

  const promos = useQuery({
    queryKey: ['promotions', 'all'],
    queryFn: () => api.promotions(),
  });

  const restaurant = useQuery({
    queryKey: ['restaurant', cart.restaurantId],
    queryFn: () => api.restaurants(),
    enabled: cart.restaurantId !== null,
    select: (rows) => rows.find((row) => row.id === cart.restaurantId) ?? null,
  });

  const blocks = useMemo<Block[]>(() => {
    const all = promos.data ?? [];
    const mine = cart.restaurantId;

    const delivery = all.filter((promotion) => promotion.show_in_menu);
    const rest = all.filter((promotion) => !promotion.show_in_menu);

    // Акция без списка ресторанов действует во всей сети — она «своя» всегда
    const belongs = (promotion: Promotion) =>
      mine === null ||
      promotion.restaurant_ids.length === 0 ||
      promotion.restaurant_ids.includes(mine);

    const here = rest.filter(belongs);
    const elsewhere = rest.filter((promotion) => !belongs(promotion));
    const events = here.filter(isEvent);
    const always = here.filter((promotion) => !isEvent(promotion));

    const found: Block[] = [];

    if (delivery.length > 0) {
      found.push({
        key: 'delivery',
        title: 'Доставка',
        note: 'Действует при заказе в приложении',
        layout: 'wide',
        promotions: delivery,
      });
    }

    if (events.length > 0) {
      found.push({
        key: 'events',
        title: 'Мероприятия',
        note: 'Вечеринки, дегустации и сезонные меню',
        layout: 'tiles',
        promotions: events,
      });
    }

    if (always.length > 0) {
      found.push({
        key: 'always',
        title: 'Постоянные',
        note: 'Работают без ограничения по датам',
        layout: 'tiles',
        promotions: always,
      });
    }

    if (elsewhere.length > 0) {
      found.push({
        key: 'elsewhere',
        title: 'В других ресторанах',
        note: undefined,
        layout: 'tiles',
        promotions: elsewhere,
      });
    }

    return found;
  }, [promos.data, cart.restaurantId]);

  // Вкладка держится, пока такой раздел есть. По умолчанию открываем
  // мероприятия: за ними приходят чаще, чем за условиями доставки
  const active =
    blocks.find((block) => block.key === tab) ??
    blocks.find((block) => block.key === 'events') ??
    blocks[0];

  // Ближайшее по дате событие метим живой плашкой
  const soonest = useMemo(() => {
    const events = (promos.data ?? []).filter((promotion) => !promotion.show_in_menu);
    let best: { id: string; days: number } | null = null;

    for (const promotion of events) {
      const days = daysLeft(promotion);
      if (days === null) continue;
      if (best === null || days < best.days) best = { id: promotion.id, days };
    }

    return best;
  }, [promos.data]);

  const open = (promotion: Promotion) => router.push(`/promo/${promotion.id}`);

  const photo = (promotion: Promotion, rounded: number) => {
    const uri = mediaUrl(promotion.image_url);
    if (!uri) return null;

    return (
      <View>
        <Image
          source={{ uri }}
          style={{
            width: '100%',
            aspectRatio: ratio(promotion),
            backgroundColor: theme.colors.skeleton,
            borderTopLeftRadius: rounded,
            borderTopRightRadius: rounded,
          }}
          contentFit="cover"
          transition={220}
        />

        {promotion.show_in_menu ? (
          <View
            style={[
              styles.tag,
              {
                top: theme.spacing.md,
                left: theme.spacing.md,
                gap: theme.spacing.xxs,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.xs,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.brand,
              },
            ]}
          >
            <Ionicons name="car" size={13} color={theme.colors.textOnBrand} />
            <Text style={[theme.typography.overline, { color: theme.colors.textOnBrand }]}>
              доставка
            </Text>
          </View>
        ) : null}

        {promotion.label ? (
          <View
            style={[
              styles.tag,
              {
                bottom: theme.spacing.md,
                left: theme.spacing.md,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.xs,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.surface,
              },
            ]}
          >
            <Text style={[theme.typography.button, { color: theme.colors.brand }]}>
              {promotion.label}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  const wideCard = (promotion: Promotion, index: number) => {
    const deadline = until(promotion);
    const text = preview(promotion);

    return (
      <Animated.View key={promotion.id} entering={FadeIn.duration(220).delay(Math.min(index, 6) * 40)}>
        <PressableScale
          onPress={() => open(promotion)}
          accessibilityLabel={promotion.title}
          depth={0.985}
          style={[
            styles.card,
            theme.elevation.card,
            { borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface },
          ]}
        >
          {photo(promotion, theme.radius.xl)}

          <View style={{ padding: theme.spacing.base, gap: theme.spacing.xxs }}>
            <Text numberOfLines={2} style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
              {promotion.title}
            </Text>

            {text ? (
              <Text
                numberOfLines={3}
                style={[theme.typography.body, { color: theme.colors.textSecondary }]}
              >
                {text}
              </Text>
            ) : null}

            <View style={[styles.row, { gap: theme.spacing.sm, marginTop: theme.spacing.xs }]}>
              {deadline ? (
                <Text style={[theme.typography.caption, { color: theme.colors.accent }]}>
                  {deadline}
                </Text>
              ) : null}

              <Text style={[theme.typography.caption, styles.grow, { color: theme.colors.brand }]}>
                Подробнее
              </Text>

              <Ionicons name="chevron-forward" size={14} color={theme.colors.brand} />
            </View>
          </View>
        </PressableScale>
      </Animated.View>
    );
  };

  const tile = (promotion: Promotion, index: number) => {
    const deadline = until(promotion);
    const days = soonest !== null && soonest.id === promotion.id ? soonest.days : null;
    const where =
      promotion.restaurant_names.length === 0
        ? 'Во всех ресторанах'
        : promotion.restaurant_names.length > 1
          ? `${promotion.restaurant_names.length} ресторанов`
          : promotion.restaurant_names[0];

    return (
      <Animated.View key={promotion.id} entering={FadeIn.duration(220).delay(Math.min(index, 8) * 30)}>
        <PressableScale
          onPress={() => open(promotion)}
          accessibilityLabel={promotion.title}
          depth={0.98}
          style={[
            styles.card,
            theme.elevation.card,
            { borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface },
          ]}
        >
          {photo(promotion, theme.radius.lg)}

          <View style={{ padding: theme.spacing.md, gap: theme.spacing.xxs }}>
            <Text
              numberOfLines={3}
              style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}
            >
              {promotion.title}
            </Text>

            <Text
              numberOfLines={1}
              style={[theme.typography.caption, { color: theme.colors.textTertiary }]}
            >
              {where}
            </Text>

            {days !== null ? (
              <SoonBadge label={soonLabel(days)} />
            ) : deadline ? (
              <Text style={[theme.typography.caption, { color: theme.colors.accent }]}>
                {deadline}
              </Text>
            ) : null}
          </View>
        </PressableScale>
      </Animated.View>
    );
  };

  /** Плитка в две колонки: карточки разной высоты, поэтому раскладываем сами,
   *  иначе строка равняется по самой высокой и снизу остаются дыры. */
  const tiles = (promotions: Promotion[]) => {
    const gap = theme.spacing.md;
    const columnWidth = (width - theme.layout.screenPadding * 2 - gap) / 2;

    const columns: Promotion[][] = [[], []];
    for (const promotion of promotions) {
      // Высота плитки — от пропорции картинки, кладём в колонку покороче
      const heights = columns.map((column) =>
        column.reduce((sum, item) => sum + columnWidth / ratio(item) + 92, 0),
      );
      columns[heights[0] <= heights[1] ? 0 : 1].push(promotion);
    }

    return (
      <View style={[styles.row, { gap, alignItems: 'flex-start' }]}>
        {columns.map((column, index) => (
          <View key={index} style={{ width: columnWidth, gap }}>
            {column.map((promotion, position) => tile(promotion, position))}
          </View>
        ))}
      </View>
    );
  };

  const content = () => {
    if (promos.isPending) {
      return (
        <View style={{ padding: theme.layout.screenPadding, gap: theme.spacing.lg }}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} height={230} radius={theme.radius.xl} />
          ))}
        </View>
      );
    }

    if (promos.isError) {
      return (
        <EmptyState
          icon="cloud-offline-outline"
          title="Акции не загрузились"
          description={promos.error.message}
          actionLabel="Повторить"
          onAction={() => {
            void promos.refetch();
          }}
        />
      );
    }

    if (blocks.length === 0) {
      return (
        <EmptyState
          icon="pricetags-outline"
          title="Пока без акций"
          description="Здесь появятся сезонные предложения и подборки."
        />
      );
    }

    if (active === undefined) return null;

    return (
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenPadding,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.layout.tabBarHeight + insets.bottom + theme.spacing.xxxl,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={promos.isRefetching}
            onRefresh={() => {
              void promos.refetch();
            }}
            tintColor={theme.colors.brand}
          />
        }
      >
        {active.key === 'elsewhere' && restaurant.data ? (
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            Ваш ресторан — {restaurant.data.name}. Эти акции идут в других
          </Text>
        ) : null}

        {active.note ? (
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            {active.note}
          </Text>
        ) : null}

        {active.layout === 'wide' ? active.promotions.map(wideCard) : tiles(active.promotions)}
      </Animated.ScrollView>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.backgroundAlt }]}>
      <PizzaBackdrop strength={0.55} />

      <ScreenHeader title="Акции" />

      <Animated.View
        style={[
          styles.bar,
          barStyle,
          {
            paddingTop: theme.spacing.sm,
            paddingBottom: theme.spacing.sm,
            gap: theme.spacing.sm,
            backgroundColor: theme.colors.backgroundAlt,
          },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: theme.layout.screenPadding,
            gap: theme.spacing.sm,
          }}
        >
          {blocks.map((block) => {
            const picked = block.key === active?.key;

            return (
              <PressableScale
                key={block.key}
                depth={0.96}
                accessibilityLabel={block.title}
                onPress={() => setTab(block.key)}
                style={[
                  styles.row,
                  {
                    gap: theme.spacing.xs,
                    paddingHorizontal: theme.spacing.base,
                    paddingVertical: theme.spacing.sm,
                    borderRadius: theme.radius.pill,
                    backgroundColor: picked ? theme.colors.brand : theme.colors.surface,
                  },
                ]}
              >
                <Text
                  style={[
                    theme.typography.bodyMedium,
                    { color: picked ? theme.colors.textOnBrand : theme.colors.textSecondary },
                  ]}
                >
                  {block.title}
                </Text>

                <Text
                  style={[
                    theme.typography.caption,
                    {
                      color: picked ? theme.colors.textOnBrand : theme.colors.textTertiary,
                    },
                  ]}
                >
                  {block.promotions.length}
                </Text>
              </PressableScale>
            );
          })}
        </ScrollView>
      </Animated.View>

      {content()}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  card: { overflow: 'hidden' },
  bar: {
    zIndex: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
  },
  tag: { position: 'absolute', flexDirection: 'row', alignItems: 'center' },
});
