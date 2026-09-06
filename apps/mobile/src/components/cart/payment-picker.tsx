import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Text, TextInput } from '@/components/text';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/pressable-scale';
import { useTheme } from '@/theme/theme-provider';
import { pieces } from '@/components/cart/shared';
import { PAYMENTS, type PaymentMethod } from '@/components/cart/payments';

export function PaymentPicker({
  value,
  onChange,
  allowOnline,
  changeFrom,
  onChangeFrom,
}: {
  value: PaymentMethod | null;
  onChange: (value: PaymentMethod) => void;
  allowOnline: boolean;
  changeFrom: string;
  onChangeFrom: (value: string) => void;
}) {
  const theme = useTheme();
  const options = PAYMENTS.filter((item) => allowOnline || !item.online);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {options.map((option) => {
        const picked = option.value === value;

        return (
          <View key={option.value} style={{ gap: theme.spacing.sm }}>
            <PressableScale
              depth={0.985}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
              style={[
                pieces.line,
                {
                  gap: theme.spacing.md,
                  padding: theme.spacing.base,
                  borderRadius: theme.radius.lg,
                  borderWidth: picked ? 1.5 : StyleSheet.hairlineWidth,
                  borderColor: picked ? theme.colors.brand : theme.colors.border,
                  backgroundColor: picked ? theme.colors.brandSubtle : theme.colors.surface,
                },
              ]}
            >
              <Ionicons
                name={option.icon}
                size={20}
                color={picked ? theme.colors.brand : theme.colors.textSecondary}
              />

              <View style={pieces.grow}>
                <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                  {option.label}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                  {option.note}
                </Text>
              </View>

              <Ionicons
                name={picked ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={picked ? theme.colors.brand : theme.colors.border}
              />
            </PressableScale>

            {/* Сдача нужна только наличным — и только когда их выбрали */}
            {picked && option.value === 'cash_on_delivery' ? (
              <Animated.View entering={FadeIn.duration(180)}>
                <TextInput
                  value={changeFrom}
                  onChangeText={(text) => onChangeFrom(text.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  placeholder="Сдача с какой суммы, ₽"
                  placeholderTextColor={theme.colors.textTertiary}
                  style={[
                    theme.typography.body,
                    {
                      color: theme.colors.textPrimary,
                      backgroundColor: theme.colors.surfaceSunken,
                      borderRadius: theme.radius.md,
                      paddingHorizontal: theme.spacing.base,
                      minHeight: theme.layout.minTouchTarget,
                    },
                  ]}
                />
              </Animated.View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Поле промокода: результат и ошибку показываем прямо здесь. */
