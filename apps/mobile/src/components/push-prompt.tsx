import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { track } from '@/lib/analytics';
import { enablePush, pushAllowed } from '@/lib/push';
import { useTheme } from '@/theme/theme-provider';

/**
 * Предложение включить уведомления. Показываем не при первом запуске, а когда
 * заказ уже оформлен: в этот момент гостю правда интересно, когда выедет
 * курьер, и разрешение дают охотнее.
 */
export function PushPrompt() {
  const theme = useTheme();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushAllowed().then((allowed) => setShow(!allowed));
  }, []);

  if (!show) return null;

  const ask = () => {
    setBusy(true);

    void enablePush(true).then((token) => {
      track('push_prompt', { allowed: token !== null });
      setBusy(false);
      if (token) setShow(false);
    });
  };

  return (
    <Animated.View
      entering={FadeInDown.duration(320)}
      exiting={FadeOut.duration(200)}
      style={[
        styles.root,
        {
          padding: theme.spacing.base,
          borderRadius: theme.radius.xl,
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          gap: theme.spacing.md,
        },
      ]}
    >
      <View
        style={[
          styles.icon,
          {
            width: theme.spacing.xxl,
            height: theme.spacing.xxl,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.brandSubtle,
          },
        ]}
      >
        <Ionicons name="notifications-outline" size={18} color={theme.colors.brand} />
      </View>

      <View style={styles.grow}>
        <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
          Сообщить, когда поедет?
        </Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
          Напишем, когда ресторан примет заказ и курьер выедет
        </Text>
      </View>

      <PressableScale
        depth={0.94}
        accessibilityLabel="Включить уведомления"
        onPress={ask}
        style={{
          paddingHorizontal: theme.spacing.base,
          paddingVertical: theme.spacing.sm,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.brand,
          opacity: busy ? 0.6 : 1,
        }}
      >
        <Text style={[theme.typography.bodyMedium, { color: theme.colors.textOnBrand }]}>
          Включить
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  icon: { alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
});
