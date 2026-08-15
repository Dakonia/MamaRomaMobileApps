import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme-provider';

type Props = {
  title: string;
  subtitle?: string;
};

export function ScreenHeader({ title, subtitle }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.layout.screenPadding,
          paddingBottom: theme.spacing.base,
          backgroundColor: theme.colors.background,
          borderBottomColor: theme.colors.divider,
        },
      ]}
    >
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
});
