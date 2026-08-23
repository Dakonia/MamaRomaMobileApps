import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { formatPrice } from '@/lib/format';

type Props = {
  kopecks: number;
  style?: TextStyle | TextStyle[];
};

/**
 * Сумма перелистывается, а не перерисовывается: при смене цифры старая уходит
 * вверх, новая приезжает снизу — видно, что итог изменился.
 */
export function AnimatedPrice({ kopecks, style }: Props) {
  const [shown, setShown] = useState(kopecks);
  const previous = useRef(kopecks);

  useEffect(() => {
    if (previous.current === kopecks) return;
    previous.current = kopecks;
    setShown(kopecks);
  }, [kopecks]);

  return (
    <View style={styles.root}>
      <Animated.View
        key={shown}
        entering={FadeInDown.duration(220)}
        exiting={FadeOutUp.duration(160)}
      >
        <Text style={style}>{formatPrice(shown)}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden' },
});
