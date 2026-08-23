import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
  children: ReactNode;
  onPress: () => void;
  /** Долгое нажатие: быстрый просмотр и другие «загляну, не заходя». */
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** Насколько сильно проседает элемент под пальцем. */
  depth?: number;
  /** Запас вокруг мелкой иконки, чтобы в неё попадал палец. */
  hitSlop?: PressableProps['hitSlop'];
};

/** Нажатие с пружинным откликом — то, чего не хватает обычному Pressable. */
export function PressableScale({
  children,
  onPress,
  onLongPress,
  style,
  accessibilityLabel,
  depth = 0.96,
  hitSlop,
}: Props) {
  const scale = useSharedValue(1);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={hitSlop}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      onPressIn={() => {
        scale.value = withSpring(depth, { damping: 18, stiffness: 320 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 14, stiffness: 260 });
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
