import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/theme-provider';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ icon, title, description, actionLabel, onAction }: Props) {
  const theme = useTheme();

  return (
    <View style={[styles.root, { padding: theme.spacing.xl, gap: theme.spacing.md }]}>
      <View
        style={[
          styles.iconCircle,
          {
            width: theme.spacing.huge,
            height: theme.spacing.huge,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.brandSubtle,
          },
        ]}
      >
        <Ionicons name={icon} size={theme.spacing.xl} color={theme.colors.brand} />
      </View>

      <Text
        style={[theme.typography.h2, styles.centered, { color: theme.colors.textPrimary }]}
      >
        {title}
      </Text>

      <Text
        style={[theme.typography.body, styles.centered, { color: theme.colors.textSecondary }]}
      >
        {description}
      </Text>

      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          hitSlop={theme.hitSlop}
          style={({ pressed }) => [
            styles.action,
            {
              minHeight: theme.layout.minTouchTarget,
              paddingHorizontal: theme.spacing.xl,
              borderRadius: theme.radius.pill,
              backgroundColor: pressed ? theme.colors.brandPressed : theme.colors.brand,
              marginTop: theme.spacing.xs,
            },
          ]}
        >
          <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: {
    textAlign: 'center',
  },
  action: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
