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
  /**
   * Чем элемент является для озвучки экрана. По умолчанию кнопка, но выбор
   * оплаты, времени или раздела — это не кнопка, а вариант из нескольких, и
   * незрячему гостю нужно слышать, какой из них выбран.
   */
  accessibilityRole?: 'button' | 'radio' | 'tab' | 'link' | 'checkbox';
  /** Состояние варианта: выбран, выключен, раскрыт. */
  accessibilityState?: {
    selected?: boolean;
    disabled?: boolean;
    checked?: boolean;
    expanded?: boolean;
  };
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
  accessibilityRole = 'button',
  accessibilityState,
  depth = 0.96,
  hitSlop,
}: Props) {
  const scale = useSharedValue(1);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <AnimatedPressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      hitSlop={hitSlop}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      onPressIn={() => {
        scale.set(withSpring(depth, { damping: 18, stiffness: 320 }));
      }}
      onPressOut={() => {
        scale.set(withSpring(1, { damping: 14, stiffness: 260 }));
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
