import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/theme-provider';

const SEATS = 6;
const KNOB = 38;
const RAIL = 8;

/** Гость над линией: садится с пружиной, от него расходится круг. */
function Guest({ index, taken, tone }: { index: number; taken: boolean; tone: string }) {
  const theme = useTheme();
  const sit = useDerivedValue(() =>
    withDelay(index * 24, withSpring(taken ? 1 : 0, { damping: 11, stiffness: 210 })),
  );
  const ripple = useSharedValue(1);

  useEffect(() => {
    if (!taken) return;

    // Круг расходится один раз — в момент, когда гость сел
    ripple.value = 0;
    ripple.value = withTiming(1, { duration: 460 });
  }, [taken, ripple]);

  const body = useAnimatedStyle(() => ({
    opacity: 0.25 + sit.value * 0.75,
    transform: [{ scale: 0.7 + sit.value * 0.3 }, { translateY: (1 - sit.value) * 6 }],
  }));

  const wave = useAnimatedStyle(() => ({
    opacity: taken ? 0.35 * (1 - ripple.value) : 0,
    transform: [{ scale: 0.5 + ripple.value * 1.4 }],
  }));

  return (
    <View style={styles.seat}>
      <Animated.View
        style={[
          styles.ripple,
          wave,
          { width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: tone },
        ]}
      />
      <Animated.View style={body}>
        <Ionicons name="person" size={20} color={taken ? tone : theme.colors.border} />
      </Animated.View>
    </View>
  );
}

/**
 * Гости выбираются линией: палец ведёт бегунок, над линией по одному
 * рассаживаются силуэты. Шесть мест — предел обычного стола.
 */
export function GuestLine({
  value,
  onChange,
}: {
  value: number;
  onChange: (count: number) => void;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [shown, setShown] = useState(value);

  const usable = Math.max(0, width - KNOB);
  const share = useSharedValue((value - 1) / (SEATS - 1));
  const last = useSharedValue(value);
  const held = useSharedValue(0);

  const report = (count: number) => {
    setShown(count);
    onChange(count);
    void Haptics.selectionAsync();
  };

  useEffect(() => {
    setShown(value);
    last.value = value;
    share.value = withSpring((value - 1) / (SEATS - 1), { damping: 16, stiffness: 200 });
  }, [value, share, last]);

  const pick = (x: number) => {
    'worklet';
    if (usable <= 0) return;

    const next = Math.min(1, Math.max(0, (x - KNOB / 2) / usable));
    share.value = next;

    const count = Math.round(next * (SEATS - 1)) + 1;
    if (count !== last.value) {
      last.value = count;
      runOnJS(report)(count);
    }
  };

  const snap = () => {
    'worklet';
    held.value = withTiming(0, { duration: 160 });
    share.value = withSpring((last.value - 1) / (SEATS - 1), { damping: 15, stiffness: 210 });
  };

  // Ведение включается от горизонтального движения: вертикальный свайп
  // остаётся прокрутке экрана
  const slide = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .onStart((event) => {
      held.value = withTiming(1, { duration: 140 });
      pick(event.x);
    })
    .onUpdate((event) => pick(event.x))
    .onFinalize(snap);

  const touch = Gesture.Tap().onEnd((event) => {
    pick(event.x);
    snap();
  });

  const knob = useAnimatedStyle(() => ({
    transform: [
      { translateX: share.value * usable },
      { scale: 1 + held.value * 0.12 },
    ],
  }));

  const halo = useAnimatedStyle(() => ({
    opacity: held.value * 0.18,
    transform: [{ translateX: share.value * usable - KNOB / 2 }, { scale: 1 + held.value * 0.2 }],
  }));

  const fill = useAnimatedStyle(() => ({
    width: KNOB / 2 + share.value * usable,
  }));

  return (
    <View style={{ gap: theme.spacing.md }}>
      {/* Силуэты стоят ровно над своими делениями — считаем по той же мерке */}
      <View style={{ height: KNOB }}>
        {usable > 0
          ? Array.from({ length: SEATS }, (_, index) => (
              <View
                key={index}
                style={[styles.guest, { left: (index / (SEATS - 1)) * usable }]}
              >
                <Guest index={index} taken={index < shown} tone={theme.colors.brand} />
              </View>
            ))
          : null}
      </View>

      <GestureDetector gesture={Gesture.Race(slide, touch)}>
        <View
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          accessibilityLabel="Сколько гостей"
          style={{ height: KNOB }}
        >
          <View
            style={[
              styles.rail,
              {
                left: KNOB / 2,
                right: KNOB / 2,
                height: RAIL,
                borderRadius: RAIL / 2,
                backgroundColor: theme.colors.surfaceSunken,
                top: (KNOB - RAIL) / 2,
              },
            ]}
          />

          <Animated.View
            style={[
              styles.rail,
              fill,
              {
                left: 0,
                height: RAIL,
                borderRadius: RAIL / 2,
                backgroundColor: theme.colors.brand,
                top: (KNOB - RAIL) / 2,
              },
            ]}
          />

          {/* Деления: по одному на гостя, пройденные светлеют на заливке */}
          {usable > 0
            ? Array.from({ length: SEATS }, (_, index) => (
                <View
                  key={index}
                  pointerEvents="none"
                  style={[
                    styles.tick,
                    {
                      left: KNOB / 2 - 2 + (index / (SEATS - 1)) * usable,
                      top: KNOB / 2 - 2,
                      backgroundColor:
                        index + 1 <= shown ? theme.colors.textOnBrand : theme.colors.border,
                    },
                  ]}
                />
              ))
            : null}

          <Animated.View
            pointerEvents="none"
            style={[
              styles.knob,
              halo,
              {
                width: KNOB * 2,
                height: KNOB * 2,
                borderRadius: KNOB,
                top: -KNOB / 2,
                backgroundColor: theme.colors.brand,
              },
            ]}
          />

          <Animated.View
            pointerEvents="none"
            style={[
              styles.knob,
              knob,
              theme.elevation.card,
              {
                width: KNOB,
                height: KNOB,
                borderRadius: KNOB / 2,
                top: 0,
                backgroundColor: theme.colors.brand,
                borderColor: theme.colors.surface,
              },
            ]}
          >
            <Text
              style={{
                fontFamily: theme.typography.display.fontFamily,
                fontSize: 16,
                color: theme.colors.textOnBrand,
              }}
            >
              {shown}
            </Text>
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  guest: { position: 'absolute', width: KNOB, height: KNOB },
  seat: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ripple: { position: 'absolute' },
  rail: { position: 'absolute' },
  tick: { position: 'absolute', width: 4, height: 4, borderRadius: 2 },
  knob: {
    position: 'absolute',
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
});
