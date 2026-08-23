import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/theme-provider';

type Props = {
  height: number;
  width?: DimensionValue;
  radius?: number;
};

/** Заглушка с бегущим бликом: видно, что данные грузятся, а не что экран завис. */
export function Skeleton({ height, width = '100%', radius }: Props) {
  const theme = useTheme();
  const shift = useSharedValue(0);

  useEffect(() => {
    shift.value = withRepeat(withTiming(1, { duration: 1200 }), -1, false);
  }, [shift]);

  const wave = useAnimatedStyle(() => ({
    transform: [{ translateX: `${-100 + 200 * shift.value}%` }],
  }));

  return (
    <View
      style={{
        height,
        width,
        borderRadius: radius ?? theme.radius.lg,
        backgroundColor: theme.colors.skeleton,
        overflow: 'hidden',
      }}
    >
      <Animated.View style={[StyleSheet.absoluteFill, wave]}>
        <LinearGradient
          colors={['transparent', theme.colors.surface, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[StyleSheet.absoluteFill, styles.wave]}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wave: { opacity: 0.55 },
});
