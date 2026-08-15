import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { mediaUrl, type Dish } from '@/api/client';
import { PressableScale } from '@/components/pressable-scale';
import { formatPrice } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';

export type PhotoRect = { x: number; y: number; width: number; height: number };

type Props = {
  dish: Dish;
  quantity: number;
  /** Отдаём положение снимка на экране — из него карточка и развернётся. */
  onOpen: (from: PhotoRect | null) => void;
  onAdd: () => void;
  onChangeQuantity: (quantity: number) => void;
  /** Узкая карточка для горизонтальных полок. */
  width?: number;
  /** Отметка «Хит» — ставим на полке частых заказов. */
  highlight?: boolean;
};

export function DishCard({
  dish,
  quantity,
  onOpen,
  onAdd,
  onChangeQuantity,
  width,
  highlight,
}: Props) {
  const theme = useTheme();
  const photoRef = useRef<View>(null);

  // Замер до перехода: анимация должна стартовать ровно с того места,
  // где снимок лежит в сетке
  const open = () => {
    const node = photoRef.current;
    if (node === null) {
      onOpen(null);
      return;
    }
    node.measureInWindow((x, y, width, height) => onOpen({ x, y, width, height }));
  };

  const badges = [
    highlight ? { text: 'Хит', background: theme.colors.highlight, color: theme.colors.onHero } : null,
    dish.is_new ? { text: 'Новинка', background: theme.colors.brand, color: theme.colors.onHero } : null,
    dish.is_spicy ? { text: 'Остро', background: theme.colors.danger, color: theme.colors.onHero } : null,
    dish.is_vegetarian
      ? { text: 'Веган', background: theme.colors.accent, color: theme.colors.onHero }
      : null,
  ].filter((badge): badge is { text: string; background: string; color: string } => badge !== null);

  // Короткая вибрация в момент добавления — отклик, которого ждёт рука
  const add = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onAdd();
  };
  const photo = mediaUrl(dish.image_url);
  const measure = dish.weight_grams
    ? `${dish.weight_grams} г`
    : dish.volume_ml
      ? `${dish.volume_ml} мл`
      : null;

  // У трети блюд описания нет — подставляем состав, а если нет и его,
  // цену показываем крупнее, чтобы карточка не выглядела недозаполненной
  const subtitle = dish.description ?? dish.composition ?? null;
  const priceStyle = subtitle === null ? theme.typography.display : theme.typography.price;

  return (
    <PressableScale
      onPress={open}
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
      <View ref={photoRef} style={[styles.photo, { backgroundColor: theme.colors.surfaceSunken }]}>
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

        {badges.length > 0 ? (
          <View
            style={[
              styles.badges,
              { left: theme.spacing.sm, top: theme.spacing.sm, gap: theme.spacing.xs },
            ]}
          >
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
                <Text style={[theme.typography.overline, { color: badge.color }]}>
                  {badge.text}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

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
              onPress={add}
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

      <View style={[styles.body, { padding: theme.spacing.md, gap: theme.spacing.xxs }]}>
        <Text
          numberOfLines={2}
          style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}
        >
          {dish.name}
        </Text>

        {subtitle ? (
          <Text
            numberOfLines={2}
            style={[theme.typography.caption, { color: theme.colors.textSecondary }]}
          >
            {subtitle}
          </Text>
        ) : null}

        <View style={[styles.priceRow, { gap: theme.spacing.sm, paddingTop: theme.spacing.xxs }]}>
          <Text style={[priceStyle, { color: theme.colors.textPrimary }]}>
            {formatPrice(dish.price_kopecks)}
          </Text>
          {measure ? (
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
              {measure}
            </Text>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden' },
  body: { flex: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 'auto' },
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
  badges: { position: 'absolute', flexDirection: 'row', flexWrap: 'wrap' },
});
