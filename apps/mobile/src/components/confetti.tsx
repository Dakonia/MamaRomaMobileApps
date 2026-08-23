import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  colors: string[];
  /** Сколько бумажек летит: больше двух десятков уже выглядит мусором. */
  count?: number;
};

function Piece({ color, index, width }: { color: string; index: number; width: number }) {
  const fall = useSharedValue(0);

  // Разброс держим на детерминированной формуле: каждый запуск выглядит одинаково
  const startX = ((index * 137) % 100) / 100;
  const drift = (((index * 71) % 60) - 30) / 100;
  const spin = 360 + ((index * 53) % 360);
  const size = 6 + (index % 3) * 3;

  useEffect(() => {
    fall.value = withDelay(
      index * 45,
      withTiming(1, { duration: 1600 + (index % 4) * 260, easing: Easing.out(Easing.quad) }),
    );
  }, [fall, index]);

  const style = useAnimatedStyle(() => ({
    opacity: fall.value < 0.1 ? fall.value * 10 : 1 - fall.value,
    transform: [
      { translateX: startX * width + drift * width * fall.value },
      { translateY: -20 + fall.value * 260 },
      { rotate: `${spin * fall.value}deg` },
      { scale: 1 - fall.value * 0.3 },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.piece,
        style,
        {
          width: size,
          height: size * 1.6,
          borderRadius: 2,
          backgroundColor: color,
        },
      ]}
    />
  );
}

/** Короткий всплеск конфетти: играет один раз при появлении экрана. */
export function Confetti({ colors, count = 18 }: Props) {
  const { width } = useWindowDimensions();

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: count }, (_, index) => (
        <Piece key={index} index={index} color={colors[index % colors.length]} width={width} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', top: 0, left: 0 },
});
