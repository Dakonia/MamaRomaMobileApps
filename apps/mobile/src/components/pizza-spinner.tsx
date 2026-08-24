import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';

import { useRefreshing } from '@/store/refreshing';
import { useTheme } from '@/theme/theme-provider';

/** Цвета самой пиццы: это рисунок, а не элемент интерфейса. */
const CRUST = '#E3A857';
const CHEESE = '#F6D48B';

const SIZE = 34;
/** Пять кусочков пепперони по кругу — на глаз их видно как вращение. */
const PEPPERONI = [0, 72, 144, 216, 288];

/**
 * Крутящаяся пицца вместо системного кружка обновления.
 *
 * Рисуется поверх приложения по общему состоянию: сам RefreshControl остаётся
 * на месте ради жеста, но его вид погашен.
 */
export function PizzaSpinner() {
  const theme = useTheme();
  const active = useRefreshing((state) => state.active);
  const top = useRefreshing((state) => state.top);

  const spin = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      spin.value = 0;
      return;
    }

    spin.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.linear }), -1, false);
  }, [active, spin]);

  const turn = useDerivedValue(() => `${spin.value * 360}deg`);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: turn.value }] }));

  if (!active) return null;

  return (
    <Animated.View
      pointerEvents="none"
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(160)}
      style={[styles.root, { top: top + theme.spacing.md }]}
    >
      <View
        style={[
          styles.puck,
          styles.center,
          { backgroundColor: theme.colors.surface, ...theme.elevation.card },
        ]}
      >
        <Animated.View style={[styles.pizza, styles.center, style, { backgroundColor: CRUST }]}>
          <View style={[styles.cheese, { backgroundColor: CHEESE }]} />

          {PEPPERONI.map((angle) => (
            <View
              key={angle}
              style={[
                styles.slice,
                {
                  transform: [{ rotate: `${angle}deg` }, { translateY: -SIZE * 0.24 }],
                  backgroundColor: theme.colors.brand,
                },
              ]}
            />
          ))}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 20 },
  puck: { width: 46, height: 46, borderRadius: 23 },
  center: { alignItems: 'center', justifyContent: 'center' },
  pizza: { width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  cheese: {
    position: 'absolute',
    width: SIZE - 7,
    height: SIZE - 7,
    borderRadius: (SIZE - 7) / 2,
  },
  slice: { position: 'absolute', width: 6, height: 6, borderRadius: 3 },
});
