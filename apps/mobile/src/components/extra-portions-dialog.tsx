import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';

import { ExtraIcon } from '@/components/extra-icon';
import { PrimaryButton } from '@/components/primary-button';
import { formatPrice, plural } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';

type Props = {
  visible: boolean;
  title: string;
  priceKopecks: number;
  /** Сколько порций в заказе вообще можно дополнить. */
  max: number;
  value: number;
  onChange: (value: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Окно «сколько порций»: в заказе бывает несколько паст и ризотто. */
export function ExtraPortionsDialog({
  visible,
  title,
  priceKopecks,
  max,
  value,
  onChange,
  onConfirm,
  onCancel,
}: Props) {
  const theme = useTheme();

  const step = (next: number) => {
    if (next < 1 || next > max) return;
    void Haptics.selectionAsync();
    onChange(next);
  };

  const button = (icon: keyof typeof Ionicons.glyphMap, label: string, to: number) => {
    const blocked = to < 1 || to > max;

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: blocked }}
        disabled={blocked}
        hitSlop={theme.spacing.sm}
        onPress={() => step(to)}
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: blocked ? 0.35 : 1,
          backgroundColor: theme.colors.surfaceSunken,
        }}
      >
        <Ionicons name={icon} size={22} color={theme.colors.textPrimary} />
      </Pressable>
    );
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onCancel}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(140)}
        style={[styles.veil, { backgroundColor: theme.colors.overlay }]}
      >
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Закрыть" onPress={onCancel} />

        <Animated.View
          entering={ZoomIn.duration(200)}
          exiting={ZoomOut.duration(140)}
          style={[
            styles.card,
            theme.elevation.raised,
            {
              padding: theme.spacing.xl,
              gap: theme.spacing.base,
              borderRadius: theme.radius.xxl,
              backgroundColor: theme.colors.surface,
            },
          ]}
        >
          <View
            style={[
              styles.badge,
              {
                width: 56,
                height: 56,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.brandSubtle,
              },
            ]}
          >
            <ExtraIcon name={title} size={28} color={theme.colors.brand} />
          </View>

          <Text style={[theme.typography.h2, styles.center, { color: theme.colors.textPrimary }]}>
            {title}
          </Text>
          <Text
            style={[theme.typography.body, styles.center, { color: theme.colors.textSecondary }]}
          >
            {formatPrice(priceKopecks)} за порцию. В заказе {max}{' '}
            {plural(max, 'порция', 'порции', 'порций')}, к которым это подойдёт.
          </Text>

          <View style={[styles.row, { gap: theme.spacing.lg, marginTop: theme.spacing.xs }]}>
            {button('remove', 'Меньше порций', value - 1)}

            <Text
              style={[
                theme.typography.display,
                { color: theme.colors.textPrimary, minWidth: 48, textAlign: 'center' },
              ]}
            >
              {value}
            </Text>

            {button('add', 'Больше порций', value + 1)}
          </View>

          <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.xs }}>
            <PrimaryButton
              label={`Добавить · ${formatPrice(priceKopecks * value)}`}
              onPress={onConfirm}
            />
            <PrimaryButton label="Не нужно" tone="ghost" onPress={onCancel} />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  veil: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 380 },
  badge: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
