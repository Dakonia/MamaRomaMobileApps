import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Address, type ApiError } from '@/api/client';
import { EmptyState } from '@/components/empty-state';
import { PizzaBackdrop } from '@/components/pizza-backdrop';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/components/screen-header';
import { Skeleton } from '@/components/skeleton';
import { useCart } from '@/store/cart';
import { mapsAvailable } from '@/lib/tenant';
import { useTheme } from '@/theme/theme-provider';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Дом: 'home',
  Работа: 'briefcase',
};

const ACTION_WIDTH = 168;

/**
 * Кнопки под карточкой: выезжают вместе с пальцем. Отдельный компонент, а не
 * функция внутри карточки — иначе хуки анимации живут в чужом рендере.
 */
function SwipeActions({
  progress,
  onEdit,
  onRemove,
}: {
  progress: SharedValue<number>;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: ACTION_WIDTH * (1 - Math.min(progress.value, 1)) }],
  }));

  const button = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    background: string,
    color: string,
    onPress: () => void,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: background, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[theme.typography.caption, { color }]}>{label}</Text>
    </Pressable>
  );

  return (
    <Animated.View
      style={[
        styles.actions,
        style,
        { width: ACTION_WIDTH, borderRadius: theme.radius.xl, overflow: 'hidden' },
      ]}
    >
      {button(
        'create-outline',
        'Изменить',
        theme.colors.surfaceSunken,
        theme.colors.textPrimary,
        onEdit,
      )}
      {button('trash-outline', 'Удалить', theme.colors.dangerSubtle, theme.colors.danger, onRemove)}
    </Animated.View>
  );
}

type CardProps = {
  address: Address;
  onEdit: () => void;
  onRemove: () => void;
  onMakeDefault: () => void;
};

function AddressCard({ address, onEdit, onRemove, onMakeDefault }: CardProps) {
  const theme = useTheme();
  const swipe = useRef<SwipeableMethods>(null);

  const close = () => swipe.current?.close();

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={LinearTransition}
      style={styles.clip}
    >
      <ReanimatedSwipeable
        ref={swipe}
        friction={1.6}
        rightThreshold={40}
        overshootRight={false}
        renderRightActions={(progress) => (
          <SwipeActions
            progress={progress}
            onEdit={() => {
              close();
              onEdit();
            }}
            onRemove={() => {
              close();
              onRemove();
            }}
          />
        )}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Адрес ${address.full_text}`}
          onPress={address.is_default ? onEdit : onMakeDefault}
          style={[
            styles.card,
            address.is_default ? theme.elevation.card : null,
            {
              gap: theme.spacing.base,
              padding: theme.spacing.base,
              // Свои скругления: иначе прямые углы упираются в скруглённый
              // контейнер свайпа и рамка выглядит обрезанной
              borderRadius: theme.radius.xl,
              backgroundColor: address.is_default
                ? theme.colors.brandSubtle
                : theme.colors.surfaceSunken,
              borderWidth: address.is_default ? 2 : 1,
              borderColor: address.is_default ? theme.colors.brand : theme.colors.border,
            },
          ]}
        >
          <View
            style={[
              styles.badge,
              {
                width: theme.spacing.xxxl,
                height: theme.spacing.xxxl,
                borderRadius: theme.radius.pill,
                backgroundColor: address.is_default
                  ? theme.colors.brand
                  : theme.colors.brandSubtle,
              },
            ]}
          >
            <Ionicons
              name={ICONS[address.title ?? ''] ?? 'location'}
              size={18}
              color={address.is_default ? theme.colors.textOnBrand : theme.colors.brand}
            />
          </View>

          <View style={styles.grow}>
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                {address.title ?? 'Адрес'}
              </Text>
              {address.is_default ? (
                <View
                  style={{
                    paddingHorizontal: theme.spacing.sm,
                    paddingVertical: theme.spacing.xxs,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.colors.brandSubtle,
                  }}
                >
                  <Text style={[theme.typography.overline, { color: theme.colors.brand }]}>
                    основной
                  </Text>
                </View>
              ) : null}
            </View>

            <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
              {address.full_text}
            </Text>

            {address.restaurant_name ? (
              <View
                style={[
                  styles.row,
                  {
                    alignSelf: 'flex-start',
                    gap: theme.spacing.xs,
                    marginTop: theme.spacing.xs,
                    paddingHorizontal: theme.spacing.sm,
                    paddingVertical: theme.spacing.xxs,
                    borderRadius: theme.radius.pill,
                    backgroundColor: address.delivery_covered
                      ? theme.colors.accentSubtle
                      : theme.colors.warningSubtle,
                  },
                ]}
              >
                <Ionicons
                  name="car"
                  size={13}
                  color={address.delivery_covered ? theme.colors.accent : theme.colors.warning}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    theme.typography.caption,
                    {
                      color: address.delivery_covered ? theme.colors.accent : theme.colors.warning,
                    },
                  ]}
                >
                  {address.delivery_covered
                    ? address.restaurant_name
                    : `${address.restaurant_name} — не возит`}
                </Text>
              </View>
            ) : (
              <Text
                style={[
                  theme.typography.caption,
                  { marginTop: theme.spacing.xxs, color: theme.colors.textTertiary },
                ]}
              >
                Ресторан определится, когда уточните дом на карте
              </Text>
            )}
          </View>

          <Ionicons name="chevron-back" size={16} color={theme.colors.textTertiary} />
        </Pressable>
      </ReanimatedSwipeable>
    </Animated.View>
  );
}

export default function AddressesScreen() {
  const theme = useTheme();
  const cart = useCart();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const addresses = useQuery({ queryKey: ['addresses'], queryFn: () => api.addresses() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['addresses'] });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAddress(id),
    onSuccess: refresh,
    onError: (error: ApiError) => setFailure(error.message),
  });

  const makeDefault = useMutation({
    mutationFn: (id: string) => api.updateAddress(id, { is_default: true }),
    onSuccess: (saved) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Меню и корзина смотрят на выбранный адрес, а не на признак «основной»:
      // без этого после смены основного оставался прошлый ресторан
      cart.selectAddress(saved.id);
      cart.selectRestaurant(saved.delivery_covered ? (saved.restaurant_id ?? null) : null);

      return refresh();
    },
    onError: (error: ApiError) => setFailure(error.message),
  });

  const confirmRemove = (address: Address) => {
    Alert.alert('Удалить адрес?', address.full_text, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => remove.mutate(address.id) },
    ]);
  };

  const rows = addresses.data ?? [];

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <PizzaBackdrop strength={0.7} />

      <ScreenHeader title="Адреса доставки" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          paddingBottom: insets.bottom + theme.spacing.xxxl,
          gap: theme.spacing.md,
          flexGrow: 1,
        }}
      >
        {addresses.isPending ? (
          [0, 1].map((key) => <Skeleton key={key} height={92} radius={theme.radius.xl} />)
        ) : rows.length === 0 ? (
          <EmptyState
            backdrop={false}
            icon="home-outline"
            title="Пока нет адресов"
            description="Отметьте дом на карте — дальше он подставится в заказ сам."
            actionLabel="Указать на карте"
            onAction={() =>
              router.push(
                mapsAvailable
                  ? { pathname: '/address-map', params: { next: 'form' } }
                  : '/address-form',
              )
            }
          />
        ) : (
          <>
            {rows.map((address) => (
              <AddressCard
                key={address.id}
                address={address}
                onEdit={() =>
                  router.push({ pathname: '/address-form', params: { id: address.id } })
                }
                onRemove={() => confirmRemove(address)}
                onMakeDefault={() => makeDefault.mutate(address.id)}
              />
            ))}
          </>
        )}

        {failure ? (
          <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>{failure}</Text>
        ) : null}

        {rows.length > 0 ? (
          <View style={{ marginTop: theme.spacing.sm }}>
            <PrimaryButton
              label="Добавить адрес"
              onPress={() =>
                router.push(
                  mapsAvailable
                    ? { pathname: '/address-map', params: { next: 'form' } }
                    : '/address-form',
                )
              }
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  clip: {},
  card: { flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row' },
  action: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  badge: { alignItems: 'center', justifyContent: 'center' },
});
