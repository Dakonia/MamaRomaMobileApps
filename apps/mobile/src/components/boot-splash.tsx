import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Ember } from '@/components/skia/ember';
import { OvenLoader } from '@/components/oven-loader';

/** Уголь печи: тот же тон, что у системной заставки — стыка не видно. */
const SCENE = require('../../assets/images/splash-scene.jpg');

const NIGHT = '#1A120C';

type Props = {
  /** Доля выполненной загрузки: полоса внизу показывает её честно. */
  progress: number;
  /** Данные готовы — можно уходить с заставки. */
  ready: boolean;
  onDone: () => void;
};

/**
 * Заставка запуска: готовый кадр сети во весь экран. Рисовать поверх нечего —
 * название и слоган уже в нём, поэтому движение оставлено самому кадру:
 * медленный наезд, живой огонь и уход вверх, в шапку меню.
 */
export function BootSplash({ progress, ready, onDone }: Props) {
  const { width, height } = useWindowDimensions();
  // На Android внизу живут кнопки навигации — печь не должна на них наезжать
  const insets = useSafeAreaInsets();

  const enter = useSharedValue(0);
  const drift = useSharedValue(0);
  const leave = useSharedValue(0);

  useEffect(() => {
    enter.value = withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) });
    drift.value = withTiming(1, { duration: 7000, easing: Easing.out(Easing.quad) });
  }, [drift, enter]);

  useEffect(() => {
    if (!ready) return;

    leave.value = withDelay(
      420,
      withTiming(1, { duration: 720, easing: Easing.inOut(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onDone)();
      }),
    );
  }, [ready, leave, onDone]);

  // Фон гаснет последним: под ним уже проступает меню
  const screen = useAnimatedStyle(() => ({ opacity: 1 - Math.max(0, leave.value * 1.5 - 0.5) }));

  const scene = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      // Наезд идёт всё время, а на уходе кадр подаётся вверх — в шапку меню
      { scale: 1.08 - drift.value * 0.06 + leave.value * 0.16 },
      { translateY: -drift.value * 8 - leave.value * height * 0.22 },
    ],
  }));

  // Свод печи гаснет раньше кадра: на уходе внизу ничего не мельтешит
  const bar = useAnimatedStyle(() => ({
    opacity: enter.value * (1 - leave.value * 2.4),
    transform: [{ translateY: leave.value * 26 }],
  }));

  return (
    <Animated.View style={[styles.root, screen, { backgroundColor: NIGHT }]}>
      <Animated.View style={[StyleSheet.absoluteFill, scene]}>
        <Image source={SCENE} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} />

        {/*
          Устье печи на кадре — примерно на две трети высоты. Жар считает
          видеокарта: пламя дышит и колышется само, без слоёв поверх кадра
        */}
        <Ember
          width={width}
          height={height * 0.5}
          power={0.9}
          style={{ top: height * 0.42, left: 0 }}
        />
      </Animated.View>

      {/* Низ уводим в уголь: полоса загрузки стоит на своей глубине */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(26,18,12,0)', 'rgba(26,18,12,0.55)', 'rgba(26,18,12,0.92)']}
        locations={[0.68, 0.86, 1]}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View style={[styles.bottom, bar, { bottom: insets.bottom + 28 }]}>
        <OvenLoader progress={progress} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: StyleSheet.absoluteFill,
  fire: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute' },
  bottom: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
