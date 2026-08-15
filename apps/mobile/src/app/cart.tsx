import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type ApiError, type OrderCreate } from '@/api/client';
import { EmptyState } from '@/components/empty-state';
import { ScreenHeader } from '@/components/screen-header';
import { Segmented } from '@/components/segmented';
import { formatPoints, formatPrice } from '@/lib/format';
import { tenant } from '@/lib/tenant';
import { cartSubtotal, useCart } from '@/store/cart';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

type OrderType = OrderCreate['type'];
type PaymentMethod = OrderCreate['payment_method'];

export default function CartScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const session = useSession();
  const queryClient = useQueryClient();

  // Способы оплаты берём из фич тенанта: онлайн-оплата включается флагом,
  // а не правкой экрана
  const paymentOptions: { value: PaymentMethod; label: string }[] = [
    ...(tenant.features.onlinePayment
      ? ([
          { value: 'online_sbp', label: 'СБП' },
          { value: 'online_card', label: 'Картой онлайн' },
        ] as const)
      : []),
    { value: 'cash_on_delivery', label: 'Наличными' },
    { value: 'card_on_delivery', label: 'Картой на месте' },
  ];

  const [orderType, setOrderType] = useState<OrderType>('delivery');
  const [payment, setPayment] = useState<PaymentMethod>(paymentOptions[0].value);
  const [address, setAddress] = useState('');
  const [comment, setComment] = useState('');
  const [usePoints, setUsePoints] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const subtotal = cartSubtotal(cart.items);
  const authorized = session.status === 'authorized';

  const limits = useQuery({
    queryKey: ['checkout-limits', subtotal],
    queryFn: () => api.checkoutLimits(subtotal),
    enabled: authorized && subtotal > 0,
  });

  const pointsToSpend = usePoints ? (limits.data?.max_points_to_spend ?? 0) : 0;

  const createOrder = useMutation({
    mutationFn: () =>
      api.createOrder({
        restaurant_id: cart.restaurantId ?? '',
        type: orderType,
        payment_method: payment,
        address_text: orderType === 'delivery' ? address : null,
        comment: comment.length > 0 ? comment : null,
        points_to_spend: pointsToSpend,
        items: cart.items.map((item) => ({ dish_id: item.dishId, quantity: item.quantity })),
      }),
    onSuccess: (order) => {
      cart.clear();
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void session.restore();
      router.replace(`/order/${order.id}`);
    },
    onError: (error: ApiError) => setFailure(error.message),
  });

  if (cart.items.length === 0) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <ScreenHeader title="Корзина" />
        <EmptyState
          icon="cart-outline"
          title="Корзина пуста"
          description="Загляните в меню — там есть что выбрать."
          actionLabel="В меню"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  const summaryRow = (label: string, value: string, accent?: boolean) => (
    <View style={styles.summaryRow} key={label}>
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
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title="Корзина" />

      <ScrollView
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing.huge + insets.bottom,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: theme.spacing.md }}>
          {cart.items.map((item) => (
            <View key={item.dishId} style={[styles.line, { gap: theme.spacing.md }]}>
              <View style={styles.lineText}>
                <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                  {item.name}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  {formatPrice(item.priceKopecks)} × {item.quantity}
                </Text>
              </View>

              <View style={[styles.stepper, { gap: theme.spacing.sm }]}>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={theme.hitSlop}
                  onPress={() => cart.setQuantity(item.dishId, item.quantity - 1)}
                >
                  <Ionicons
                    name="remove-circle-outline"
                    size={theme.spacing.xl}
                    color={theme.colors.textTertiary}
                  />
                </Pressable>
                <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                  {item.quantity}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={theme.hitSlop}
                  onPress={() => cart.setQuantity(item.dishId, item.quantity + 1)}
                >
                  <Ionicons
                    name="add-circle-outline"
                    size={theme.spacing.xl}
                    color={theme.colors.brand}
                  />
                </Pressable>
              </View>
            </View>
          ))}
        </View>

        <View style={{ gap: theme.spacing.md }}>
          <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
            Как получить
          </Text>
          <Segmented
            value={orderType}
            onChange={setOrderType}
            options={[
              { value: 'delivery', label: 'Доставка' },
              { value: 'pickup', label: 'Самовывоз' },
            ]}
          />

          {orderType === 'delivery' ? (
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder="Улица, дом, квартира"
              placeholderTextColor={theme.colors.textTertiary}
              style={[
                theme.typography.body,
                {
                  color: theme.colors.textPrimary,
                  backgroundColor: theme.colors.surfaceSunken,
                  borderRadius: theme.radius.md,
                  paddingHorizontal: theme.spacing.base,
                  minHeight: theme.layout.minTouchTarget,
                },
              ]}
            />
          ) : null}

          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Комментарий к заказу"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              theme.typography.body,
              {
                color: theme.colors.textPrimary,
                backgroundColor: theme.colors.surfaceSunken,
                borderRadius: theme.radius.md,
                paddingHorizontal: theme.spacing.base,
                minHeight: theme.layout.minTouchTarget,
              },
            ]}
          />
        </View>

        <View style={{ gap: theme.spacing.md }}>
          <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
            Оплата
          </Text>
          <Segmented value={payment} onChange={setPayment} options={paymentOptions} />
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            Оплата при получении: наличными или картой курьеру и на кассе.
          </Text>
        </View>

        {authorized && (limits.data?.max_points_to_spend ?? 0) > 0 ? (
          <View style={[styles.line, { gap: theme.spacing.md }]}>
            <View style={styles.lineText}>
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                Списать {formatPoints(limits.data?.max_points_to_spend ?? 0)}
              </Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                На счёте {formatPoints(limits.data?.points_balance ?? 0)}
              </Text>
            </View>
            <Switch
              value={usePoints}
              onValueChange={setUsePoints}
              trackColor={{ true: theme.colors.brand, false: theme.colors.border }}
            />
          </View>
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          {summaryRow('Блюда', formatPrice(subtotal))}
          {pointsToSpend > 0
            ? summaryRow('Баллы', `−${formatPrice(pointsToSpend * 100)}`, true)
            : null}
          <View style={styles.summaryRow}>
            <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>Итого</Text>
            <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
              {formatPrice(subtotal - pointsToSpend * 100)}
            </Text>
          </View>
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            Стоимость доставки посчитаем при оформлении — она зависит от суммы заказа.
          </Text>
        </View>

        {failure ? (
          <Text style={[theme.typography.body, { color: theme.colors.danger }]}>{failure}</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={createOrder.isPending}
          onPress={() => {
            setFailure(null);
            if (!authorized) {
              router.push('/auth');
              return;
            }
            createOrder.mutate();
          }}
          style={({ pressed }) => [
            styles.submit,
            {
              minHeight: theme.layout.minTouchTarget + theme.spacing.xs,
              borderRadius: theme.radius.pill,
              backgroundColor: pressed ? theme.colors.brandPressed : theme.colors.brand,
              opacity: createOrder.isPending ? 0.6 : 1,
            },
          ]}
        >
          <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
            {!authorized
              ? 'Войти и оформить'
              : createOrder.isPending
                ? 'Оформляем…'
                : 'Оформить заказ'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lineText: { flex: 1 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  submit: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
