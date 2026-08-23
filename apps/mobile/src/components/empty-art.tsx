import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/theme/theme-provider';

export type EmptyArtKind = 'cart' | 'orders' | 'booking' | 'search' | 'plate';

const SIZE = 132;

/**
 * Рисунок для пустого экрана. Векторный, а не картинка: одинаково резкий на
 * любом экране, весит ноль и сам перекрашивается под тему.
 */
export function EmptyArt({ kind }: { kind: EmptyArtKind }) {
  const theme = useTheme();
  const float = useSharedValue(0);

  useEffect(() => {
    float.value = withRepeat(
      withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [float]);

  const drift = useAnimatedStyle(() => ({
    transform: [{ translateY: -6 * float.value }, { rotate: `${-1.5 + float.value * 3}deg` }],
  }));

  const shadow = useAnimatedStyle(() => ({
    opacity: 0.18 - float.value * 0.06,
    transform: [{ scaleX: 1 - float.value * 0.08 }],
  }));

  const line = theme.colors.brand;
  const soft = theme.colors.brandSubtle;
  const ink = theme.colors.textTertiary;

  return (
    <View style={styles.root}>
      <Animated.View
        style={[styles.shadow, shadow, { backgroundColor: theme.colors.textPrimary }]}
      />

      <Animated.View style={drift}>
        <Svg width={SIZE} height={SIZE} viewBox="0 0 132 132">
          {kind === 'cart' ? (
            <>
              <Path
                d="M34 46h64l-6 62a8 8 0 0 1-8 7H48a8 8 0 0 1-8-7Z"
                fill={soft}
                stroke={line}
                strokeWidth={3}
              />
              <Path
                d="M52 46V34a14 14 0 0 1 28 0v12"
                fill="none"
                stroke={line}
                strokeWidth={3}
                strokeLinecap="round"
              />
              <Line x1="48" y1="70" x2="84" y2="70" stroke={ink} strokeWidth={2.5} strokeLinecap="round" />
              <Line x1="52" y1="86" x2="80" y2="86" stroke={ink} strokeWidth={2.5} strokeLinecap="round" />
            </>
          ) : null}

          {kind === 'orders' ? (
            <>
              <Path
                d="M38 26h56v76l-9-6-9 6-9-6-9 6-9-6-11 6Z"
                fill={soft}
                stroke={line}
                strokeWidth={3}
                strokeLinejoin="round"
              />
              <Line x1="52" y1="48" x2="80" y2="48" stroke={line} strokeWidth={3} strokeLinecap="round" />
              <Line x1="52" y1="64" x2="80" y2="64" stroke={ink} strokeWidth={2.5} strokeLinecap="round" />
              <Line x1="52" y1="78" x2="70" y2="78" stroke={ink} strokeWidth={2.5} strokeLinecap="round" />
            </>
          ) : null}

          {kind === 'booking' ? (
            <>
              <Ellipse cx="66" cy="58" rx="40" ry="14" fill={soft} stroke={line} strokeWidth={3} />
              <Line x1="66" y1="70" x2="66" y2="100" stroke={line} strokeWidth={3} strokeLinecap="round" />
              <Line x1="48" y1="106" x2="84" y2="106" stroke={line} strokeWidth={3} strokeLinecap="round" />
              <Circle cx="34" cy="76" r="9" fill="none" stroke={ink} strokeWidth={2.5} />
              <Circle cx="98" cy="76" r="9" fill="none" stroke={ink} strokeWidth={2.5} />
            </>
          ) : null}

          {kind === 'search' ? (
            <>
              <Circle cx="60" cy="58" r="28" fill={soft} stroke={line} strokeWidth={3} />
              <Line
                x1="80"
                y1="78"
                x2="102"
                y2="100"
                stroke={line}
                strokeWidth={4}
                strokeLinecap="round"
              />
              <Line x1="48" y1="58" x2="72" y2="58" stroke={ink} strokeWidth={2.5} strokeLinecap="round" />
            </>
          ) : null}

          {kind === 'plate' ? (
            <>
              <Circle cx="66" cy="66" r="38" fill={soft} stroke={line} strokeWidth={3} />
              <Circle cx="66" cy="66" r="24" fill="none" stroke={ink} strokeWidth={2.5} />
              <Rect x="18" y="46" width="4" height="40" rx="2" fill={ink} />
              <Rect x="110" y="46" width="4" height="40" rx="2" fill={ink} />
            </>
          ) : null}
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: SIZE, height: SIZE + 16, alignItems: 'center', justifyContent: 'center' },
  shadow: {
    position: 'absolute',
    bottom: 4,
    width: 74,
    height: 10,
    borderRadius: 6,
  },
});
