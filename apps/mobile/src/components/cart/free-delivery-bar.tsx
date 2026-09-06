import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Text } from '@/components/text';
import { Ionicons } from '@expo/vector-icons';
import { formatPrice } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';
import { pieces } from '@/components/cart/shared';

export function FreeDeliveryBar({
  subtotal,
  freeFrom,
  left,
}: {
  subtotal: number;
  freeFrom: number;
  left: number;
}) {
  const theme = useTheme();
  const share = freeFrom > 0 ? Math.min(1, subtotal / freeFrom) : 1;

  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withTiming(share, { duration: 520 });
  }, [fill, share]);

  const bar = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  const reached = left <= 0;

  return (
    <View
      style={{
        gap: theme.spacing.sm,
        padding: theme.spacing.base,
        borderRadius: theme.radius.lg,
        backgroundColor: reached ? theme.colors.successSubtle : theme.colors.surface,
      }}
    >
      <View style={[pieces.line, { gap: theme.spacing.sm }]}>
        <Ionicons
          name={reached ? 'gift' : 'car'}
          size={16}
          color={reached ? theme.colors.success : theme.colors.brand}
        />
        <Text
          style={[
            theme.typography.caption,
            pieces.grow,
            { color: reached ? theme.colors.success : theme.colors.textSecondary },
          ]}
        >
          {reached
            ? 'Доставка бесплатно — порог пройден'
            : `До бесплатной доставки ещё ${formatPrice(left)}`}
        </Text>
      </View>

      <View style={[pieces.track, { backgroundColor: theme.colors.border }]}>
        <Animated.View
          style={[
            pieces.fill2,
            bar,
            { backgroundColor: reached ? theme.colors.success : theme.colors.brand },
          ]}
        />
      </View>
    </View>
  );
}

/** Когда привезти: как можно скорее или ко времени. */
