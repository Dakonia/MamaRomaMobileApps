import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { formatPrice } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';

type Props = {
  count: number;
  subtotal: number;
  onPress: () => void;
};

/** Корзина в шапке: пустая — просто иконка, непустая — раскрывается в пилюлю с суммой. */
export function CartPill({ count, subtotal, onPress }: Props) {
  const theme = useTheme();
  const filled = count > 0;

  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={filled ? `Корзина, ${count} позиций` : 'Корзина пуста'}
      depth={0.92}
      style={[
        styles.root,
        {
          minHeight: theme.layout.minTouchTarget,
          paddingHorizontal: filled ? theme.spacing.base : theme.spacing.md,
          gap: theme.spacing.sm,
          borderRadius: theme.radius.pill,
          backgroundColor: filled ? theme.colors.brand : theme.colors.heroRaised,
        },
      ]}
    >
      <Animated.View layout={LinearTransition.duration(theme.motion.duration.fast)}>
        <Ionicons
          name={filled ? 'bag-handle' : 'bag-handle-outline'}
          size={theme.spacing.lg}
          color={filled ? theme.colors.textOnBrand : theme.colors.onHero}
        />
      </Animated.View>

      {filled ? (
        <Animated.View
          entering={FadeIn.duration(theme.motion.duration.fast)}
          exiting={FadeOut.duration(theme.motion.duration.instant)}
          layout={LinearTransition.duration(theme.motion.duration.fast)}
        >
          <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
            {formatPrice(subtotal)}
          </Text>
        </Animated.View>
      ) : null}

      {filled ? (
        <View
          style={[
            styles.counter,
            {
              minWidth: theme.spacing.lg,
              height: theme.spacing.lg,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.onHero,
              paddingHorizontal: theme.spacing.xxs,
            },
          ]}
        >
          <Text style={[theme.typography.caption, { color: theme.colors.brand }]}>{count}</Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center' },
  counter: { alignItems: 'center', justifyContent: 'center' },
});
