import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Switch, Text, View } from 'react-native';

import { track } from '@/lib/analytics';
import { BLOCKED_BY_SETTINGS, disablePush, enablePush, lastPushError, pushAllowed } from '@/lib/push';
import { usePushAsk } from '@/store/push-ask';
import { useTheme } from '@/theme/theme-provider';

/**
 * Уведомления о заказе в профиле.
 *
 * Тумблер показывает выбор гостя, а не разрешение телефона: это разные вещи.
 * Разрешение выдаётся один раз навсегда, а тумблером пользуются как хотят —
 * выключил, и приложение перестаёт слать, не трогая системную настройку.
 * Вернуть после системного отказа можно только в настройках телефона: второй
 * раз система спросить не даст.
 */
export function PushSwitch() {
  const theme = useTheme();
  const wanted = usePushAsk((state) => state.wanted);
  const setWanted = usePushAsk((state) => state.setWanted);

  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const granted = await pushAllowed();
      setAllowed(granted);

      // Токен живёт не вечно — молча обновляем, но только если гость сам не
      // выключил уведомления. Иначе тумблер «включался» бы сам по себе
      if (granted && wanted) {
        const token = await enablePush(false);
        setFailure(token === null ? lastPushError : null);
      }
    })();
  }, [wanted]);

  const toggle = (next: boolean) => {
    setBusy(true);
    setWanted(next);

    void (async () => {
      if (next) {
        const token = await enablePush(true);
        track('push_toggled', { on: token !== null });
        setFailure(token === null ? lastPushError : null);
        setAllowed(token !== null);

        if (token === null) {
          setWanted(false);
          // Система уже отказала раньше — своими силами не вернуть
          void Linking.openSettings();
        }
      } else {
        await disablePush();
        track('push_toggled', { on: false });
        setFailure(null);
      }

      setBusy(false);
    })();
  };

  // Код отказа переводим на человеческий: гостю ни к чему наши метки
  const message =
    failure === BLOCKED_BY_SETTINGS
      ? 'Уведомления запрещены в настройках телефона — включите их там'
      : failure;

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
            {wanted && !allowed
              ? 'Телефон запретил уведомления — включите в его настройках'
              : 'Когда ресторан примет заказ и курьер выедет'}
          </Text>
        </View>

        <Switch
          value={wanted && allowed}
          disabled={busy}
          onValueChange={toggle}
          trackColor={{ false: theme.colors.border, true: theme.colors.brand }}
          thumbColor={theme.colors.surface}
        />
      </View>

      {/* Почему не включилось: без этого причина видна только в отчётах */}
      {message ? (
        <Text style={[theme.typography.caption, styles.hint, { color: theme.colors.danger }]}>
          {message}
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
