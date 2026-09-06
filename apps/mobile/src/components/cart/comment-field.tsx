import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Text, TextInput } from '@/components/text';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/pressable-scale';
import { useTheme } from '@/theme/theme-provider';
import { pieces } from '@/components/cart/shared';

export function CommentField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(value.length > 0);

  if (!open) {
    return (
      <PressableScale
        depth={0.98}
        accessibilityLabel="Добавить комментарий"
        onPress={() => setOpen(true)}
        style={[
          pieces.line,
          {
            gap: theme.spacing.md,
            padding: theme.spacing.base,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surface,
          },
        ]}
      >
        <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.colors.brand} />
        <Text style={[theme.typography.bodyMedium, pieces.grow, { color: theme.colors.textPrimary }]}>
          Комментарий к заказу
        </Text>
        <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
      </PressableScale>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(160)} style={{ gap: theme.spacing.xs }}>
      <View style={[pieces.line, { gap: theme.spacing.sm }]}>
        <Ionicons name="chatbubble-ellipses" size={16} color={theme.colors.brand} />
        <Text style={[theme.typography.bodyMedium, pieces.grow, { color: theme.colors.textPrimary }]}>
          Комментарий к заказу
        </Text>
        {value.length === 0 ? (
          <Pressable accessibilityRole="button" hitSlop={theme.hitSlop} onPress={() => setOpen(false)}>
            <Ionicons name="close" size={18} color={theme.colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      <TextInput
        value={value}
        onChangeText={onChange}
        autoFocus
        multiline
        placeholder="Что учесть курьеру и кухне"
        placeholderTextColor={theme.colors.textTertiary}
        style={[
          theme.typography.body,
          {
            color: theme.colors.textPrimary,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            padding: theme.spacing.base,
            minHeight: theme.layout.minTouchTarget + theme.spacing.lg,
            textAlignVertical: 'top',
          },
        ]}
      />
    </Animated.View>
  );
}
