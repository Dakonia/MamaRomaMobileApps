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

const CREAM = '#F3E7D8';
const EMBER = '#E9A94F';

const BRICK_W = 17;
const BRICK_H = 19;
const SPAN_X = 62;
const SPAN_Y = 44;
const ARCH = 7;

/** Один проход волны по кладке: туда — наливается, обратно — гаснет. */
const SWEEP_MS = 1150;

const CENTER_X = SPAN_X + BRICK_W / 2 + 2;
const CENTER_Y = SPAN_Y + BRICK_H / 2 + 2;

const WIDTH = CENTER_X * 2;
// Под огонь оставляем место: он стоит на уровне основания столбов
const HEIGHT = CENTER_Y + BRICK_H + 14;

type Brick = { x: number; y: number; angle: number };

/** Устье печи: столб, свод по дуге, столб. Заполняются в этом же порядке. */
const BRICKS: Brick[] = [
  { x: CENTER_X - SPAN_X, y: CENTER_Y + BRICK_H, angle: 0 },
  ...Array.from({ length: ARCH }, (_, index) => {
    const degrees = 180 - (index / (ARCH - 1)) * 180;
    const radians = (degrees * Math.PI) / 180;

    return {
      x: CENTER_X + Math.cos(radians) * SPAN_X,
      y: CENTER_Y - Math.sin(radians) * SPAN_Y,
      angle: 90 - degrees,
    };
  }),
  { x: CENTER_X + SPAN_X, y: CENTER_Y + BRICK_H, angle: 0 },
];

/**
 * Кирпич: пустой контур, внутри которого поднимается белый уровень. Долю
 * считаем прямо на UI-потоке из общего значения — тогда кладка растёт плавно,
 * а не перескакивает, когда данные приходят разом.
 */
function Brick({
  brick,
  index,
  sweep,
}: {
  brick: Brick;
  index: number;
  sweep: SharedValue<number>;
}) {
  // Долю считаем прямо в стиле: вызвать отсюда обычную функцию UI-поток не может
  const level = useAnimatedStyle(() => {
    const share = Math.min(1, Math.max(0, sweep.value * (BRICKS.length + 0.8) - index));

    return { height: share * (BRICK_H - 5) };
  });

  const shell = useAnimatedStyle(() => {
    const share = Math.min(1, Math.max(0, sweep.value * (BRICKS.length + 0.8) - index));

    return { borderColor: `rgba(243,231,216,${0.42 + share * 0.5})` };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.brick,
        shell,
        {
          left: brick.x - BRICK_W / 2,
          top: brick.y - BRICK_H / 2,
          transform: [{ rotate: `${brick.angle}deg` }],
        },
      ]}
    >
      <Animated.View style={[styles.fill, level]} />
    </Animated.View>
  );
}

/**
 * Струйки дыма над огнём. Тонкие и короткие: место между пламенем и сводом
 * маленькое, а заходить на кирпичи дыму нельзя — они показывают загрузку.
 */
const SMOKE = [
  { x: -9, width: 2, duration: 2600, delay: 0 },
  { x: -3, width: 3, duration: 2200, delay: 520 },
  { x: 3, width: 3, duration: 2800, delay: 260 },
  { x: 9, width: 2, duration: 2400, delay: 900 },
];

/** Одна струйка: поднимается, расходится в стороны и тает под сводом. */
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
    // Гаснет задолго до свода: до кирпичей не доходит ничего
    opacity: rise.value < 0.2 ? rise.value * 1.6 : Math.max(0, 0.32 * (1 - rise.value * 1.5)),
    transform: [
      { translateY: -rise.value * 26 },
      { translateX: Math.sin(rise.value * 3.1 + index * 1.6) * (3 + rise.value * 4) },
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

/**
 * Загрузка в виде устья дровяной печи: кирпичи наполняются белым по мере
 * готовности данных, внутри разгорается огонь и тянется дымок.
 */
export function OvenLoader({ progress }: { progress: number }) {
  const flame = useSharedValue(0);
  const sweep = useSharedValue(0);
  const shown = useSharedValue(0);

  useEffect(() => {
    // Маятник: кладка наливается слева направо, потом гаснет справа налево
    sweep.value = withRepeat(withTiming(1, { duration: SWEEP_MS, easing: Easing.linear }), -1, true);
  }, [sweep]);

  // Огонь показывает настоящую загрузку: кирпичи заняты ходом маятника
  useEffect(() => {
    shown.value = withTiming(progress, { duration: 420 });
  }, [progress, shown]);

  useEffect(() => {
    flame.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 560, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 720, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [flame]);

  // Всё пламя целиком разгорается по мере готовности данных
  const fire = useAnimatedStyle(() => ({
    opacity: 0.4 + shown.value * 0.6,
    transform: [
      { scale: (0.6 + shown.value * 0.4) * (0.94 + flame.value * 0.12) },
      { translateY: -flame.value * 2 },
    ],
  }));

  return (
    <View style={{ width: WIDTH, height: HEIGHT }}>
      {/* Дым идёт над огнём и уходит в свод */}
      <View style={[styles.smokes, { left: CENTER_X, top: HEIGHT - 50 }]}>
        {SMOKE.map((_, index) => (
          <Smoke key={index} index={index} />
        ))}
      </View>

      {/* Огонь один, крупный: он и даёт весь дым */}
      <Animated.View style={[styles.fire, fire, { left: CENTER_X - 21, top: HEIGHT - 48 }]}>
        <Ionicons name="flame" size={42} color={EMBER} />
      </Animated.View>

      {BRICKS.map((brick, index) => (
        <Brick
          key={`${Math.round(brick.x)}-${Math.round(brick.y)}`}
          brick={brick}
          index={index}
          sweep={sweep}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  brick: {
    position: 'absolute',
    width: BRICK_W,
    height: BRICK_H,
    borderRadius: 3,
    borderWidth: 1.5,
    padding: 1.5,
    justifyContent: 'flex-end',
  },
  fill: { alignSelf: 'stretch', borderRadius: 2, backgroundColor: CREAM },
  fire: { position: 'absolute' },
  smokes: { position: 'absolute' },
  smoke: { position: 'absolute', height: 13, borderRadius: 2 },
});
