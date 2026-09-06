import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { useTheme } from '@/theme/theme-provider';

export function StepButton({
  icon,
  tone,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const scale = useSharedValue(1);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <Animated.View style={animated}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={theme.spacing.sm}
        onPressIn={() => {
          scale.set(withSpring(0.86, { damping: 18, stiffness: 400 }));
        }}
        onPressOut={() => {
          scale.set(withSpring(1, { damping: 12, stiffness: 260 }));
        }}
        onPress={onPress}
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surface,
        }}
      >
        <Ionicons name={icon} size={18} color={tone} />
      </Pressable>
    </Animated.View>
  );
}

/** Красная кнопка под строкой: появляется при смахивании влево. */
export function RemoveAction({
  progress,
  onRemove,
}: {
  progress: SharedValue<number>;
  onRemove: () => void;
}) {
  const theme = useTheme();

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: 88 * (1 - Math.min(progress.value, 1)) }],
  }));

  return (
    <Animated.View style={[style, { width: 88 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Убрать из корзины"
        onPress={onRemove}
        style={({ pressed }) => [
          pieces.fill,
          { gap: 4, backgroundColor: theme.colors.danger, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Ionicons name="trash" size={22} color={theme.colors.onDanger} />
        <Text style={[theme.typography.caption, { color: theme.colors.onDanger }]}>Убрать</Text>
      </Pressable>
    </Animated.View>
  );
}

/** Строка корзины: фотография, цена за штуку и крупный счётчик. */

/** Раскладки, общие для кусков корзины. */
export const pieces = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  grow: { flex: 1 },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { alignItems: 'center', justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill2: { height: 6, borderRadius: 3 },
});
