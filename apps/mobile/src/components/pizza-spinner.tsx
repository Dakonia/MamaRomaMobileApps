import { useEffect } from 'react';
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
import Svg, { Circle, G, Line } from 'react-native-svg';

import { refreshingTop, useRefreshing } from '@/store/refreshing';
import { useTheme } from '@/theme/theme-provider';

/** Цвета самой пиццы: это рисунок, а не элемент интерфейса. */
const CRUST = '#D9913F';
const DOUGH = '#F2C879';
const CHEESE = '#F8E0A6';
const SAUCE = '#C0392B';

const SIZE = 38;
const CENTER = SIZE / 2;

/** Куда кладём пепперони: угол по кругу и насколько далеко от центра. */
const PEPPERONI = [
  { angle: 25, radius: 0.52 },
  { angle: 95, radius: 0.34 },
  { angle: 160, radius: 0.55 },
  { angle: 232, radius: 0.4 },
  { angle: 300, radius: 0.56 },
];

/** Линии разреза: восемь долек, как у настоящей. */
const SLICES = [0, 45, 90, 135];

function dot(angle: number, radius: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: CENTER + Math.cos(radians) * CENTER * radius,
    y: CENTER + Math.sin(radians) * CENTER * radius,
  };
}

function edge(angle: number) {
  const radians = (angle * Math.PI) / 180;
  const reach = CENTER * 0.74;
  return {
    x1: CENTER - Math.cos(radians) * reach,
    y1: CENTER - Math.sin(radians) * reach,
    x2: CENTER + Math.cos(radians) * reach,
    y2: CENTER + Math.sin(radians) * reach,
  };
}

/**
 * Крутящаяся пицца вместо системного кружка обновления.
 *
 * Рисуется поверх приложения по общему состоянию: сам RefreshControl остаётся
 * на месте ради жеста, но его вид погашен.
 */
export function PizzaSpinner() {
  const theme = useTheme();
  const top = useRefreshing((state) => refreshingTop(state.running));
  const active = top !== null;

  const spin = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      spin.value = 0;
      return;
    }

    spin.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.linear }), -1, false);
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
        <Animated.View style={style}>
          <Svg width={SIZE} height={SIZE}>
            {/* Корочка по краю — она и делает круг пиццей, а не монетой */}
            <Circle cx={CENTER} cy={CENTER} r={CENTER - 1} fill={DOUGH} />
            <Circle
              cx={CENTER}
              cy={CENTER}
              r={CENTER - 2}
              fill="none"
              stroke={CRUST}
              strokeWidth={3}
            />
            <Circle cx={CENTER} cy={CENTER} r={CENTER * 0.76} fill={CHEESE} />

            <G stroke={CRUST} strokeWidth={0.8} opacity={0.5} strokeLinecap="round">
              {SLICES.map((angle) => {
                const line = edge(angle);
                return <Line key={angle} {...line} />;
              })}
            </G>

            {PEPPERONI.map(({ angle, radius }) => {
              const point = dot(angle, radius);
              return <Circle key={angle} cx={point.x} cy={point.y} r={2.6} fill={SAUCE} />;
            })}
          </Svg>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 20 },
  puck: { width: 50, height: 50, borderRadius: 25 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
