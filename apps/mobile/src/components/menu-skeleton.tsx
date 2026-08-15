import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/theme-provider';

const ROWS = [0, 1, 2, 3, 4, 5];

export function MenuSkeleton() {
  const theme = useTheme();
  const block = (width: number | `${number}%`, height: number, radius: number) => (
    <View
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: theme.colors.skeleton,
      }}
    />
  );

  return (
    <View style={{ paddingTop: theme.spacing.base }} accessibilityLabel="Загружаем меню">
      {block(theme.spacing.huge * 2, theme.spacing.lg, theme.radius.sm)}

      {ROWS.map((row) => (
        <View
          key={row}
          style={[
            styles.row,
            {
              paddingVertical: theme.spacing.md,
              paddingHorizontal: theme.layout.screenPadding,
              gap: theme.spacing.base,
            },
          ]}
        >
          {block(theme.spacing.huge + theme.spacing.base, theme.spacing.huge + theme.spacing.base, theme.radius.lg)}
          <View style={[styles.body, { gap: theme.spacing.sm }]}>
            {block('70%', theme.spacing.base, theme.radius.sm)}
            {block('90%', theme.spacing.md, theme.radius.sm)}
            {block('30%', theme.spacing.base, theme.radius.sm)}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  body: { flex: 1 },
});
