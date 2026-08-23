import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { api } from '@/api/client';
import { track } from '@/lib/analytics';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

/**
 * Согласие на акции — отдельно от уведомлений о заказе.
 *
 * Разрешение телефона одно на всё, но рекламу гость должен разрешать
 * осознанно: так требует закон о рекламе, и так честнее. Отписался от акций —
 * про своего курьера всё равно узнает.
 */
export function MarketingSwitch() {
  const theme = useTheme();
  const session = useSession();

  const on = session.guest?.marketing_opt_in ?? true;

  const save = useMutation({
    mutationFn: (next: boolean) => api.updateMe({ marketing_opt_in: next }),
    onSuccess: (guest) => session.setGuest(guest),
  });

  return (
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
        <Ionicons name="pricetags-outline" size={18} color={theme.colors.brand} />
      </View>

      <View style={styles.grow}>
        <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
          Акции и новости
        </Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
          Новинки меню и специальные предложения
        </Text>
      </View>

      <Switch
        value={on}
        disabled={save.isPending}
        onValueChange={(next) => {
          track('marketing_toggled', { on: next });
          save.mutate(next);
        }}
        trackColor={{ false: theme.colors.border, true: theme.colors.brand }}
        thumbColor={theme.colors.surface}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
});
