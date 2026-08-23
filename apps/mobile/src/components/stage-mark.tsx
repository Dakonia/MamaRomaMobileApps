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
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import type { Order } from '@/api/client';
import { SuccessCheck } from '@/components/success-check';

type Props = {
  status: Order['status'];
  type: Order['type'];
};

const SIZE = 108;

/** Пар над готовящимся блюдом: три струйки, каждая со своим ритмом. */
function Steam({ index }: { index: number }) {
  const rise = useSharedValue(0);

  useEffect(() => {
    rise.value = withDelay(
      index * 320,
      withRepeat(withTiming(1, { duration: 1900, easing: Easing.out(Easing.quad) }), -1, false),
    );
  }, [index, rise]);

  const style = useAnimatedStyle(() => ({
    opacity: rise.value < 0.15 ? rise.value * 6 : 1 - rise.value,
    transform: [
      { translateY: -rise.value * 46 },
      { translateX: Math.sin(rise.value * Math.PI * 2) * 6 },
      { scale: 0.6 + rise.value * 0.5 },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.steam,
        style,
        { left: 36 + index * 18, backgroundColor: 'rgba(255,255,255,0.7)' },
      ]}
    />
  );
}

/**
 * Значок этапа со своей анимацией: принят — галочка, готовим — пар над
 * сковородой, в пути — едущая машина, выполнен — печать «спасибо».
 */
export function StageMark({ status, type }: Props) {
  const spin = useSharedValue(0);
  const drive = useSharedValue(0);
  const pop = useSharedValue(0);

  useEffect(() => {
    pop.value = withSpring(1, { damping: 10, stiffness: 150 });

    spin.value = withRepeat(
      withSequence(withTiming(1, { duration: 1400 }), withTiming(0, { duration: 1400 })),
      -1,
      false,
    );

    drive.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.linear }), -1, false);
  }, [drive, pop, spin]);

  const shell = useAnimatedStyle(() => ({ transform: [{ scale: 0.7 + 0.3 * pop.value }] }));

  const pan = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-4 + spin.value * 8}deg` }],
  }));

  const car = useAnimatedStyle(() => ({
    opacity: drive.value < 0.12 ? drive.value * 8 : drive.value > 0.88 ? (1 - drive.value) * 8 : 1,
    transform: [{ translateX: -46 + drive.value * 92 }],
  }));

  const ring = useAnimatedStyle(() => ({
    opacity: 0.3 * (1 - spin.value),
    transform: [{ scale: 1 + spin.value * 0.5 }],
  }));

  // Свежий заказ и отмена — статичная галочка, её рисует SuccessCheck
  if (['created', 'paid', 'accepted', 'cancelled'].includes(status)) {
    return <SuccessCheck color="#FFFFFF" ringColor="rgba(255,255,255,0.28)" />;
  }

  if (status === 'completed') {
    return (
      <Animated.View style={[styles.root, shell]}>
        <Animated.View style={[styles.halo, ring]} />
        <View style={styles.circle}>
          <Ionicons name="heart" size={44} color="#C0392B" />
        </View>
      </Animated.View>
    );
  }

  if (status === 'cooking') {
    return (
      <Animated.View style={[styles.root, shell]}>
        {[0, 1, 2].map((index) => (
          <Steam key={index} index={index} />
        ))}

        <Animated.View style={[styles.circle, pan]}>
          <Ionicons name="flame" size={44} color="#C0392B" />
        </Animated.View>
      </Animated.View>
    );
  }

  // «Готов» и «в пути»: машина едет внутри круга, ничего не вылезает наружу
  return (
    <Animated.View style={[styles.root, shell]}>
      <Animated.View style={[styles.halo, ring]} />

      <View style={[styles.circle, styles.clip]}>
        {type === 'delivery' ? (
          <Animated.View style={car}>
            <Ionicons name="car" size={42} color="#C0392B" />
          </Animated.View>
        ) : (
          <Ionicons name="storefront" size={42} color="#C0392B" />
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  clip: { overflow: 'hidden' },
  steam: { position: 'absolute', top: 18, width: 7, height: 16, borderRadius: 4 },
});
