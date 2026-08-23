import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOutUp, SlideInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { useAppUpdate } from '@/lib/updates';
import { useTheme } from '@/theme/theme-provider';

/**
 * Плашка «есть обновление»: код уже скачан, остаётся перезапустить экран.
 * Сами не перезапускаем — гость может стоять на оформлении заказа.
 */
export function UpdateReady() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const update = useAppUpdate();

  if (!update.ready) return null;

  return (
    <Animated.View
      entering={SlideInUp.duration(320)}
      exiting={FadeOutUp.duration(200)}
      style={[
        styles.root,
        theme.elevation.card,
        {
          top: insets.top + theme.spacing.xs,
          marginHorizontal: theme.layout.screenPadding,
          paddingLeft: theme.spacing.base,
          paddingRight: theme.spacing.xs,
          paddingVertical: theme.spacing.xs,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.hero,
          gap: theme.spacing.sm,
        },
      ]}
    >
      <Ionicons name="sparkles" size={16} color={theme.colors.onHero} />

      <Text style={[theme.typography.bodyMedium, styles.grow, { color: theme.colors.onHero }]}>
        Приложение обновилось
      </Text>

      <PressableScale
        depth={0.94}
        accessibilityLabel="Применить обновление"
        onPress={update.apply}
        style={[
          styles.button,
          {
            paddingHorizontal: theme.spacing.base,
            paddingVertical: theme.spacing.xs,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.onHero,
          },
        ]}
      >
        <Text style={[theme.typography.bodyMedium, { color: theme.colors.hero }]}>Применить</Text>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
  },
  grow: { flex: 1 },
  button: { alignItems: 'center', justifyContent: 'center' },
});
