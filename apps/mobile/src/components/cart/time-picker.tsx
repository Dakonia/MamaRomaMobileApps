import { ScrollView, StyleSheet } from 'react-native';
import { Text } from '@/components/text';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/pressable-scale';
import { useTheme } from '@/theme/theme-provider';
import { pieces } from '@/components/cart/shared';

export function TimePicker({
  slots,
  value,
  onChange,
}: {
  slots: { iso: string | null; label: string }[];
  value: string | null;
  onChange: (iso: string | null) => void;
}) {
  const theme = useTheme();

  // Лента вбок вместо переноса: дюжина слотов занимала пол-экрана
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: theme.spacing.sm, paddingRight: theme.spacing.base }}
    >
      {slots.map((slot) => {
        const picked = slot.iso === value;

        return (
          <PressableScale
            key={slot.label}
            depth={0.95}
            accessibilityLabel={slot.label}
            onPress={() => onChange(slot.iso)}
            style={[
              pieces.line,
              {
                gap: theme.spacing.xxs,
                paddingHorizontal: theme.spacing.base,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.radius.pill,
                borderWidth: picked ? 1.5 : StyleSheet.hairlineWidth,
                borderColor: picked ? theme.colors.brand : theme.colors.border,
                backgroundColor: picked ? theme.colors.brandSubtle : theme.colors.surface,
              },
            ]}
          >
            {slot.iso === null ? (
              <Ionicons
                name="flash"
                size={13}
                color={picked ? theme.colors.brand : theme.colors.textTertiary}
              />
            ) : null}
            <Text
              style={[
                theme.typography.bodyMedium,
                { color: picked ? theme.colors.brand : theme.colors.textSecondary },
              ]}
            >
              {slot.label}
            </Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

/** Счётчик приборов. */
