import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

const SIZE = 108;
const RING = 2 * Math.PI * 46;
const CHECK = 60;

type Props = {
  color: string;
  ringColor: string;
};

/**
 * Галочка рисуется линией, а не появляется картинкой: сначала обводится круг,
 * потом ставится сама галка, и всё вместе слегка пружинит.
 */
export function SuccessCheck({ color, ringColor }: Props) {
  const ring = useSharedValue(RING);
  const check = useSharedValue(CHECK);
  const pop = useSharedValue(0.6);
  const halo = useSharedValue(0);

  useEffect(() => {
    pop.value = withSpring(1, { damping: 9, stiffness: 140 });
    ring.value = withTiming(0, { duration: 620, easing: Easing.out(Easing.cubic) });
    check.value = withDelay(420, withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) }));
    halo.value = withDelay(
      520,
      withSequence(withTiming(1, { duration: 420 }), withTiming(0, { duration: 520 })),
    );
  }, [check, halo, pop, ring]);

  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: ring.value }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: check.value }));

  const shell = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const wave = useAnimatedStyle(() => ({
    opacity: 0.35 * (1 - halo.value),
    transform: [{ scale: 1 + halo.value * 0.9 }],
  }));

  return (
    <View style={styles.root}>
      <Animated.View
        style={[
          styles.halo,
          wave,
          { width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: ringColor },
        ]}
      />

      <Animated.View style={shell}>
        <Svg width={SIZE} height={SIZE} viewBox="0 0 100 100">
          <Circle cx="50" cy="50" r="46" stroke={ringColor} strokeWidth={5} fill="none" />

          <AnimatedCircle
            cx="50"
            cy="50"
            r="46"
            stroke={color}
            strokeWidth={5}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={RING}
            animatedProps={ringProps}
            transform="rotate(-90 50 50)"
          />

          <AnimatedPath
            d="M30 51 L44 65 L71 36"
            stroke={color}
            strokeWidth={6}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={CHECK}
            animatedProps={checkProps}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute' },
});
