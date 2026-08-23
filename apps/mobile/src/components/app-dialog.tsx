import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';

import { PrimaryButton } from '@/components/primary-button';
import { useTheme } from '@/theme/theme-provider';

type Props = {
  visible: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Своё окно подтверждения вместо системного: системное приходит чужими
 * шрифтами и синими кнопками, а это — в наших цветах и с анимацией.
 */
export function AppDialog({
  visible,
  icon = 'help-circle',
  title,
  description,
  confirmLabel,
  cancelLabel = 'Отмена',
  danger,
  onConfirm,
  onCancel,
}: Props) {
  const theme = useTheme();

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onCancel}>
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(140)}
        style={[styles.veil, { backgroundColor: theme.colors.overlay }]}
      >
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Закрыть" onPress={onCancel} />

        <Animated.View
          entering={ZoomIn.springify().damping(18).stiffness(220)}
          exiting={ZoomOut.duration(140)}
          style={[
            styles.card,
            theme.elevation.raised,
            {
              padding: theme.spacing.xl,
              gap: theme.spacing.md,
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
                backgroundColor: danger ? theme.colors.dangerSubtle : theme.colors.brandSubtle,
              },
            ]}
          >
            <Ionicons
              name={icon}
              size={26}
              color={danger ? theme.colors.danger : theme.colors.brand}
            />
          </View>

          <Text style={[theme.typography.h2, styles.center, { color: theme.colors.textPrimary }]}>
            {title}
          </Text>

          {description ? (
            <Text
              style={[theme.typography.body, styles.center, { color: theme.colors.textSecondary }]}
            >
              {description}
            </Text>
          ) : null}

          <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.xs }}>
            <PrimaryButton
              label={confirmLabel}
              tone={danger ? 'danger' : 'brand'}
              onPress={onConfirm}
            />
            <PrimaryButton label={cancelLabel} tone="ghost" onPress={onCancel} />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  veil: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 380, alignItems: 'stretch' },
  badge: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
});
