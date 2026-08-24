import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { useTheme } from '@/theme/theme-provider';

export type SheetPoint = { icon: keyof typeof Ionicons.glyphMap; text: string };

type Props = {
  visible: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  /** Что именно произойдёт: короткий список с иконками. */
  points?: SheetPoint[];
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  loading?: boolean;
  /** Необратимое действие: кнопку нужно удержать, случайно не нажмётся. */
  hold?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
};

/** Кнопка с удержанием: пока палец держат, заливка доходит до края и срабатывает. */
function HoldButton({
  label,
  tone,
  loading,
  onDone,
}: {
  label: string;
  tone: string;
  loading?: boolean;
  onDone: () => void;
}) {
  const theme = useTheme();
  const held = useSharedValue(0);

  const fill = useAnimatedStyle(() => ({ width: `${held.value * 100}%` }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={loading}
      onPressIn={() => {
        held.value = withTiming(
          1,
          { duration: 1500, easing: Easing.linear },
          (finished) => {
            if (finished) runOnJS(onDone)();
          },
        );
      }}
      onPressOut={() => {
        held.value = withTiming(0, { duration: 220 });
      }}
      style={{
        minHeight: theme.layout.minTouchTarget + theme.spacing.xs,
        borderRadius: theme.radius.pill,
        borderWidth: 1.5,
        borderColor: tone,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: loading ? 0.6 : 1,
      }}
    >
      <Animated.View style={[styles.hold, fill, { backgroundColor: tone }]} />

      <Text style={[theme.typography.button, { color: tone }]}>
        {loading ? 'Удаляем…' : label}
      </Text>
    </Pressable>
  );
}

/**
 * Окно подтверждения снизу: знак в круге с живым ореолом, разбор последствий
 * списком и две кнопки. Системный Alert тут не годится — он приходит чужими
 * шрифтами и ничего не объясняет.
 */
export function ConfirmSheet({
  visible,
  icon,
  title,
  description,
  points,
  confirmLabel,
  cancelLabel,
  danger,
  loading,
  hold,
  onConfirm,
  onCancel,
  children,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pulse = useSharedValue(0);

  const tone = danger ? theme.colors.danger : theme.colors.brand;
  const toneSubtle = danger ? theme.colors.dangerSubtle : theme.colors.brandSubtle;

  useEffect(() => {
    if (!visible) return;

    pulse.value = withRepeat(
      withSequence(withTiming(1, { duration: 1100 }), withTiming(0, { duration: 1100 })),
      -1,
      false,
    );
  }, [pulse, visible]);

  const halo = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - pulse.value),
    transform: [{ scale: 1 + pulse.value * 0.55 }],
  }));

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
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(140)}
        style={[styles.scrim, { backgroundColor: theme.colors.scrim }]}
      >
        <Pressable style={styles.grow} onPress={onCancel} accessibilityLabel="Закрыть" />

        <Animated.View
          entering={SlideInDown.duration(280)}
          exiting={SlideOutDown.duration(200)}
          style={{
            paddingHorizontal: theme.layout.screenPadding,
            paddingTop: theme.spacing.lg,
            paddingBottom: insets.bottom + theme.spacing.lg,
            borderTopLeftRadius: theme.radius.xxl,
            borderTopRightRadius: theme.radius.xxl,
            backgroundColor: theme.colors.surface,
            gap: theme.spacing.base,
          }}
        >
          <View style={styles.center}>
            <View style={styles.mark}>
              <Animated.View
                style={[styles.halo, halo, { backgroundColor: toneSubtle }]}
              />
              <View style={[styles.badge, { backgroundColor: toneSubtle }]}>
                <Ionicons name={icon} size={30} color={tone} />
              </View>
            </View>
          </View>

          <View style={{ gap: theme.spacing.xs }}>
            <Text style={[theme.typography.h2, styles.center, { color: theme.colors.textPrimary }]}>
              {title}
            </Text>
            <Text
              style={[theme.typography.body, styles.center, { color: theme.colors.textSecondary }]}
            >
              {description}
            </Text>
          </View>

          {points && points.length > 0 ? (
            <View
              style={{
                padding: theme.spacing.base,
                borderRadius: theme.radius.xl,
                backgroundColor: theme.colors.surfaceSunken,
                gap: theme.spacing.sm,
              }}
            >
              {points.map((point) => (
                <View key={point.text} style={[styles.row, { gap: theme.spacing.md }]}>
                  <Ionicons name={point.icon} size={16} color={tone} />
                  <Text
                    style={[theme.typography.caption, styles.grow, { color: theme.colors.textPrimary }]}
                  >
                    {point.text}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {children}

          <View style={{ gap: theme.spacing.sm }}>
            {hold ? (
              <HoldButton label={confirmLabel} tone={tone} loading={loading} onDone={onConfirm} />
            ) : (
              <PrimaryButton
                label={confirmLabel}
                tone={danger ? 'danger' : 'brand'}
                loading={loading}
                onPress={onConfirm}
              />
            )}
            <PrimaryButton label={cancelLabel} tone="ghost" onPress={onCancel} />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', textAlign: 'center' },
  mark: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 64, height: 64, borderRadius: 32 },
  hold: { position: 'absolute', left: 0, top: 0, bottom: 0, opacity: 0.22 },
});
