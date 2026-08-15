import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { mediaUrl, type Dish } from '@/api/client';
import { PressableScale } from '@/components/pressable-scale';
import { formatPrice } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';

type Props = {
  dish: Dish;
  quantity: number;
  onOpen: () => void;
  onAdd: () => void;
  onChangeQuantity: (quantity: number) => void;
  /** Узкая карточка для горизонтальных полок. */
  width?: number;
};

export function DishCard({ dish, quantity, onOpen, onAdd, onChangeQuantity, width }: Props) {
  const theme = useTheme();
  const photo = mediaUrl(dish.image_url);
  const measure = dish.weight_grams
    ? `${dish.weight_grams} г`
    : dish.volume_ml
      ? `${dish.volume_ml} мл`
      : null;

  return (
    <PressableScale
      onPress={onOpen}
      accessibilityLabel={`Открыть ${dish.name}`}
      style={[
        styles.root,
        {
          width,
          flex: width === undefined ? 1 : undefined,
          borderRadius: theme.radius.xl,
          backgroundColor: theme.colors.surface,
          ...theme.elevation.card,
          opacity: dish.is_available ? 1 : 0.55,
        },
      ]}
    >
      <View style={[styles.photo, { backgroundColor: theme.colors.surfaceSunken }]}>
        {photo ? (
          <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" transition={220} />
        ) : (
          <View style={styles.center}>
            <Ionicons
              name="restaurant-outline"
              size={theme.spacing.xxl}
              color={theme.colors.textTertiary}
            />
          </View>
        )}

        {dish.is_available ? (
          quantity > 0 ? (
            <View
              style={[
                styles.stepper,
                {
                  right: theme.spacing.sm,
                  bottom: theme.spacing.sm,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.colors.brand,
                  paddingHorizontal: theme.spacing.xs,
                  ...theme.elevation.raised,
                },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Убрать одну порцию"
                hitSlop={theme.hitSlop}
                onPress={() => onChangeQuantity(quantity - 1)}
                style={[styles.stepButton, { width: theme.spacing.xxl, height: theme.spacing.xxxl }]}
              >
                <Ionicons name="remove" size={theme.spacing.base} color={theme.colors.textOnBrand} />
              </Pressable>

              <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
                {quantity}
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Добавить ещё порцию"
                hitSlop={theme.hitSlop}
                onPress={() => onChangeQuantity(quantity + 1)}
                style={[styles.stepButton, { width: theme.spacing.xxl, height: theme.spacing.xxxl }]}
              >
                <Ionicons name="add" size={theme.spacing.base} color={theme.colors.textOnBrand} />
              </Pressable>
            </View>
          ) : (
            <PressableScale
              onPress={onAdd}
              accessibilityLabel={`Добавить ${dish.name} в корзину`}
              depth={0.88}
              style={[
                styles.add,
                {
                  right: theme.spacing.sm,
                  bottom: theme.spacing.sm,
                  width: theme.spacing.xxxl,
                  height: theme.spacing.xxxl,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.colors.brand,
                  ...theme.elevation.raised,
                },
              ]}
            >
              <Ionicons name="add" size={theme.spacing.lg} color={theme.colors.textOnBrand} />
            </PressableScale>
          )
        ) : (
          <View
            style={[
              styles.badge,
              {
                left: theme.spacing.sm,
                bottom: theme.spacing.sm,
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: theme.spacing.xxs,
                borderRadius: theme.radius.sm,
                backgroundColor: theme.colors.scrim,
              },
            ]}
          >
            <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>
              Закончилось
            </Text>
          </View>
        )}
      </View>

      <View style={{ padding: theme.spacing.md, gap: theme.spacing.xxs }}>
        <Text
          numberOfLines={2}
          style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}
        >
          {dish.name}
        </Text>

        {measure ? (
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            {measure}
          </Text>
        ) : null}

        <Text style={[theme.typography.price, { color: theme.colors.textPrimary }]}>
          {formatPrice(dish.price_kopecks)}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden' },
  photo: { width: '100%', aspectRatio: 4 / 3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  add: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  stepper: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepButton: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute' },
});
