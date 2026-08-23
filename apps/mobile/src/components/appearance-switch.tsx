import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { track } from '@/lib/analytics';
import { useAppearance } from '@/store/appearance';
import { useTheme } from '@/theme/theme-provider';

/**
 * Оформление одним тумблером: состояний всего два, а тумблер — самая крупная
 * и понятная цель для пальца. Строка такая же, как у уведомлений рядом.
 */
export function AppearanceSwitch() {
  const theme = useTheme();
  const mode = useAppearance((state) => state.mode);
  const choose = useAppearance((state) => state.set);

  const dark = mode === 'dark';

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
        <Ionicons name={dark ? 'moon' : 'sunny'} size={18} color={theme.colors.brand} />
      </View>

      <View style={styles.grow}>
        <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
          Тёмное оформление
        </Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
          {dark ? 'Включено' : 'Приложение светлое'}
        </Text>
      </View>

      <Switch
        value={dark}
        onValueChange={(next) => {
          choose(next ? 'dark' : 'light');
          track('appearance_changed', { mode: next ? 'dark' : 'light' });
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
