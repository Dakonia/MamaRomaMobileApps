import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useTheme } from '@/theme/theme-provider';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  tone?: 'brand' | 'ghost' | 'danger';
};

export function PrimaryButton({ label, onPress, loading, disabled, tone = 'brand' }: Props) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const blocked = Boolean(disabled ?? loading);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const ghost = tone === 'ghost';
  const danger = tone === 'danger';

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.97, { damping: 20, stiffness: 340 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 14, stiffness: 260 });
      }}
      style={[
        styles.root,
        animated,
        {
          minHeight: theme.layout.minTouchTarget + theme.spacing.sm,
          borderRadius: theme.radius.pill,
          backgroundColor: ghost ? 'transparent' : danger ? theme.colors.danger : theme.colors.brand,
          borderWidth: ghost ? 1.5 : 0,
          borderColor: theme.colors.border,
          opacity: blocked ? 0.5 : 1,
        },
      ]}
    >
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        {loading ? (
          <ActivityIndicator color={ghost ? theme.colors.brand : theme.colors.onDanger} />
        ) : null}
        <Text
          style={[
            theme.typography.button,
            { color: ghost ? theme.colors.textPrimary : danger ? theme.colors.onDanger : theme.colors.textOnBrand },
          ]}
        >
          {label}
        </Text>
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
