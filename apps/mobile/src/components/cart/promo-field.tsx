import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/text';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/pressable-scale';
import { useTheme } from '@/theme/theme-provider';
import { pieces } from '@/components/cart/shared';

export function PromoField({
  value,
  onApply,
  applied,
  error,
  onClear,
}: {
  value: string;
  onApply: (code: string) => void;
  applied: string | null;
  error: string | null;
  onClear: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState(value);

  if (applied !== null) {
    return (
      <View
        style={[
          pieces.line,
          {
            gap: theme.spacing.md,
            padding: theme.spacing.base,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.successSubtle,
          },
        ]}
      >
        <Ionicons name="pricetag" size={18} color={theme.colors.success} />
        <Text style={[theme.typography.bodyMedium, pieces.grow, { color: theme.colors.success }]}>
          Промокод {applied} применён
        </Text>
        <Pressable accessibilityRole="button" hitSlop={theme.hitSlop} onPress={onClear}>
          <Ionicons name="close-circle" size={20} color={theme.colors.success} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <View style={[pieces.line, { gap: theme.spacing.sm }]}>
        <TextInput
          value={draft}
          onChangeText={(text) => setDraft(text.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="Промокод"
          placeholderTextColor={theme.colors.textTertiary}
          style={[
            theme.typography.body,
            pieces.grow,
            {
              color: theme.colors.textPrimary,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: error ? theme.colors.danger : theme.colors.border,
              paddingHorizontal: theme.spacing.base,
              minHeight: theme.layout.minTouchTarget,
            },
          ]}
        />

        <PressableScale
          depth={0.95}
          accessibilityLabel="Применить промокод"
          onPress={() => onApply(draft)}
          style={{
            paddingHorizontal: theme.spacing.lg,
            minHeight: theme.layout.minTouchTarget,
            borderRadius: theme.radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: draft.length > 2 ? theme.colors.brand : theme.colors.border,
          }}
        >
          <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
            Применить
          </Text>
        </PressableScale>
      </View>

      {error ? (
        <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>{error}</Text>
      ) : null}
    </View>
  );
}

/** Карточка баллов: сумма к списанию крупно, переключатель с бегунком. */
