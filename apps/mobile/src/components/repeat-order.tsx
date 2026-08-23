import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { mediaUrl, type Order } from '@/api/client';
import { PrimaryButton } from '@/components/primary-button';
import { formatPrice } from '@/lib/format';
import { lineKey, useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const THUMB = 46;

/**
 * Прошлый заказ в пустой корзине: снимки блюд стопкой, состав и одна кнопка.
 * Это самый короткий путь к следующему заказу — он и должен выглядеть как
 * готовое предложение, а не как строчка текста со ссылкой.
 */
export function RepeatOrder({ order }: { order: Order }) {
  const theme = useTheme();
  const cart = useCart();

  const at = new Date(order.created_at);
  const photos = order.items
    .map((item) => mediaUrl(item.image_url))
    .filter((uri): uri is string => Boolean(uri))
    .slice(0, 3);

  const names = order.items.map((item) => item.name).join(' · ');
  const portions = order.items.reduce((sum, item) => sum + item.quantity, 0);

  const repeat = () => {
    cart.repeat(
      order.restaurant_id,
      order.items
        .filter((item) => item.dish_id !== null)
        .map((item) => {
          const extras = item.extras.map((extra, index) => ({
            id: `${item.dish_id}-${index}`,
            name: extra.name,
            priceKopecks: extra.price_kopecks,
          }));

          return {
            key: lineKey(item.dish_id ?? '', extras),
            dishId: item.dish_id ?? '',
            name: item.name,
            priceKopecks:
              item.unit_price_kopecks - extras.reduce((sum, extra) => sum + extra.priceKopecks, 0),
            extras,
            quantity: item.quantity,
          };
        }),
    );
  };

  return (
    <Animated.View
      entering={FadeInDown.duration(320)}
      style={[
        theme.elevation.card,
        {
          borderRadius: theme.radius.xxl,
          backgroundColor: theme.colors.surface,
          padding: theme.spacing.base,
          gap: theme.spacing.base,
        },
      ]}
    >
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        {/* Снимки блюд стопкой: сразу видно, что именно повторяем */}
        <View style={[styles.stack, { width: THUMB + (photos.length - 1) * 26 }]}>
          {photos.map((uri, index) => (
            <Image
              key={uri}
              source={{ uri }}
              style={[
                styles.thumb,
                {
                  left: index * 26,
                  zIndex: photos.length - index,
                  borderColor: theme.colors.surface,
                  backgroundColor: theme.colors.skeleton,
                },
              ]}
              contentFit="cover"
              transition={200}
            />
          ))}

          {photos.length === 0 ? (
            <View
              style={[
                styles.thumb,
                styles.center,
                { borderColor: theme.colors.surface, backgroundColor: theme.colors.brandSubtle },
              ]}
            >
              <Ionicons name="repeat" size={18} color={theme.colors.brand} />
            </View>
          ) : null}
        </View>

        <View style={styles.grow}>
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
            Ваш прошлый заказ
          </Text>
          <Text numberOfLines={1} style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {at.getDate()} {MONTHS[at.getMonth()]} · {order.restaurant_name}
          </Text>
        </View>

        <View
          style={{
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.xxs,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.surfaceSunken,
          }}
        >
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {portions} шт
          </Text>
        </View>
      </View>

      <Text numberOfLines={2} style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
        {names}
      </Text>

      <PrimaryButton
        label={`Повторить за ${formatPrice(order.subtotal_kopecks)}`}
        onPress={repeat}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  stack: { height: THUMB },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 2,
  },
});
