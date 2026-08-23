import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  FadeIn,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import type { Dish, OrderCreate } from '@/api/client';
import { PressableScale } from '@/components/pressable-scale';
import { formatPrice } from '@/lib/format';
import { itemPrice, type CartItem } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

export type PaymentMethod = OrderCreate['payment_method'];

export const PAYMENTS: {
  value: PaymentMethod;
  label: string;
  note: string;
  icon: keyof typeof Ionicons.glyphMap;
  online: boolean;
}[] = [
  {
    value: 'online_sbp',
    label: 'СБП',
    note: 'Из банковского приложения',
    icon: 'qr-code',
    online: true,
  },
  {
    value: 'online_card',
    label: 'Картой онлайн',
    note: 'Мир, Visa, Mastercard',
    icon: 'card',
    online: true,
  },
  { value: 'cash_on_delivery', label: 'Наличными', note: 'При получении', icon: 'cash', online: false },
  {
    value: 'card_on_delivery',
    label: 'Картой при получении',
    note: 'Курьеру или на кассе',
    icon: 'card-outline',
    online: false,
  },
];

/** Круглая кнопка счётчика: 36 pt — в неё попадают, не целясь. */
function StepButton({
  icon,
  tone,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const scale = useSharedValue(1);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={animated}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={theme.spacing.sm}
        onPressIn={() => {
          scale.value = withSpring(0.86, { damping: 18, stiffness: 400 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 12, stiffness: 260 });
        }}
        onPress={onPress}
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surface,
        }}
      >
        <Ionicons name={icon} size={18} color={tone} />
      </Pressable>
    </Animated.View>
  );
}

/** Красная кнопка под строкой: появляется при смахивании влево. */
function RemoveAction({
  progress,
  onRemove,
}: {
  progress: SharedValue<number>;
  onRemove: () => void;
}) {
  const theme = useTheme();

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: 88 * (1 - Math.min(progress.value, 1)) }],
  }));

  return (
    <Animated.View style={[style, { width: 88 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Убрать из корзины"
        onPress={onRemove}
        style={({ pressed }) => [
          styles.fill,
          { gap: 4, backgroundColor: theme.colors.danger, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Ionicons name="trash" size={22} color={theme.colors.onDanger} />
        <Text style={[theme.typography.caption, { color: theme.colors.onDanger }]}>Убрать</Text>
      </Pressable>
    </Animated.View>
  );
}

/** Строка корзины: фотография, цена за штуку и крупный счётчик. */
export function CartLine({
  item,
  photo,
  note,
  unavailable,
  onChange,
  onOpen,
}: {
  item: CartItem;
  photo: string | null;
  /** Вес или объём порции: «420 г», «0,33 л». */
  note: string | null;
  /** Причина, по которой блюдо сейчас нельзя заказать. */
  unavailable: string | null;
  onChange: (quantity: number) => void;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const swipe = useRef<SwipeableMethods>(null);
  const last = item.quantity === 1;

  const remove = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    swipe.current?.close();
    onChange(0);
  };

  const body = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Открыть ${item.name}`}
      onPress={onOpen}
      style={
      {
        ...styles.line,
        gap: theme.spacing.md,
        padding: theme.spacing.sm,
        backgroundColor: theme.colors.surface,
      }}
    >
      <View
        style={{
          width: 68,
          height: 68,
          borderRadius: theme.radius.md,
          overflow: 'hidden',
          backgroundColor: theme.colors.surfaceSunken,
        }}
      >
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={[StyleSheet.absoluteFill, unavailable !== null ? { opacity: 0.4 } : null]}
            contentFit="cover"
          />
        ) : (
          <View style={styles.fill}>
            <Ionicons name="restaurant-outline" size={22} color={theme.colors.textTertiary} />
          </View>
        )}
      </View>

      <View style={[styles.grow, { gap: theme.spacing.xxs }]}>
        <Text
          numberOfLines={2}
          style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}
        >
          {item.name}
        </Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
          {formatPrice(itemPrice(item))} за штуку{note ? ` · ${note}` : ''}
        </Text>

        {(item.extras ?? []).length > 0 ? (
          <Text
            numberOfLines={2}
            style={[theme.typography.caption, { color: theme.colors.brand }]}
          >
            + {(item.extras ?? []).map((extra) => extra.name).join(', ')}
          </Text>
        ) : null}

        {unavailable !== null ? (
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>
            {unavailable}
          </Text>
        ) : (
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.brand }]}>
            {formatPrice(itemPrice(item) * item.quantity)}
          </Text>
        )}
      </View>

      {/* У недоступной позиции остаётся одно действие — убрать */}
      {unavailable !== null ? (
        <StepButton
          icon="trash-outline"
          tone={theme.colors.danger}
          label="Убрать из корзины"
          onPress={() => onChange(0)}
        />
      ) : (
        <View
          style={[
            styles.stepper,
            {
              gap: theme.spacing.xs,
              padding: theme.spacing.xxs,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.surfaceSunken,
            },
          ]}
        >
          {/* На единице минус превращается в корзину: понятно, что дальше удаление */}
        <StepButton
          icon={last ? 'trash-outline' : 'remove'}
          tone={last ? theme.colors.danger : theme.colors.textSecondary}
          label={last ? 'Убрать из корзины' : 'Меньше'}
          onPress={() => onChange(item.quantity - 1)}
        />

        <Text
          style={[
            theme.typography.bodyMedium,
            { color: theme.colors.textPrimary, minWidth: 18, textAlign: 'center' },
          ]}
        >
          {item.quantity}
        </Text>

          <StepButton
            icon="add"
            tone={theme.colors.brand}
            label="Больше"
            onPress={() => onChange(item.quantity + 1)}
          />
        </View>
      )}
    </Pressable>
  );

  // Смахнуть влево быстрее, чем жать минус до нуля
  return (
    <ReanimatedSwipeable
      ref={swipe}
      friction={1.6}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={(progress) => (
        <RemoveAction progress={progress} onRemove={remove} />
      )}
    >
      {body}
    </ReanimatedSwipeable>
  );
}

/** Полоса «сколько осталось до бесплатной доставки». */
export function FreeDeliveryBar({
  subtotal,
  freeFrom,
  left,
}: {
  subtotal: number;
  freeFrom: number;
  left: number;
}) {
  const theme = useTheme();
  const share = freeFrom > 0 ? Math.min(1, subtotal / freeFrom) : 1;

  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withTiming(share, { duration: 520 });
  }, [fill, share]);

  const bar = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  const reached = left <= 0;

  return (
    <View
      style={{
        gap: theme.spacing.sm,
        padding: theme.spacing.base,
        borderRadius: theme.radius.lg,
        backgroundColor: reached ? theme.colors.successSubtle : theme.colors.surface,
      }}
    >
      <View style={[styles.line, { gap: theme.spacing.sm }]}>
        <Ionicons
          name={reached ? 'gift' : 'car'}
          size={16}
          color={reached ? theme.colors.success : theme.colors.brand}
        />
        <Text
          style={[
            theme.typography.caption,
            styles.grow,
            { color: reached ? theme.colors.success : theme.colors.textSecondary },
          ]}
        >
          {reached
            ? 'Доставка бесплатно — порог пройден'
            : `До бесплатной доставки ещё ${formatPrice(left)}`}
        </Text>
      </View>

      <View style={[styles.track, { backgroundColor: theme.colors.border }]}>
        <Animated.View
          style={[
            styles.fill2,
            bar,
            { backgroundColor: reached ? theme.colors.success : theme.colors.brand },
          ]}
        />
      </View>
    </View>
  );
}

/** Когда привезти: как можно скорее или ко времени. */
export function TimePicker({
  slots,
  value,
  onChange,
}: {
  slots: { iso: string | null; label: string }[];
  value: string | null;
  onChange: (iso: string | null) => void;
}) {
  const theme = useTheme();

  // Лента вбок вместо переноса: дюжина слотов занимала пол-экрана
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: theme.spacing.sm, paddingRight: theme.spacing.base }}
    >
      {slots.map((slot) => {
        const picked = slot.iso === value;

        return (
          <PressableScale
            key={slot.label}
            depth={0.95}
            accessibilityLabel={slot.label}
            onPress={() => onChange(slot.iso)}
            style={[
              styles.line,
              {
                gap: theme.spacing.xxs,
                paddingHorizontal: theme.spacing.base,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.radius.pill,
                borderWidth: picked ? 1.5 : StyleSheet.hairlineWidth,
                borderColor: picked ? theme.colors.brand : theme.colors.border,
                backgroundColor: picked ? theme.colors.brandSubtle : theme.colors.surface,
              },
            ]}
          >
            {slot.iso === null ? (
              <Ionicons
                name="flash"
                size={13}
                color={picked ? theme.colors.brand : theme.colors.textTertiary}
              />
            ) : null}
            <Text
              style={[
                theme.typography.bodyMedium,
                { color: picked ? theme.colors.brand : theme.colors.textSecondary },
              ]}
            >
              {slot.label}
            </Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

/** Счётчик приборов. */
export function PersonsRow({
  value,
  priceKopecks,
  onChange,
}: {
  value: number;
  priceKopecks: number;
  onChange: (value: number) => void;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.line,
        {
          gap: theme.spacing.md,
          padding: theme.spacing.base,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.surface,
        },
      ]}
    >
      <Ionicons name="restaurant-outline" size={18} color={theme.colors.textSecondary} />

      <View style={styles.grow}>
        <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
          Приборы
        </Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
          {value === 0
            ? 'Не нужны — бережём природу'
            : `${value} × ${formatPrice(priceKopecks)} = ${formatPrice(value * priceKopecks)}`}
        </Text>
      </View>

      <View
        style={[
          styles.stepper,
          {
            gap: theme.spacing.xs,
            padding: theme.spacing.xxs,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.surfaceSunken,
          },
        ]}
      >
        <StepButton
          icon="remove"
          tone={theme.colors.textSecondary}
          label="Меньше приборов"
          onPress={() => onChange(Math.max(0, value - 1))}
        />
        <Text
          style={[
            theme.typography.bodyMedium,
            { color: theme.colors.textPrimary, minWidth: 18, textAlign: 'center' },
          ]}
        >
          {value}
        </Text>
        <StepButton
          icon="add"
          tone={theme.colors.brand}
          label="Больше приборов"
          onPress={() => onChange(Math.min(20, value + 1))}
        />
      </View>
    </View>
  );
}

/** Выбор способа оплаты и сдача для наличных. */
export function PaymentPicker({
  value,
  onChange,
  allowOnline,
  changeFrom,
  onChangeFrom,
}: {
  value: PaymentMethod;
  onChange: (value: PaymentMethod) => void;
  allowOnline: boolean;
  changeFrom: string;
  onChangeFrom: (value: string) => void;
}) {
  const theme = useTheme();
  const options = PAYMENTS.filter((item) => allowOnline || !item.online);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {options.map((option) => {
        const picked = option.value === value;

        return (
          <View key={option.value} style={{ gap: theme.spacing.sm }}>
            <PressableScale
              depth={0.985}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
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
                name={option.icon}
                size={20}
                color={picked ? theme.colors.brand : theme.colors.textSecondary}
              />

              <View style={styles.grow}>
                <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                  {option.label}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                  {option.note}
                </Text>
              </View>

              <Ionicons
                name={picked ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={picked ? theme.colors.brand : theme.colors.border}
              />
            </PressableScale>

            {/* Сдача нужна только наличным — и только когда их выбрали */}
            {picked && option.value === 'cash_on_delivery' ? (
              <Animated.View entering={FadeIn.duration(180)}>
                <TextInput
                  value={changeFrom}
                  onChangeText={(text) => onChangeFrom(text.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  placeholder="Сдача с какой суммы, ₽"
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
              </Animated.View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Поле промокода: результат и ошибку показываем прямо здесь. */
export function PromoField({
  value,
  onApply,
  applied,
  error,
  onClear,
}: {
  value: string;
  onApply: (code: string) => void;
  applied: string | null;
  error: string | null;
  onClear: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState(value);

  if (applied !== null) {
    return (
      <View
        style={[
          styles.line,
          {
            gap: theme.spacing.md,
            padding: theme.spacing.base,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.successSubtle,
          },
        ]}
      >
        <Ionicons name="pricetag" size={18} color={theme.colors.success} />
        <Text style={[theme.typography.bodyMedium, styles.grow, { color: theme.colors.success }]}>
          Промокод {applied} применён
        </Text>
        <Pressable accessibilityRole="button" hitSlop={theme.hitSlop} onPress={onClear}>
          <Ionicons name="close-circle" size={20} color={theme.colors.success} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <View style={[styles.line, { gap: theme.spacing.sm }]}>
        <TextInput
          value={draft}
          onChangeText={(text) => setDraft(text.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="Промокод"
          placeholderTextColor={theme.colors.textTertiary}
          style={[
            theme.typography.body,
            styles.grow,
            {
              color: theme.colors.textPrimary,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: error ? theme.colors.danger : theme.colors.border,
              paddingHorizontal: theme.spacing.base,
              minHeight: theme.layout.minTouchTarget,
            },
          ]}
        />

        <PressableScale
          depth={0.95}
          accessibilityLabel="Применить промокод"
          onPress={() => onApply(draft)}
          style={{
            paddingHorizontal: theme.spacing.lg,
            minHeight: theme.layout.minTouchTarget,
            borderRadius: theme.radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: draft.length > 2 ? theme.colors.brand : theme.colors.border,
          }}
        >
          <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
            Применить
          </Text>
        </PressableScale>
      </View>

      {error ? (
        <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>{error}</Text>
      ) : null}
    </View>
  );
}

/** Карточка баллов: сумма к списанию крупно, переключатель с бегунком. */
export function PointsCard({
  balance,
  maxToSpend,
  spending,
  earned,
  onToggle,
}: {
  balance: number;
  maxToSpend: number;
  spending: boolean;
  earned: number;
  onToggle: (value: boolean) => void;
}) {
  const theme = useTheme();
  const on = useSharedValue(spending ? 1 : 0);
  const disabled = maxToSpend <= 0;

  useEffect(() => {
    on.value = withSpring(spending ? 1 : 0, { damping: 17, stiffness: 220 });
  }, [on, spending]);

  const card = useAnimatedStyle(() => ({
    borderColor: spending ? theme.colors.accent : theme.colors.border,
    borderWidth: 1 + on.value * 0.6,
  }));

  const track = useAnimatedStyle(() => ({
    backgroundColor: spending ? theme.colors.accent : theme.colors.border,
  }));

  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: on.value * 22 }] }));

  return (
    <Animated.View
      style={[
        card,
        {
          gap: theme.spacing.sm,
          padding: theme.spacing.base,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.surface,
          opacity: disabled ? 0.6 : 1,
        },
      ]}
    >
      <View style={[styles.line, { gap: theme.spacing.md }]}>
        <View
          style={[
            styles.badge,
            {
              width: 40,
              height: 40,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.accentSubtle,
            },
          ]}
        >
          <Ionicons name="sparkles" size={19} color={theme.colors.accent} />
        </View>

        <View style={styles.grow}>
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
            {disabled ? 'Баллы копятся' : `Списать ${maxToSpend} ₽ баллами`}
          </Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            На счёте {balance}
            {earned > 0 ? ` · вернём ${earned}` : ''}
          </Text>
        </View>

        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: spending, disabled }}
          accessibilityLabel="Списать баллы"
          disabled={disabled}
          hitSlop={theme.hitSlop}
          onPress={() => onToggle(!spending)}
        >
          <Animated.View
            style={[
              track,
              { width: 52, height: 30, borderRadius: 15, padding: 3, justifyContent: 'center' },
            ]}
          >
            <Animated.View
              style={[
                knob,
                {
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: theme.colors.surface,
                },
              ]}
            />
          </Animated.View>
        </Pressable>
      </View>
    </Animated.View>
  );
}

/**
 * Полка допродажи: лента вбок с фотографиями, как «с этим берут» в карточке
 * блюда. Столбиком она растягивала бы корзину на лишний экран.
 */
export function UpsellShelf({
  dishes,
  photo,
  onAdd,
}: {
  dishes: Dish[];
  photo: (dish: Dish) => string | null;
  /** Второй аргумент — откуда на экране начинать полёт миниатюры. */
  onAdd: (dish: Dish, from: { x: number; y: number; size: number } | null) => void;
}) {
  const theme = useTheme();
  const cards = useRef(new Map<string, View>()).current;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: theme.spacing.sm, paddingRight: theme.spacing.base }}
    >
      {dishes.map((dish) => {
        const uri = photo(dish);

        return (
          <PressableScale
            key={dish.id}
            depth={0.96}
            accessibilityLabel={`Добавить ${dish.name}`}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

              const card = cards.get(dish.id);
              if (card === undefined || uri === null) {
                onAdd(dish, null);
                return;
              }

              card.measureInWindow((x, y, width) =>
                onAdd(dish, { x, y, size: Math.min(width, 92) }),
              );
            }}
            style={{
              width: 132,
              borderRadius: theme.radius.lg,
              overflow: 'hidden',
              backgroundColor: theme.colors.surface,
              ...theme.elevation.card,
            }}
          >
            <View
              ref={(node) => {
                if (node) cards.set(dish.id, node);
                else cards.delete(dish.id);
              }}
              style={{ height: 92, backgroundColor: theme.colors.surfaceSunken }}
            >
              {uri ? (
                <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <View style={styles.fill}>
                  <Ionicons name="fast-food-outline" size={22} color={theme.colors.textTertiary} />
                </View>
              )}

              <View
                style={{
                  position: 'absolute',
                  right: theme.spacing.xs,
                  bottom: theme.spacing.xs,
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.colors.brand,
                }}
              >
                <Ionicons name="add" size={17} color={theme.colors.textOnBrand} />
              </View>
            </View>

            <View style={{ padding: theme.spacing.sm, gap: 2 }}>
              <Text
                numberOfLines={2}
                style={[theme.typography.caption, { color: theme.colors.textPrimary }]}
              >
                {dish.name}
              </Text>
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.brand }]}>
                {formatPrice(dish.price_kopecks)}
              </Text>
            </View>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

/** Комментарий: свёрнут в строку, разворачивается по нажатию. */
export function CommentField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(value.length > 0);

  if (!open) {
    return (
      <PressableScale
        depth={0.98}
        accessibilityLabel="Добавить комментарий"
        onPress={() => setOpen(true)}
        style={[
          styles.line,
          {
            gap: theme.spacing.md,
            padding: theme.spacing.base,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surface,
          },
        ]}
      >
        <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.colors.brand} />
        <Text style={[theme.typography.bodyMedium, styles.grow, { color: theme.colors.textPrimary }]}>
          Комментарий к заказу
        </Text>
        <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
      </PressableScale>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(160)} style={{ gap: theme.spacing.xs }}>
      <View style={[styles.line, { gap: theme.spacing.sm }]}>
        <Ionicons name="chatbubble-ellipses" size={16} color={theme.colors.brand} />
        <Text style={[theme.typography.bodyMedium, styles.grow, { color: theme.colors.textPrimary }]}>
          Комментарий к заказу
        </Text>
        {value.length === 0 ? (
          <Pressable accessibilityRole="button" hitSlop={theme.hitSlop} onPress={() => setOpen(false)}>
            <Ionicons name="close" size={18} color={theme.colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      <TextInput
        value={value}
        onChangeText={onChange}
        autoFocus
        multiline
        placeholder="Что учесть курьеру и кухне"
        placeholderTextColor={theme.colors.textTertiary}
        style={[
          theme.typography.body,
          {
            color: theme.colors.textPrimary,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            padding: theme.spacing.base,
            minHeight: theme.layout.minTouchTarget + theme.spacing.lg,
            textAlignVertical: 'top',
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  grow: { flex: 1 },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { alignItems: 'center', justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill2: { height: 6, borderRadius: 3 },
});
