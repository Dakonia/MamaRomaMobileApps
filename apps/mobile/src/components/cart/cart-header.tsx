import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { plural } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';

/**
 * Шапка корзины: назад, заголовок, очистить.
 *
 * Живёт и на пустом экране, и на заполненном — поэтому вынесена отдельно:
 * иначе кнопка «назад» на этих двух экранах расходилась бы по мелочам.
 */
export function CartHeader({
  count,
  delivery,
  onBack,
  onClear,
}: {
  count: number;
  delivery: boolean;
  onBack: () => void;
  onClear: () => void;
}) {
  const theme = useTheme();

  const touch = {
    width: theme.layout.minTouchTarget,
    height: theme.layout.minTouchTarget,
  };

  return (
    <View
      style={[
        styles.line,
        {
          paddingHorizontal: theme.spacing.sm,
          paddingBottom: theme.spacing.sm,
          gap: theme.spacing.xs,
          backgroundColor: theme.colors.backgroundAlt,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.divider,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Назад в меню"
        hitSlop={theme.hitSlop}
        onPress={onBack}
        style={[styles.center, touch]}
      >
        <Ionicons name="chevron-back" size={26} color={theme.colors.textPrimary} />
      </Pressable>

      <View style={styles.grow}>
        <Text style={[theme.typography.h2, { color: theme.colors.textPrimary }]}>Корзина</Text>
        {count > 0 ? (
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            {count} {plural(count, 'позиция', 'позиции', 'позиций')} ·{' '}
            {delivery ? 'доставка' : 'самовывоз'}
          </Text>
        ) : null}
      </View>

      {count > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Очистить корзину"
          hitSlop={theme.hitSlop}
          onPress={onClear}
          style={[styles.center, touch]}
        >
          <Ionicons name="trash-outline" size={20} color={theme.colors.textTertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 },
});
