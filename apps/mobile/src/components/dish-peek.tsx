import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';

import { mediaUrl, type Dish } from '@/api/client';
import { PressableScale } from '@/components/pressable-scale';
import { formatPrice } from '@/lib/format';
import { useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

type Props = {
  dish: Dish | null;
  onClose: () => void;
  onOpen: () => void;
};

/**
 * Быстрый просмотр блюда: держите палец на карточке — фон уходит в размытие,
 * блюдо всплывает крупно с составом и ценой. Не нужно заходить в карточку
 * и возвращаться, чтобы прочитать состав.
 */
export function DishPeek({ dish, onClose, onOpen }: Props) {
  const theme = useTheme();
  const cart = useCart();
  const { width } = useWindowDimensions();

  if (!dish) return null;

  const photo = mediaUrl(dish.image_url);
  const size = Math.min(width - theme.spacing.xl * 2, 340);

  const facts = [
    dish.weight_grams ? `${dish.weight_grams} г` : null,
    dish.volume_ml ? `${dish.volume_ml} мл` : null,
    dish.calories ? `${dish.calories} ккал` : null,
  ].filter(Boolean);

  const add = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    cart.add(dish);
    onClose();
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={styles.root}>
        <BlurView intensity={38} tint={theme.isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрыть" />

        <Animated.View
          entering={ZoomIn.springify().damping(16).stiffness(160)}
          exiting={ZoomOut.duration(160)}
          style={[
            theme.elevation.card,
            {
              width: size,
              borderRadius: theme.radius.xxl,
              backgroundColor: theme.colors.surface,
              overflow: 'hidden',
            },
          ]}
        >
          <View style={{ height: size * 0.72, backgroundColor: theme.colors.surfaceSunken }}>
            {photo ? (
              <Image
                source={{ uri: photo }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={160}
                placeholder={dish.image_blurhash ? { blurhash: dish.image_blurhash } : undefined}
                placeholderContentFit="cover"
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.center]}>
                <Ionicons name="restaurant-outline" size={40} color={theme.colors.textTertiary} />
              </View>
            )}

            <LinearGradient
              colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
              style={styles.veil}
              pointerEvents="none"
            />

            <View style={[styles.facts, { padding: theme.spacing.md, gap: theme.spacing.xs }]}>
              {facts.map((fact) => (
                <View
                  key={fact}
                  style={{
                    paddingHorizontal: theme.spacing.sm,
                    paddingVertical: theme.spacing.xxs,
                    borderRadius: theme.radius.pill,
                    backgroundColor: 'rgba(255,255,255,0.22)',
                  }}
                >
                  <Text style={[theme.typography.caption, { color: '#FFFFFF' }]}>{fact}</Text>
                </View>
              ))}
            </View>
          </View>

          <Animated.View
            entering={FadeInDown.duration(240).delay(80)}
            style={{ padding: theme.spacing.base, gap: theme.spacing.sm }}
          >
            <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
              {dish.name}
            </Text>

            {dish.composition ?? dish.description ? (
              <Text
                numberOfLines={3}
                style={[theme.typography.caption, { color: theme.colors.textSecondary }]}
              >
                {dish.composition ?? dish.description}
              </Text>
            ) : null}

            <View style={[styles.row, { gap: theme.spacing.md, marginTop: theme.spacing.xxs }]}>
              <Text
                style={[
                  theme.typography.price,
                  theme.tabularNums,
                  styles.grow,
                  { color: theme.colors.textPrimary },
                ]}
              >
                {formatPrice(dish.price_kopecks)}
              </Text>

              <PressableScale
                depth={0.94}
                accessibilityLabel="Открыть блюдо"
                onPress={onOpen}
                style={[
                  styles.center,
                  {
                    width: theme.layout.minTouchTarget,
                    height: theme.layout.minTouchTarget,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.colors.surfaceSunken,
                  },
                ]}
              >
                <Ionicons name="expand-outline" size={18} color={theme.colors.textSecondary} />
              </PressableScale>

              {dish.is_available ? (
                <PressableScale
                  depth={0.94}
                  accessibilityLabel="Добавить в корзину"
                  onPress={add}
                  style={[
                    styles.center,
                    {
                      paddingHorizontal: theme.spacing.lg,
                      height: theme.layout.minTouchTarget,
                      borderRadius: theme.radius.pill,
                      backgroundColor: theme.colors.brand,
                    },
                  ]}
                >
                  <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
                    В корзину
                  </Text>
                </PressableScale>
              ) : null}
            </View>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  veil: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 96 },
  facts: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row' },
});
