import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/** Откуда летит снимок: кадр фотографии в карточке меню, в координатах экрана. */
export type DishFrame = {
  uri: string;
  blurhash?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
};

/** Столько же длится проявление экрана блюда — они должны идти вместе. */
const DURATION = 260;

/**
 * Снимок блюда переезжает из карточки меню в шапку его экрана.
 *
 * Экран блюда открывается проявлением, и без этого фотография просто
 * подменялась: гость нажимал на маленький снимок, а через мгновение видел
 * большой — связи между ними не читалось. Здесь та же фотография физически
 * доезжает до своего места, и переход становится продолжением нажатия.
 *
 * Настоящий общий переход между экранами в Reanimated пока экспериментальный
 * и живёт за флагом, поэтому делаем накладку поверх: она ничего не знает про
 * навигацию и не может её сломать.
 */
export function DishFlight({
  frame,
  target,
  onDone,
}: {
  frame: DishFrame | null;
  /** Куда летит: шапка экрана блюда — во всю ширину, от самого верха. */
  target: { width: number; height: number };
  onDone: () => void;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (frame === null) return;

    progress.set(0);
    progress.set(
      withTiming(1, { duration: DURATION, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onDone)();
      }),
    );
  }, [frame, onDone, progress]);

  const style = useAnimatedStyle(() => {
    if (frame === null) return { opacity: 0 };

    const t = progress.get();

    return {
      opacity: interpolate(t, [0, 0.82, 1], [1, 1, 0]),
      left: interpolate(t, [0, 1], [frame.x, 0]),
      top: interpolate(t, [0, 1], [frame.y, 0]),
      width: interpolate(t, [0, 1], [frame.width, target.width]),
      height: interpolate(t, [0, 1], [frame.height, target.height]),
      borderRadius: interpolate(t, [0, 1], [frame.radius, 0]),
    };
  });

  if (frame === null) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.root, style]}>
      <Image
        source={{ uri: frame.uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        placeholder={frame.blurhash ? { blurhash: frame.blurhash } : undefined}
        placeholderContentFit="cover"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', zIndex: 30, overflow: 'hidden' },
});
