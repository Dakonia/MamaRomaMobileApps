import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { PizzaBackdrop } from '@/components/pizza-backdrop';
import { PressableScale } from '@/components/pressable-scale';
import { PrimaryButton } from '@/components/primary-button';
import { SuccessCheck } from '@/components/success-check';
import { recheck, useOnline } from '@/lib/network';
import { useTheme } from '@/theme/theme-provider';

/** Сколько показываем «связь вернулась», прежде чем уйти с экрана. */
const BACK_MS = 1500;

/** Круги, расходящиеся от значка: приложение ищет сеть, а не замерло. */
function Wave({ index, color }: { index: number; color: string }) {
  const spread = useSharedValue(0);

  useEffect(() => {
    spread.value = withDelay(
      index * 700,
      withRepeat(withTiming(1, { duration: 2100, easing: Easing.out(Easing.quad) }), -1, false),
    );
  }, [index, spread]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.35 * (1 - spread.value),
    transform: [{ scale: 0.7 + spread.value * 1.6 }],
  }));

  return <Animated.View style={[styles.wave, style, { borderColor: color }]} />;
}

/**
 * Экран без связи: занимает всё окно, потому что без интернета в приложении
 * почти ничего не работает — половинчатая плашка только путает. Уходит сам,
 * как только связь появляется, показав, что всё в порядке.
 */
export function OfflineScreen() {
  const theme = useTheme();
  const online = useOnline();

  const [state, setState] = useState<'hidden' | 'offline' | 'back'>('hidden');
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!online) {
      setState('offline');
      return;
    }

    // «Вернулись» показываем только тем, кто до этого потерял связь
    if (state === 'hidden') return;

    setDismissed(false);
    setState('back');
    const timer = setTimeout(() => setState('hidden'), BACK_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const nudge = useSharedValue(0);

  useEffect(() => {
    nudge.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [nudge]);

  const mark = useAnimatedStyle(() => ({
    transform: [{ translateY: -5 * nudge.value }, { scale: 0.98 + nudge.value * 0.04 }],
  }));

  if (state === 'hidden') return null;
  if (state === 'offline' && dismissed) return null;

  const back = state === 'back';

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(260)}
      style={[styles.root, { backgroundColor: theme.colors.backgroundAlt }]}
    >
      <PizzaBackdrop strength={0.5} />

      <View style={[styles.stage, { padding: theme.spacing.xxl, gap: theme.spacing.base }]}>
        {back ? (
          <SuccessCheck color={theme.colors.accent} ringColor={theme.colors.accentSubtle} />
        ) : (
          <View style={styles.mark}>
            {[0, 1, 2].map((index) => (
              <Wave key={index} index={index} color={theme.colors.brand} />
            ))}

            <Animated.View
              style={[
                styles.badge,
                mark,
                { backgroundColor: theme.colors.brandSubtle, borderRadius: theme.radius.pill },
              ]}
            >
              <Ionicons name="cloud-offline-outline" size={40} color={theme.colors.brand} />
            </Animated.View>
          </View>
        )}

        <Animated.Text
          entering={FadeInDown.duration(300).delay(80)}
          style={[theme.typography.h1, styles.center, { color: theme.colors.textPrimary }]}
        >
          {back ? 'Связь вернулась' : 'Нет интернета'}
        </Animated.Text>

        <Animated.Text
          entering={FadeInDown.duration(300).delay(140)}
          style={[theme.typography.body, styles.center, { color: theme.colors.textSecondary }]}
        >
          {back
            ? 'Обновляем меню и продолжаем'
            : 'Проверьте мобильные данные или Wi-Fi — без сети мы не сможем показать актуальные цены и принять заказ.'}
        </Animated.Text>

        {back ? null : (
          <Animated.View
            entering={FadeInDown.duration(300).delay(200)}
            style={{ alignSelf: 'stretch', gap: theme.spacing.md, paddingTop: theme.spacing.sm }}
          >
            <PrimaryButton
              label="Проверить снова"
              loading={checking}
              onPress={() => {
                setChecking(true);
                void recheck().finally(() => setChecking(false));
              }}
            />

            {/* Меню, которое гость уже открывал, лежит на телефоне — пусть смотрит */}
            <PressableScale
              depth={0.99}
              accessibilityLabel="Посмотреть сохранённое меню"
              onPress={() => setDismissed(true)}
              style={[styles.ghost, { minHeight: theme.layout.minTouchTarget }]}
            >
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.textSecondary }]}>
                Посмотреть сохранённое меню
              </Text>
            </PressableScale>
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 40 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  mark: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  badge: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  wave: { position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 1.5 },
  ghost: { alignItems: 'center', justifyContent: 'center' },
});
