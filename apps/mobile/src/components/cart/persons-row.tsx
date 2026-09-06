import { View } from 'react-native';
import { Text } from '@/components/text';
import { Ionicons } from '@expo/vector-icons';
import { formatPrice } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';
import { StepButton, pieces } from '@/components/cart/shared';

export function PersonsRow({
  value,
  priceKopecks,
  onChange,
}: {
  value: number;
  priceKopecks: number;
  onChange: (value: number) => void;
}) {
  const theme = useTheme();

  return (
    <View
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
      <Ionicons name="restaurant-outline" size={18} color={theme.colors.textSecondary} />

      <View style={pieces.grow}>
        <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
          Приборы
        </Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
          {value === 0
            ? 'Не нужны — бережём природу'
            : `${value} × ${formatPrice(priceKopecks)} = ${formatPrice(value * priceKopecks)}`}
        </Text>
      </View>

      <View
        style={[
          pieces.stepper,
          {
            gap: theme.spacing.xs,
            padding: theme.spacing.xxs,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.surfaceSunken,
          },
        ]}
      >
        <StepButton
          icon="remove"
          tone={theme.colors.textSecondary}
          label="Меньше приборов"
          onPress={() => onChange(Math.max(0, value - 1))}
        />
        <Text
          style={[
            theme.typography.bodyMedium,
            { color: theme.colors.textPrimary, minWidth: 18, textAlign: 'center' },
          ]}
        >
          {value}
        </Text>
        <StepButton
          icon="add"
          tone={theme.colors.brand}
          label="Больше приборов"
          onPress={() => onChange(Math.min(20, value + 1))}
        />
      </View>
    </View>
  );
}

/** Выбор способа оплаты и сдача для наличных. Пока не выбрано — value равен null. */
