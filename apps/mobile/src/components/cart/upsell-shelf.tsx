import { useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/text';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import type { Dish } from '@/api/client';
import { PressableScale } from '@/components/pressable-scale';
import { formatPrice } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';
import { pieces } from '@/components/cart/shared';

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
                <View style={pieces.fill}>
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
