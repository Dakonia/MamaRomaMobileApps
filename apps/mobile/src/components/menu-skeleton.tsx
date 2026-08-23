import { StyleSheet, View, type DimensionValue } from 'react-native';

import { Skeleton } from '@/components/skeleton';
import { useTheme } from '@/theme/theme-provider';

const CARDS = [0, 1, 2, 3];

/** Заглушка меню: показывает будущую сетку, а не серый экран. */
export function MenuSkeleton() {
  const theme = useTheme();

  const block = (width: DimensionValue, height: number, radius: number) => (
    <Skeleton width={width} height={height} radius={radius} />
  );

  return (
    <View
      accessibilityLabel="Загружаем меню"
      style={{ padding: theme.layout.screenPadding, gap: theme.spacing.lg }}
    >
      {block('100%', theme.spacing.huge * 2, theme.radius.xl)}

      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        {block(theme.spacing.huge + theme.spacing.lg, theme.spacing.xxl, theme.radius.pill)}
        {block(theme.spacing.huge, theme.spacing.xxl, theme.radius.pill)}
        {block(theme.spacing.huge + theme.spacing.sm, theme.spacing.xxl, theme.radius.pill)}
      </View>

      <View style={[styles.grid, { gap: theme.spacing.md }]}>
        {CARDS.map((card) => (
          <View key={card} style={[styles.cell, { gap: theme.spacing.sm }]}>
            {block('100%', theme.spacing.huge * 2.2, theme.radius.xl)}
            {block('80%', theme.spacing.base, theme.radius.sm)}
            {block('45%', theme.spacing.base, theme.radius.sm)}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '47%' },
});
