import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { mediaUrl, type Dish } from '@/api/client';
import { formatPrice } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';

type Props = {
  dish: Dish;
  quantity: number;
  onAdd: () => void;
  onChangeQuantity: (quantity: number) => void;
  onOpen: () => void;
};

export function DishRow({ dish, quantity, onAdd, onChangeQuantity, onOpen }: Props) {
  const theme = useTheme();
  const dimmed = !dish.is_available;

  const stepButton = (icon: 'remove' | 'add', onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={theme.hitSlop}
      style={({ pressed }) => [
        styles.step,
        {
          width: theme.layout.minTouchTarget - theme.spacing.sm,
          height: theme.layout.minTouchTarget - theme.spacing.sm,
          borderRadius: theme.radius.pill,
          backgroundColor: pressed ? theme.colors.brandPressed : theme.colors.brand,
        },
      ]}
    >
      <Ionicons name={icon} size={theme.spacing.base} color={theme.colors.textOnBrand} />
    </Pressable>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Открыть ${dish.name}`}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.root,
        {
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.layout.screenPadding,
          gap: theme.spacing.base,
          opacity: dimmed ? 0.5 : 1,
          backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
        },
      ]}
    >
      <View
        style={[
          styles.thumb,
          {
            width: theme.spacing.huge + theme.spacing.base,
            height: theme.spacing.huge + theme.spacing.base,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surfaceSunken,
          },
        ]}
      >
        {dish.image_url ? (
          <Image
            source={{ uri: mediaUrl(dish.image_url) ?? undefined }}
            style={styles.image}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <Ionicons
            name="restaurant-outline"
            size={theme.spacing.lg}
            color={theme.colors.textTertiary}
          />
        )}
      </View>

      <View style={styles.body}>
        <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
          {dish.name}
        </Text>

        {dish.description ? (
          <Text
            numberOfLines={2}
            style={[
              theme.typography.caption,
              { color: theme.colors.textSecondary, marginTop: theme.spacing.xxs },
            ]}
          >
            {dish.description}
          </Text>
        ) : null}

        <View style={[styles.footer, { gap: theme.spacing.sm, marginTop: theme.spacing.sm }]}>
          <Text style={[theme.typography.price, { color: theme.colors.textPrimary }]}>
            {formatPrice(dish.price_kopecks)}
          </Text>

          {dish.weight_grams ? (
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
              {dish.weight_grams} г
            </Text>
          ) : null}

          {dimmed ? (
            <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>
              Закончилось
            </Text>
          ) : null}
        </View>
      </View>

      {dimmed ? null : (
        <View style={[styles.controls, { gap: theme.spacing.sm }]}>
          {quantity > 0 ? (
            <>
              {stepButton('remove', () => onChangeQuantity(quantity - 1))}
              <Text
                style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}
                accessibilityLabel={`В корзине ${quantity}`}
              >
                {quantity}
              </Text>
            </>
          ) : null}
          {stepButton('add', quantity > 0 ? () => onChangeQuantity(quantity + 1) : onAdd)}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  thumb: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  body: { flex: 1 },
  footer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  step: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
