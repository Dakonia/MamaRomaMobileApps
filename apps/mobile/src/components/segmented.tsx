import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/theme-provider';

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

export function Segmented<T extends string>({ options, value, onChange }: Props<T>) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.root,
        {
          padding: theme.spacing.xxs,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surfaceSunken,
        },
      ]}
    >
      {options.map((option) => {
        const active = option.value === value;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[
              styles.option,
              {
                minHeight: theme.layout.minTouchTarget - theme.spacing.sm,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.sm,
                backgroundColor: active ? theme.colors.brand : 'transparent',
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                theme.typography.bodyMedium,
                { color: active ? theme.colors.textOnBrand : theme.colors.textSecondary },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row' },
  option: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
