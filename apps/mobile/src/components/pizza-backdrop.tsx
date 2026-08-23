import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/theme-provider';

// Летающая мелочь: где, какого размера, как наклонена и как быстро качается
const FLOATERS = [
  { icon: 'pizza', size: 116, top: '5%', left: '-8%', angle: -18, drift: 5200, dim: 1 },
  { icon: 'pizza', size: 72, top: '24%', left: '78%', angle: 24, drift: 4300, dim: 0.8 },
  { icon: 'leaf', size: 54, top: '46%', left: '3%', angle: 12, drift: 3800, dim: 0.7 },
  { icon: 'pizza', size: 88, top: '62%', left: '74%', angle: -12, drift: 6100, dim: 0.85 },
  { icon: 'leaf', size: 42, top: '78%', left: '16%', angle: -26, drift: 4700, dim: 0.6 },
  { icon: 'pizza', size: 58, top: '88%', left: '58%', angle: 30, drift: 5600, dim: 0.7 },
] as const;

type FloaterProps = {
  spot: (typeof FLOATERS)[number];
  index: number;
};

function Floater({ spot, index, strength }: FloaterProps & { strength: number }) {
  const theme = useTheme();
  const shift = useSharedValue(0);

  useEffect(() => {
    // Один запуск на всё время экрана: иначе качание сбрасывается на каждом рендере
    shift.value = withDelay(
      index * 320,
      withRepeat(withTiming(1, { duration: spot.drift }), -1, true),
    );
  }, [index, shift, spot.drift]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: -14 * shift.value },
      { rotate: `${spot.angle + 6 * shift.value}deg` },
    ],
  }));

  return (
    <Animated.View style={[styles.floater, style, { top: spot.top, left: spot.left }]}>
      <Ionicons
        name={spot.icon}
        size={spot.size}
        color={spot.icon === 'leaf' ? theme.colors.accent : theme.colors.brand}
        style={{ opacity: (theme.isDark ? 0.16 : 0.1) * spot.dim * strength }}
      />
    </Animated.View>
  );
}

type Props = {
  /** Насколько заметны иконки: за формой входа ярче, за списком тише. */
  strength?: number;
};

/** Фон с медленно плывущими пиццами и листьями базилика. */
export function PizzaBackdrop({ strength = 1 }: Props) {
  return (
    // Иконки не перерисовываются вместе с экраном: качание живёт на UI-потоке,
    // а сам фон отрисовывается один раз
    <View pointerEvents="none" style={StyleSheet.absoluteFill} renderToHardwareTextureAndroid>
      {FLOATERS.map((spot, index) => (
        <Floater key={`${spot.icon}-${index}`} spot={spot} index={index} strength={strength} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  floater: { position: 'absolute' },
});
