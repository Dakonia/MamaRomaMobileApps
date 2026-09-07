import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { api, mediaUrl, type Dish } from '@/api/client';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { useCart } from '@/store/cart';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

const CARD = 116;
const PHOTO = 96;

/**
 * Одно блюдо — это не полка, а случайность: горизонтальный ряд из одной
 * карточки выглядит как недогруженный экран. С двух уже читается как выбор.
 */
const MIN_DISHES = 2;

/**
 * «Вы заказывали» — блюда этого гостя, чаще взятые первыми.
 *
 * Половина заказов в доставке — повторные, и человек ищет в меню одно и то же.
 * Полка снимает этот поиск: пицца, которую он берёт каждую пятницу, лежит
 * готовой карточкой, и добавить её можно, не открывая блюдо.
 *
 * Считает сервер по состоявшимся заказам гостя. Полка работает с первого
 * заказа: человек возвращается за тем, что уже пробовал. Не заказывал ни
 * разу — полки нет вовсе. Стоп-лист и то,
 * чего в этом ресторане не готовят, сервер уже отсеял: обещать «как обычно»
 * и упереться в «сегодня нет» — худшее, что эта полка может сделать.
 */
export function UsualShelf() {
  const theme = useTheme();
  const cart = useCart();
  const session = useSession();

  const usual = useQuery({
    queryKey: ['usual', cart.restaurantId],
    queryFn: () => api.usual(cart.restaurantId ?? undefined),
    enabled: session.status === 'authorized',
    staleTime: 5 * 60_000,
  });

  const dishes = usual.data ?? [];
  if (dishes.length < MIN_DISHES) return null;

  const add = (dish: Dish) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    track('usual_added', { dish: dish.name });
    cart.add(dish);
  };

  return (
    <Animated.View
      entering={FadeIn.duration(theme.motion.duration.base)}
      style={{ paddingTop: theme.spacing.base, gap: theme.spacing.sm }}
    >
      <View style={{ paddingHorizontal: theme.layout.screenPadding }}>
        <Text style={[theme.typography.h2, { color: theme.colors.textPrimary }]}>
          Вы заказывали
        </Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
          Чаще всего вы берёте это — добавить можно прямо отсюда
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenPadding,
          gap: theme.spacing.md,
        }}
      >
        {dishes.map((dish) => {
          const inCart = cart.items
            .filter((item) => item.dishId === dish.id)
            .reduce((sum, item) => sum + item.quantity, 0);
          const photo = mediaUrl(dish.image_url);

          return (
            <PressableScale
              key={dish.id}
              accessibilityLabel={`${dish.name}, ${formatPrice(dish.price_kopecks)}`}
              depth={0.97}
              onPress={() => router.push(`/dish/${dish.id}`)}
              style={{ width: CARD, gap: theme.spacing.xs }}
            >
              <View>
                <Image
                  source={photo ? { uri: photo } : undefined}
                  style={[
                    styles.photo,
                    {
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.colors.skeleton,
                    },
                  ]}
                  contentFit="cover"
                  transition={200}
                />

                {/* Кнопка поверх снимка: до неё дотягивается большой палец,
                    а карточка целиком остаётся ссылкой на блюдо */}
                <PressableScale
                  accessibilityLabel={`Добавить ${dish.name} в корзину`}
                  depth={0.9}
                  hitSlop={theme.hitSlop}
                  onPress={() => add(dish)}
                  style={[
                    styles.add,
                    theme.elevation.card,
                    {
                      borderRadius: theme.radius.pill,
                      backgroundColor: inCart > 0 ? theme.colors.brand : theme.colors.surface,
                    },
                  ]}
                >
                  {inCart > 0 ? (
                    <Text
                      maxFontSizeMultiplier={1.1}
                      style={[
                        theme.typography.bodyMedium,
                        { color: theme.colors.textOnBrand },
                      ]}
                    >
                      {inCart}
                    </Text>
                  ) : (
                    <Ionicons name="add" size={18} color={theme.colors.brand} />
                  )}
                </PressableScale>
              </View>

              <Text
                numberOfLines={2}
                style={[theme.typography.caption, { color: theme.colors.textPrimary }]}
              >
                {dish.name}
              </Text>
              <Text style={[theme.typography.price, { color: theme.colors.textPrimary }]}>
                {formatPrice(dish.price_kopecks)}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  photo: { width: CARD, height: PHOTO },
  add: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
