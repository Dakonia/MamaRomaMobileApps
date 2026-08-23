import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme-provider';

type Props = {
  title: string;
  subtitle?: string;
  /** Окно закрывается свайпом — палочка сверху это показывает. */
  grabber?: boolean;
  onClose?: () => void;
  /** Раздел, в который зашли вглубь: стрелка возвращает на предыдущий экран. */
  onBack?: () => void;
};

/** Палочка-подсказка «потяните вниз». Живёт отдельно, чтобы её можно было
 *  положить и поверх карты, где обычной шапки нет. */
export function Grabber() {
  const theme = useTheme();

  return (
    <View style={styles.grabberBox}>
      <View
        style={{
          width: 40,
          height: 5,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.borderStrong,
        }}
      />
    </View>
  );
}

export function ScreenHeader({ title, subtitle, grabber, onClose, onBack }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        {
          // У окна свои скруглённые углы сверху, отступ безопасной зоны там лишний
          paddingTop: grabber ? theme.spacing.sm : insets.top + theme.spacing.sm,
          paddingHorizontal: theme.layout.screenPadding,
          paddingBottom: theme.spacing.base,
          backgroundColor: theme.colors.background,
          borderBottomColor: theme.colors.divider,
        },
      ]}
    >
      {grabber ? <Grabber /> : null}

      {onClose ?? onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={onBack ? 'Назад' : 'Закрыть'}
          hitSlop={theme.hitSlop}
          onPress={onBack ?? onClose}
          style={[
            styles.close,
            {
              width: theme.layout.minTouchTarget,
              height: theme.layout.minTouchTarget,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.surfaceSunken,
              marginBottom: theme.spacing.md,
            },
          ]}
        >
          <Ionicons
            name={onBack ? 'chevron-back' : 'close'}
            size={22}
            color={theme.colors.textPrimary}
          />
        </Pressable>
      ) : null}

      <Text style={[theme.typography.h1, { color: theme.colors.textPrimary }]}>{title}</Text>
      {subtitle ? (
        <Text
          style={[
            theme.typography.body,
            { color: theme.colors.textSecondary, marginTop: theme.spacing.xxs },
          ]}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  grabberBox: { alignSelf: 'stretch', alignItems: 'center', paddingBottom: 12 },
  close: { alignItems: 'center', justifyContent: 'center' },
});
