import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Switch, Text, View } from 'react-native';

import { track } from '@/lib/analytics';
import { disablePush, enablePush, pushAllowed, sendTestNotification } from '@/lib/push';
import { useTheme } from '@/theme/theme-provider';

/**
 * Уведомления о заказе в профиле. Выключить можно прямо здесь, а вот вернуть
 * после системного отказа — только в настройках телефона: второй раз система
 * спросить не даст, и честнее отвести туда, чем показывать бесполезный тумблер.
 */
export function PushSwitch() {
  const theme = useTheme();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    void pushAllowed().then(setOn);
  }, []);

  const toggle = (next: boolean) => {
    setBusy(true);
    setOn(next);

    void (async () => {
      if (next) {
        const token = await enablePush(true);
        track('push_toggled', { on: token !== null });

        if (token === null) {
          setOn(false);
          // Система уже отказала раньше — открываем настройки приложения
          void Linking.openSettings();
        }
      } else {
        await disablePush();
        track('push_toggled', { on: false });
      }

      setBusy(false);
    })();
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View
        style={[
          styles.row,
        {
          padding: theme.spacing.base,
          borderRadius: theme.radius.xl,
          backgroundColor: theme.colors.surface,
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
          Уведомления о заказе
        </Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
          Когда ресторан примет заказ и курьер выедет
        </Text>
      </View>

      <Switch
        value={on}
        disabled={busy}
        onValueChange={toggle}
          trackColor={{ false: theme.colors.border, true: theme.colors.brand }}
          thumbColor={theme.colors.surface}
        />
      </View>

      {/* Только на разработке: посмотреть, как уведомление выглядит на телефоне */}
      {__DEV__ && on ? (
        <Text
          onPress={() => void sendTestNotification().then(setSent)}
          style={[
            theme.typography.caption,
            styles.hint,
            { color: sent ? theme.colors.accent : theme.colors.brand },
          ]}
        >
          {sent ? 'Придёт через пять секунд — заблокируйте телефон' : 'Прислать тестовое'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  hint: { textAlign: 'center' },
});
