import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useState } from 'react';
import { router } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api/client';
import { LoyaltyCard } from '@/components/loyalty-card';
import { AppearanceSwitch } from '@/components/appearance-switch';
import { ConfirmSheet } from '@/components/confirm-sheet';
import { EmptyArt } from '@/components/empty-art';
import { LoyaltyRules } from '@/components/loyalty-rules';
import { PizzaBackdrop } from '@/components/pizza-backdrop';
import { ActiveOrder } from '@/components/active-order';
import { OrderHistoryCard } from '@/components/order-history-card';
import { PressableScale } from '@/components/pressable-scale';
import { MarketingSwitch } from '@/components/marketing-switch';
import { MessagesStrip } from '@/components/messages-strip';
import { PushSwitch } from '@/components/push-switch';
import { ReservationStrip } from '@/components/reservation-strip';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/components/screen-header';
import { Skeleton } from '@/components/skeleton';
import { track } from '@/lib/analytics';
import { formatPhone, formatPrice, phoneToUri } from '@/lib/format';
import { formatPhone as formatGuestPhone } from '@/lib/phone';
import { tenant } from '@/lib/tenant';
import { useSession } from '@/store/session';
import { useRefresher } from '@/components/refresher';
import { useTheme } from '@/theme/theme-provider';

type Shortcut = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  to: '/profile-edit' | '/addresses';
};

const SHORTCUTS: Shortcut[] = [
  { icon: 'person-outline', label: 'Личные данные', hint: 'Имя, почта, дата рождения', to: '/profile-edit' },
  { icon: 'location-outline', label: 'Адреса', hint: 'Дом, работа и другие', to: '/addresses' },
];

type Link = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  url: string;
};

export default function ProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const authorized = session.status === 'authorized' && session.guest !== null;

  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.orders(),
    enabled: authorized,
  });

  // Потянуть вниз: баланс, заказы и брони разом
  const refresher = useRefresher(
    async () => {
      await Promise.all([session.restore(), orders.refetch()]);
    },
    insets.top + theme.spacing.xxl,
  );

  // Какое из двух окон открыто: выход или удаление аккаунта
  const [asking, setAsking] = useState<'exit' | 'delete' | null>(null);

  const remove = useMutation({
    mutationFn: () => {
      track('account_deleted');
      return api.deleteAccount();
    },
    onSettled: () => {
      // Что бы ни ответил сервер, на устройстве не остаётся ни токена, ни корзины
      setAsking(null);
      void session.signOut();
    },
  });

  const summary = useQuery({
    queryKey: ['guest-summary'],
    queryFn: () => api.summary(),
    enabled: authorized,
    staleTime: 5 * 60_000,
  });

  // Шапка сжимается при прокрутке: карта уезжает вверх, а её место занимает
  // узкая полоса с баллами — так баланс виден всегда
  const scrolled = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrolled.value = withTiming(event.contentOffset.y > 150 ? 1 : 0, { duration: 200 });
  });

  const compactBar = useAnimatedStyle(() => ({
    opacity: scrolled.value,
    transform: [{ translateY: -14 * (1 - scrolled.value) }],
    pointerEvents: scrolled.value > 0.5 ? 'auto' : 'none',
  }));

  const contacts: Link[] = [
    {
      icon: 'call-outline',
      label: 'Служба доставки',
      value: formatPhone(tenant.supportPhone),
      url: phoneToUri(tenant.supportPhone),
    },
    {
      icon: 'mail-outline',
      label: 'Написать нам',
      value: tenant.supportEmail,
      url: `mailto:${tenant.supportEmail}`,
    },
    { icon: 'globe-outline', label: 'Сайт сети', url: tenant.websiteUrl },
  ];

  const legal: Link[] = [
    { icon: 'shield-outline', label: 'Политика конфиденциальности', url: tenant.privacyPolicyUrl },
    { icon: 'document-text-outline', label: 'Публичная оферта', url: tenant.offerUrl },
  ];

  const linkRow = (row: Link, index: number, total: number) => (
    <PressableScale
      key={row.label}
      depth={0.985}
      accessibilityLabel={row.label}
      onPress={() => {
        void Linking.openURL(row.url);
      }}
      style={[
        styles.row,
        {
          minHeight: theme.layout.minTouchTarget + theme.spacing.xs,
          paddingHorizontal: theme.spacing.base,
          gap: theme.spacing.md,
          backgroundColor: theme.colors.surface,
          borderBottomWidth: index === total - 1 ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.divider,
        },
      ]}
    >
      <View
        style={[
          styles.icon,
          {
            width: theme.spacing.xxl,
            height: theme.spacing.xxl,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surfaceSunken,
          },
        ]}
      >
        <Ionicons name={row.icon} size={18} color={theme.colors.textSecondary} />
      </View>

      <View style={styles.grow}>
        <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
          {row.label}
        </Text>
        {row.value ? (
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {row.value}
          </Text>
        ) : null}
      </View>

      <Ionicons name="chevron-forward" size={18} color={theme.colors.textTertiary} />
    </PressableScale>
  );

  const group = (rows: Link[]) => (
    <View
      style={{
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        overflow: 'hidden',
      }}
    >
      {rows.map((row, index) => linkRow(row, index, rows.length))}
    </View>
  );

  const title = (text: string, action?: string, onPress?: () => void) => (
    <View style={[styles.row, styles.between, { paddingHorizontal: theme.spacing.xs }]}>
      <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>{text}</Text>
      {action && onPress ? (
        <Text
          onPress={onPress}
          style={[theme.typography.bodyMedium, { color: theme.colors.brand }]}
        >
          {action}
        </Text>
      ) : null}
    </View>
  );

  const history = orders.data ?? [];

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.backgroundAlt }]}>
      {/* Тот же фон, что на входе: за карточками медленно плывут пиццы */}
      <PizzaBackdrop strength={0.7} />

      <ScreenHeader title="Профиль" />

      {authorized && session.loyalty ? (
        <Animated.View
          style={[
            styles.compact,
            compactBar,
            theme.elevation.card,
            {
              top: insets.top + theme.spacing.xs,
              marginHorizontal: theme.layout.screenPadding,
              paddingHorizontal: theme.spacing.base,
              paddingVertical: theme.spacing.sm,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.hero,
              gap: theme.spacing.sm,
            },
          ]}
        >
          <Ionicons name="pizza" size={16} color={theme.colors.onHeroMuted} />
          <Text style={[theme.typography.bodyMedium, styles.grow, { color: theme.colors.onHero }]}>
            {session.loyalty.tier_title}
          </Text>
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.onHero }]}>
            {session.loyalty.points_balance} баллов
          </Text>
        </Animated.View>
      ) : null}

      <Animated.ScrollView
        refreshControl={refresher}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          gap: theme.spacing.xl,
          // Полоса вкладок занимает своё место в разметке и сама отступает от
          // системной полосы — добавлять её высоту сюда значит оставить пустоту
          paddingBottom: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {authorized && session.guest ? (
          <>
            {session.loyalty ? (
              <Animated.View entering={FadeInDown.duration(340)}>
                <LoyaltyCard
                  loyalty={session.loyalty}
                  name={session.guest.name ?? formatGuestPhone(session.guest.phone)}
                  birthday={session.guest.birthday}
                />
              </Animated.View>
            ) : null}

            {session.loyalty ? (
              <Animated.View entering={FadeInDown.duration(340).delay(60)}>
                <LoyaltyRules tierCode={session.loyalty.tier_code} />
              </Animated.View>
            ) : null}

            {/* Сразу под правилами баллов: сначала «что у меня», потом «что сейчас» */}
            <ActiveOrder compact />

            <ReservationStrip />

            <MessagesStrip />

            {session.guest.name ? null : (
              <Animated.View entering={FadeIn}>
                <PrimaryButton
                  label="Указать имя"
                  tone="ghost"
                  onPress={() => router.push({ pathname: '/auth', params: { step: 'name' } })}
                />
              </Animated.View>
            )}

            <Animated.View
              entering={FadeInDown.duration(340).delay(80)}
              style={[styles.tiles, { gap: theme.spacing.md }]}
            >
              {SHORTCUTS.map((item) => (
                <PressableScale
                  key={item.to}
                  onPress={() => router.push(item.to)}
                  accessibilityLabel={item.label}
                  style={[
                    styles.tile,
                    theme.elevation.card,
                    {
                      padding: theme.spacing.base,
                      borderRadius: theme.radius.xl,
                      backgroundColor: theme.colors.surface,
                      gap: theme.spacing.sm,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.icon,
                      {
                        width: theme.spacing.xxl,
                        height: theme.spacing.xxl,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.brandSubtle,
                      },
                    ]}
                  >
                    <Ionicons name={item.icon} size={18} color={theme.colors.brand} />
                  </View>
                  <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                    {item.label}
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                    {item.hint}
                  </Text>
                </PressableScale>
              ))}
            </Animated.View>

            <Animated.View entering={FadeInDown.duration(340).delay(160)} style={{ gap: theme.spacing.md }}>
              <View style={[styles.between, { gap: theme.spacing.sm }]}>
                {title('Последние заказы')}

                {history.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={theme.hitSlop}
                    onPress={() => router.push('/orders')}
                  >
                    <Text style={[theme.typography.bodyMedium, { color: theme.colors.brand }]}>
                      все {history.length}
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {orders.isPending ? (
                [0, 1].map((key) => <Skeleton key={key} height={150} radius={theme.radius.xl} />)
              ) : history.length === 0 ? (
                <View
                  style={{
                    paddingVertical: theme.spacing.lg,
                    borderRadius: theme.radius.xl,
                    backgroundColor: theme.colors.surface,
                    alignItems: 'center',
                    gap: theme.spacing.xs,
                  }}
                >
                  <EmptyArt kind="orders" />
                  <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                    Заказов ещё не было
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    Загляните в меню — там есть что выбрать
                  </Text>
                </View>
              ) : (
                // В профиле показываем только пару последних: остальное — на своём экране
                history.slice(0, 2).map((order) => (
                  <OrderHistoryCard
                    key={order.id}
                    order={order}
                    onPress={() => router.push(`/order/${order.id}`)}
                  />
                ))
              )}

              {history.length > 2 ? (
                <PressableScale
                  depth={0.98}
                  accessibilityLabel="Открыть все заказы"
                  onPress={() => router.push('/orders')}
                  style={{
                    padding: theme.spacing.base,
                    borderRadius: theme.radius.lg,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.colors.border,
                    alignItems: 'center',
                  }}
                >
                  <Text style={[theme.typography.bodyMedium, { color: theme.colors.brand }]}>
                    Вся история заказов
                  </Text>
                </PressableScale>
              ) : null}
            </Animated.View>
          </>
        ) : (
          <Animated.View
            entering={FadeInDown.duration(340)}
            style={[
              theme.elevation.card,
              {
                padding: theme.spacing.xl,
                borderRadius: theme.radius.xxl,
                backgroundColor: theme.colors.surface,
                gap: theme.spacing.sm,
              },
            ]}
          >
            <Ionicons name="pizza" size={30} color={theme.colors.brand} />
            <Text style={[theme.typography.h2, { color: theme.colors.textPrimary }]}>
              Войдите по номеру
            </Text>
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
              Начислим {tenant.loyalty.welcomeBonus} приветственных баллов, сохраним адреса и историю
              заказов.
            </Text>
            <View style={{ marginTop: theme.spacing.sm }}>
              <PrimaryButton label="Войти" onPress={() => router.push('/auth')} />
            </View>
          </Animated.View>
        )}

        {authorized && (summary.data?.orders_count ?? 0) > 0 ? (
          <Animated.View
            entering={FadeIn.duration(340)}
            style={{
              padding: theme.spacing.base,
              borderRadius: theme.radius.xl,
              backgroundColor: theme.colors.surface,
              gap: theme.spacing.xxs,
            }}
          >
            <Text style={[theme.typography.body, { color: theme.colors.textPrimary }]}>
              Вы заказали {summary.data?.orders_count} раз на{' '}
              {formatPrice(summary.data?.spent_kopecks ?? 0)}
            </Text>
            {summary.data?.favourite_restaurant ? (
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                Чаще всего из ресторана «{summary.data.favourite_restaurant}»
              </Text>
            ) : null}
          </Animated.View>
        ) : null}

        {authorized ? (
          <Animated.View
            entering={FadeInDown.duration(340).delay(220)}
            style={{ gap: theme.spacing.md }}
          >
            {title('Оформление')}
            <AppearanceSwitch />
          </Animated.View>
        ) : null}

        <Animated.View entering={FadeInDown.duration(340).delay(240)} style={{ gap: theme.spacing.md }}>
          {title('Связаться с нами')}
          {group(contacts)}
        </Animated.View>

        {authorized ? (
          <Animated.View
            entering={FadeInDown.duration(340).delay(280)}
            style={{ gap: theme.spacing.md }}
          >
            {title('Уведомления')}
            <PushSwitch />
            <MarketingSwitch />
          </Animated.View>
        ) : null}

        <Animated.View entering={FadeInDown.duration(340).delay(300)} style={{ gap: theme.spacing.md }}>
          {title('Документы')}
          {group(legal)}
        </Animated.View>

        {authorized ? (
          <View style={{ gap: theme.spacing.sm }}>
            <PressableScale
              depth={0.985}
              accessibilityLabel="Выйти из профиля"
              onPress={() => setAsking('exit')}
              style={[
                styles.exit,
                {
                  minHeight: theme.layout.minTouchTarget + theme.spacing.sm,
                  borderRadius: theme.radius.pill,
                  gap: theme.spacing.sm,
                  backgroundColor: theme.colors.surface,
                },
              ]}
            >
              <Ionicons name="log-out-outline" size={18} color={theme.colors.textSecondary} />
              <Text style={[theme.typography.button, { color: theme.colors.textSecondary }]}>
                Выйти
              </Text>
            </PressableScale>

            {/* Удаление аккаунта обязано быть в самом приложении: без него
                Apple не пропускает приложения со входом */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Удалить аккаунт"
              hitSlop={theme.hitSlop}
              onPress={() => setAsking('delete')}
              style={{ minHeight: theme.layout.minTouchTarget, justifyContent: 'center' }}
            >
              <Text
                style={[
                  theme.typography.caption,
                  styles.center,
                  { color: theme.colors.textTertiary },
                ]}
              >
                Удалить аккаунт
              </Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={[theme.typography.caption, styles.center, { color: theme.colors.textTertiary }]}>
          {tenant.branding.displayName} · версия {Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
      </Animated.ScrollView>

      <ConfirmSheet
        visible={asking === 'exit'}
        icon="log-out-outline"
        title="Выйти из профиля?"
        description="Ничего не пропадёт: баллы, адреса и история заказов останутся на вашем номере."
        points={[
          { icon: 'sparkles-outline', text: 'Баллы и уровень сохранятся' },
          { icon: 'call-outline', text: 'Вернётесь входом по номеру телефона' },
          { icon: 'bag-handle-outline', text: 'Корзина на этом устройстве очистится' },
        ]}
        confirmLabel="Выйти"
        cancelLabel="Остаться"
        onConfirm={() => {
          setAsking(null);
          void session.signOut();
        }}
        onCancel={() => setAsking(null)}
      />

      <ConfirmSheet
        visible={asking === 'delete'}
        icon="trash-outline"
        title="Удалить аккаунт?"
        description="Это навсегда. Восстановить данные после удаления мы не сможем."
        danger
        hold
        loading={remove.isPending}
        points={[
          {
            icon: 'sparkles-outline',
            text: `Сгорят все баллы${
              session.loyalty ? ` — сейчас их ${session.loyalty.points_balance}` : ''
            }`,
          },
          { icon: 'location-outline', text: 'Удалятся адреса доставки и брони столов' },
          { icon: 'person-outline', text: 'Сотрутся имя, телефон и дата рождения' },
        ]}
        confirmLabel="Удерживайте, чтобы удалить"
        cancelLabel="Оставить аккаунт"
        onConfirm={() => remove.mutate()}
        onCancel={() => setAsking(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  compact: { position: 'absolute', left: 0, right: 0, zIndex: 5, flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { justifyContent: 'space-between' },
  grow: { flex: 1 },
  // Плитки тянутся до высоты самой высокой: подсказки в них разной длины
  tiles: { flexDirection: 'row', alignItems: 'stretch' },
  tile: { flex: 1 },
  icon: { alignItems: 'center', justifyContent: 'center' },
  exit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
});
