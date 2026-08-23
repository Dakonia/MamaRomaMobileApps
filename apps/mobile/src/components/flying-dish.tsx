import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export type FlightStart = { uri: string; x: number; y: number; size: number };

type Props = {
  flight: FlightStart | null;
  /** Куда летит — центр блока заказа в координатах экрана. */
  target: { x: number; y: number };
  onDone: () => void;
};

const DURATION = 620;

/**
 * Миниатюра блюда летит по дуге в блок заказа. Дуга считается по трём точкам:
 * старт, вершина над обеими и цель — прямой перелёт выглядит дёшево.
 */
export function FlyingDish({ flight, target, onDone }: Props) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (flight === null) return;

    progress.value = 0;
    progress.value = withTiming(
      1,
      { duration: DURATION, easing: Easing.inOut(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onDone)();
      },
    );
  }, [flight, onDone, progress]);

  const style = useAnimatedStyle(() => {
    if (flight === null) return { opacity: 0 };

    const t = progress.value;
    const peak = Math.min(flight.y, target.y) - 90;

    const x = (1 - t) * flight.x + t * target.x;
    const y = (1 - t) * (1 - t) * flight.y + 2 * (1 - t) * t * peak + t * t * target.y;

    return {
      opacity: t > 0.94 ? 0 : 1,
      transform: [
        { translateX: x },
        { translateY: y },
        { scale: 1 - 0.65 * t },
        { rotate: `${t * 220}deg` },
      ],
    };
  });

  if (flight === null) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          styles.dish,
          style,
          { width: flight.size, height: flight.size, borderRadius: flight.size / 2 },
        ]}
      >
        <Image source={{ uri: flight.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dish: { position: 'absolute', overflow: 'hidden' },
});
