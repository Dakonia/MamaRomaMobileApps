import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { PizzaBackdrop } from '@/components/pizza-backdrop';
import { PrimaryButton } from '@/components/primary-button';
import { needsUpdate, storeUrl } from '@/lib/version';
import { useTheme } from '@/theme/theme-provider';

/**
 * Заслон для устаревших сборок: когда API уходит вперёд, старое приложение
 * начинает молча ломаться в самых неожиданных местах. Лучше честно попросить
 * обновиться, чем показывать гостю ошибки, которых он не понимает.
 */
export function UpdateGate() {
  const theme = useTheme();
  const float = useSharedValue(0);

  useEffect(() => {
    float.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [float]);

  const arrow = useAnimatedStyle(() => ({
    transform: [{ translateY: -6 * float.value }],
  }));

  const halo = useAnimatedStyle(() => ({
    opacity: 0.4 * (1 - float.value),
    transform: [{ scale: 1 + float.value * 0.5 }],
  }));

  if (!needsUpdate()) return null;

  const url = storeUrl();

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      style={[styles.root, { backgroundColor: theme.colors.backgroundAlt }]}
    >
      <PizzaBackdrop strength={0.5} />

      <View style={[styles.stage, { padding: theme.spacing.xxl, gap: theme.spacing.base }]}>
        <View style={styles.mark}>
          <Animated.View
            style={[styles.halo, halo, { backgroundColor: theme.colors.brandSubtle }]}
          />
          <Animated.View
            style={[
              styles.badge,
              arrow,
              { backgroundColor: theme.colors.brandSubtle, borderRadius: theme.radius.pill },
            ]}
          >
            <Ionicons name="arrow-up-circle" size={40} color={theme.colors.brand} />
          </Animated.View>
        </View>

        <Animated.Text
          entering={FadeInDown.duration(320).delay(120)}
          style={[theme.typography.h1, styles.center, { color: theme.colors.textPrimary }]}
        >
          Нужно обновить приложение
        </Animated.Text>

        <Animated.Text
          entering={FadeInDown.duration(320).delay(180)}
          style={[theme.typography.body, styles.center, { color: theme.colors.textSecondary }]}
        >
          Эта версия больше не работает с нашим сервером: меню, цены и заказы в ней могут
          показываться неверно. Обновление займёт минуту.
        </Animated.Text>

        {url ? (
          <Animated.View
            entering={FadeInDown.duration(320).delay(240)}
            style={{ alignSelf: 'stretch', paddingTop: theme.spacing.sm }}
          >
            <PrimaryButton label="Обновить" onPress={() => void Linking.openURL(url)} />
          </Animated.View>
        ) : (
          <Text style={[theme.typography.caption, styles.center, { color: theme.colors.textTertiary }]}>
            Обновите приложение в магазине, откуда его установили.
          </Text>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, zIndex: 50 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  mark: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center' },
  badge: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 88, height: 88, borderRadius: 44 },
});
