import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { mediaUrl, type Dish, type FavouriteDish } from '@/api/client';
import { PressableScale } from '@/components/pressable-scale';
import { formatPrice } from '@/lib/format';
import { useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

type Props = {
  dishes: FavouriteDish[];
};

// Корзине нужны только имя, цена и фото — остальное заполняем пустыми значениями
const EMPTY_DISH: Dish = {
  id: '',
  category_id: '',
  name: '',
  description: null,
  composition: null,
  image_url: null,
  price_kopecks: 0,
  weight_grams: null,
  volume_ml: null,
  calories: null,
  proteins_g: null,
  fats_g: null,
  carbs_g: null,
  is_spicy: false,
  is_vegetarian: false,
  is_new: false,
  is_available: true,
  extras: [],
};

/** «Заказываете чаще всего»: три блюда из истории с кнопкой повтора. */
export function Favourites({ dishes }: Props) {
  const theme = useTheme();
  const add = useCart((state) => state.add);

  if (dishes.length === 0) return null;

  return (
    <View style={{ gap: theme.spacing.md }}>
      {dishes.map((dish) => {
        const photo = mediaUrl(dish.image_url);

        return (
          <PressableScale
            key={dish.dish_id}
            depth={0.99}
            accessibilityLabel={dish.name}
            onPress={() => router.push(`/dish/${dish.dish_id}`)}
            style={[
              styles.row,
              theme.elevation.card,
              {
                padding: theme.spacing.md,
                borderRadius: theme.radius.xl,
                backgroundColor: theme.colors.surface,
                gap: theme.spacing.md,
              },
            ]}
          >
            {photo ? (
              <Image
                source={{ uri: photo }}
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.skeleton,
                }}
                contentFit="cover"
                transition={200}
              />
            ) : null}

            <View style={styles.grow}>
              <Text
                numberOfLines={1}
                style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}
              >
                {dish.name}
              </Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                Брали {dish.times} {dish.times === 1 ? 'раз' : 'раза'}
              </Text>
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                {formatPrice(dish.price_kopecks)}
              </Text>
            </View>

            <PressableScale
              accessibilityLabel={`Добавить ${dish.name} в корзину`}
              onPress={() => {
                // Корзина принимает блюдо целиком: любимое блюдо приходит
                // из сводки, поэтому собираем недостающие поля значениями по умолчанию
                add({
                  ...EMPTY_DISH,
                  id: dish.dish_id,
                  name: dish.name,
                  price_kopecks: dish.price_kopecks,
                  image_url: dish.image_url,
                });
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              style={[
                styles.add,
                {
                  width: theme.layout.minTouchTarget,
                  height: theme.layout.minTouchTarget,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.colors.brandSubtle,
                },
              ]}
            >
              <Ionicons name="add" size={22} color={theme.colors.brand} />
            </PressableScale>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  add: { alignItems: 'center', justifyContent: 'center' },
});
