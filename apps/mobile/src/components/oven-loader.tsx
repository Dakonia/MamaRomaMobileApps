import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

const CREAM = '#F7EBDD';
const CREAM_SOFT = 'rgba(247,235,221,0.58)';
const EMBER = '#E9A94F';
const EMBER_DEEP = '#C96024';

const STONE_W = 16;
const STONE_H = 18;
const SPAN_X = 62;
const SPAN_Y = 43;
const ARCH = 8;

const SWEEP_MS = 1350;
const FIRE_MS = 1180;

const CENTER_X = SPAN_X + STONE_W / 2 + 2;
const CENTER_Y = SPAN_Y + STONE_H / 2 + 2;
const WIDTH = CENTER_X * 2;
const HEIGHT = CENTER_Y + STONE_H + 16;

type StoneSpec = {
  x: number;
  y: number;
  angle: number;
  width: number;
  height: number;
};

const STONES: StoneSpec[] = [
  { x: CENTER_X - SPAN_X, y: CENTER_Y + STONE_H, angle: 0, width: 15, height: 17 },
  ...Array.from({ length: ARCH }, (_, index) => {
    const degrees = 180 - (index / (ARCH - 1)) * 180;
    const radians = (degrees * Math.PI) / 180;
    const height = index % 2 === 0 ? 17 : 19;

    return {
      x: CENTER_X + Math.cos(radians) * SPAN_X,
      y: CENTER_Y - Math.sin(radians) * SPAN_Y,
      angle: 90 - degrees,
      width: index === 3 || index === 4 ? 15 : 16,
      height,
    };
  }),
  { x: CENTER_X + SPAN_X, y: CENTER_Y + STONE_H, angle: 0, width: 15, height: 17 },
];

const SMOKE = [
  { x: -10, width: 2, duration: 2600, delay: 0 },
  { x: -3, width: 3, duration: 2200, delay: 520 },
  { x: 4, width: 3, duration: 2800, delay: 260 },
  { x: 10, width: 2, duration: 2400, delay: 900 },
];

const COALS = [
  { x: -20, y: 2, size: 5, duration: 1500, delay: 0 },
  { x: -7, y: 5, size: 4, duration: 1200, delay: 360 },
  { x: 8, y: 4, size: 5, duration: 1650, delay: 180 },
  { x: 21, y: 1, size: 3, duration: 1320, delay: 620 },
];

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

function Stone({
  stone,
  index,
  sweep,
}: {
  stone: StoneSpec;
  index: number;
  sweep: SharedValue<number>;
}) {
  const shell = useAnimatedStyle(() => {
    const cursor = sweep.value * (STONES.length - 1);
    const beam = clamp(1 - Math.abs(cursor - index) / 1.1, 0, 1);
    const trail = clamp(1 - Math.abs(cursor - index) / 3.2, 0, 1);
    const opacity = 0.44 + trail * 0.2 + beam * 0.28;

    return {
      backgroundColor: `rgba(247,235,221,${0.035 + trail * 0.07 + beam * 0.05})`,
      borderColor: `rgba(247,235,221,${opacity})`,
      shadowOpacity: 0.08 + trail * 0.08 + beam * 0.28,
      transform: [{ rotate: `${stone.angle}deg` }, { scale: 1 + beam * 0.04 }],
    };
  });

  const fill = useAnimatedStyle(() => {
    const cursor = sweep.value * (STONES.length - 1);
    const beam = clamp(1 - Math.abs(cursor - index) / 1.15, 0, 1);
    const trail = clamp(1 - Math.abs(cursor - index) / 3.4, 0, 1);

    return {
      height: 2 + trail * (stone.height - 5),
      opacity: 0.2 + trail * 0.42 + beam * 0.28,
    };
  });

  const shine = useAnimatedStyle(() => {
    const cursor = sweep.value * (STONES.length - 1);
    const beam = clamp(1 - Math.abs(cursor - index) / 1.05, 0, 1);

    return {
      opacity: beam * 0.74,
      transform: [{ translateY: -STONE_H * 0.2 + beam * 2 }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.stone,
        shell,
        {
          left: stone.x - stone.width / 2,
          top: stone.y - stone.height / 2,
          width: stone.width,
          height: stone.height,
        },
      ]}
    >
      <Animated.View style={[styles.stoneFill, fill]} />
      <Animated.View style={[styles.stoneShine, shine]} />
    </Animated.View>
  );
}

function Smoke({ index }: { index: number }) {
  const { x, width, duration, delay } = SMOKE[index];
  const rise = useSharedValue(0);

  useEffect(() => {
    rise.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration, easing: Easing.out(Easing.quad) }), -1, false),
    );
  }, [delay, duration, rise]);

  const style = useAnimatedStyle(() => ({
    opacity: rise.value < 0.22 ? rise.value * 1.25 : Math.max(0, 0.24 * (1 - rise.value * 1.45)),
    transform: [
      { translateY: -rise.value * 24 },
      { translateX: Math.sin(rise.value * 3.1 + index * 1.6) * (2.5 + rise.value * 4) },
      { scaleY: 0.6 + rise.value * 0.7 },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.smoke, style, { left: x, width, backgroundColor: CREAM }]}
    />
  );
}

function Coal({ index }: { index: number }) {
  const { x, y, size, duration, delay } = COALS[index];
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: duration * 0.45, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: duration * 0.55, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
  }, [delay, duration, pulse]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.22 + pulse.value * 0.38,
    transform: [{ scale: 0.78 + pulse.value * 0.32 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.coal,
        style,
        {
          left: CENTER_X + x - size / 2,
          top: HEIGHT - 17 + y,
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    />
  );
}

export function OvenLoader({ progress }: { progress: number }) {
  const flame = useSharedValue(0);
  const sweep = useSharedValue(0);
  const shown = useSharedValue(progress);

  useEffect(() => {
    sweep.value = withRepeat(withTiming(1, { duration: SWEEP_MS, easing: Easing.linear }), -1, true);
  }, [sweep]);

  useEffect(() => {
    shown.value = withTiming(clamp(progress, 0, 1), {
      duration: 520,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, shown]);

  useEffect(() => {
    flame.value = withRepeat(
      withSequence(
        withTiming(1, { duration: FIRE_MS * 0.45, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: FIRE_MS * 0.55, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [flame]);

  const fire = useAnimatedStyle(() => ({
    opacity: 0.38 + shown.value * 0.5,
    transform: [
      { scale: (0.62 + shown.value * 0.36) * (0.96 + flame.value * 0.08) },
      { translateY: -flame.value * 1.5 },
    ],
  }));

  const fireGlow = useAnimatedStyle(() => ({
    opacity: 0.16 + shown.value * 0.26 + flame.value * 0.12,
    transform: [{ scale: 0.86 + shown.value * 0.16 + flame.value * 0.08 }],
  }));

  return (
    <View style={styles.root}>
      <Animated.View pointerEvents="none" style={[styles.fireGlow, fireGlow]} />

      <View style={styles.smokes}>
        {SMOKE.map((_, index) => (
          <Smoke key={index} index={index} />
        ))}
      </View>

      <Animated.View style={[styles.fire, fire]}>
        <Ionicons name="flame" size={42} color={EMBER_DEEP} />
        <View style={styles.innerFlame}>
          <Ionicons name="flame" size={24} color={EMBER} />
        </View>
        <View style={styles.fireCore} />
      </Animated.View>

      {COALS.map((_, index) => (
        <Coal key={index} index={index} />
      ))}

      {STONES.map((stone, index) => (
        <Stone
          key={`${Math.round(stone.x)}-${Math.round(stone.y)}`}
          stone={stone}
          index={index}
          sweep={sweep}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: WIDTH,
    height: HEIGHT,
  },
  stone: {
    position: 'absolute',
    width: STONE_W,
    height: STONE_H,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    borderWidth: 1.35,
    borderRadius: 4,
    padding: 1.5,
    shadowColor: CREAM,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 8,
  },
  stoneFill: {
    alignSelf: 'stretch',
    borderRadius: 2,
    backgroundColor: CREAM_SOFT,
  },
  stoneShine: {
    position: 'absolute',
    left: 3,
    right: 3,
    top: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#FFF8EC',
  },
  fire: {
    position: 'absolute',
    left: CENTER_X - 21,
    top: HEIGHT - 50,
  },
  fireGlow: {
    position: 'absolute',
    left: CENTER_X - 25,
    top: HEIGHT - 42,
    width: 50,
    height: 34,
    borderRadius: 25,
    backgroundColor: EMBER_DEEP,
    shadowColor: EMBER,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 15,
  },
  innerFlame: {
    position: 'absolute',
    left: 9,
    top: 11,
    opacity: 0.75,
  },
  fireCore: {
    position: 'absolute',
    left: 17,
    top: 27,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFF1B6',
    opacity: 0.6,
  },
  smokes: {
    position: 'absolute',
    left: CENTER_X,
    top: HEIGHT - 52,
  },
  smoke: {
    position: 'absolute',
    height: 13,
    borderRadius: 2,
  },
  coal: {
    position: 'absolute',
    backgroundColor: '#F3A351',
    shadowColor: EMBER,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 7,
  },
});
