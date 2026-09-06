import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/text';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { formatPrice } from '@/lib/format';
import { itemPrice } from '@/store/cart';
import type { CartItem } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';
import { RemoveAction, StepButton, pieces } from '@/components/cart/shared';

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
        ...pieces.line,
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
          <View style={pieces.fill}>
            <Ionicons name="restaurant-outline" size={22} color={theme.colors.textTertiary} />
          </View>
        )}
      </View>

      <View style={[pieces.grow, { gap: theme.spacing.xxs }]}>
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
            pieces.stepper,
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
