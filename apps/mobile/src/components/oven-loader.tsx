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

/** Языки пламени: ширина устья, разный рост и свой ритм у каждого. */
const TONGUES = [
  { size: 16, duration: 520, delay: 180 },
  { size: 25, duration: 700, delay: 0 },
  { size: 36, duration: 600, delay: 320 },
  { size: 25, duration: 760, delay: 120 },
  { size: 16, duration: 560, delay: 420 },
];

/** Один язык: тянется вверх и оседает, не сходясь в такт с соседями. */
function Tongue({ index }: { index: number }) {
  const { size, duration, delay } = TONGUES[index];
  const live = useSharedValue(0);

  useEffect(() => {
    live.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: duration * 1.3, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
  }, [delay, duration, live]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.72 + live.value * 0.28,
    transform: [
      { translateY: -live.value * 4 },
      { scaleY: 0.86 + live.value * 0.3 },
      { scaleX: 1.04 - live.value * 0.1 },
    ],
  }));

  return (
    <Animated.View style={style}>
      <Ionicons name="flame" size={size} color={EMBER} />
    </Animated.View>
  );
}

/** Дымок над огнём: тонкая полоска поднимается, ведёт в сторону и тает. */
function Smoke({ index }: { index: number }) {
  const rise = useSharedValue(0);

  useEffect(() => {
    rise.value = withDelay(
      index * 700,
      withRepeat(withTiming(1, { duration: 2800, easing: Easing.out(Easing.quad) }), -1, false),
    );
  }, [index, rise]);

  const style = useAnimatedStyle(() => ({
    // Появляется быстро, тает медленно — как настоящая струйка
    opacity: rise.value < 0.18 ? rise.value * 1.9 : 0.34 * (1 - rise.value),
    transform: [
      { translateY: -rise.value * 52 },
      { translateX: Math.sin(rise.value * 3.4 + index * 1.7) * 7 },
      { scaleY: 0.5 + rise.value * 1.1 },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.smoke, style, { left: index * 7 - 7, backgroundColor: CREAM }]}
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
      { scale: (0.62 + shown.value * 0.38) * (0.97 + flame.value * 0.06) },
      { translateY: -flame.value * 1.5 },
    ],
  }));

  return (
    <View style={{ width: WIDTH, height: HEIGHT }}>
      {/* Дым идёт над огнём и уходит в свод */}
      <View style={[styles.smokes, { left: CENTER_X, top: HEIGHT - 54 }]}>
        {[0, 1, 2].map((index) => (
          <Smoke key={index} index={index} />
        ))}
      </View>

      {/* Пламя во всю ширину устья, но ниже свода: на кирпичи не заходит */}
      <Animated.View style={[styles.fire, fire, { top: HEIGHT - 42 }]}>
        {TONGUES.map((_, index) => (
          <Tongue key={index} index={index} />
        ))}
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
  fire: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    // Языки стоят на одной линии и слегка находят друг на друга
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: -3,
  },
  smokes: { position: 'absolute' },
  smoke: { position: 'absolute', width: 3, height: 16, borderRadius: 2 },
});
