import { forwardRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/theme-provider';

type Props = TextInputProps & {
  label: string;
  hint?: string;
  error?: string | null;
  /** Ширина в ряду: поле «Дом» уже, чем «Улица». */
  flex?: number;
};

/**
 * Поле с подписью над значением. Подпись стоит на своём месте всегда — она не
 * ездит и не подкладывается под текст, поэтому цифры дома ни на что не налезают.
 * Живёт только рамка: в фокусе она перекрашивается в терракоту.
 */
export const TextField = forwardRef<TextInput, Props>(function TextField(
  { label, hint, error, flex, style, onFocus, onBlur, value, placeholder, ...rest },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  const active = useDerivedValue(() =>
    withTiming(focused ? 1 : 0, { duration: theme.motion.duration.fast }),
  );

  const box = useAnimatedStyle(() => ({
    borderColor: error
      ? theme.colors.danger
      : interpolateColor(active.value, [0, 1], [theme.colors.border, theme.colors.brand]),
    backgroundColor: interpolateColor(
      active.value,
      [0, 1],
      [theme.colors.surfaceSunken, theme.colors.surface],
    ),
  }));

  const caption = useAnimatedStyle(() => ({
    color: error
      ? theme.colors.danger
      : interpolateColor(active.value, [0, 1], [theme.colors.textTertiary, theme.colors.brand]),
  }));

  return (
    <View style={{ flex, gap: theme.spacing.xxs }}>
      <Animated.View
        style={[
          box,
          {
            borderRadius: theme.radius.lg,
            borderWidth: 1.5,
            paddingHorizontal: theme.spacing.base,
            paddingTop: theme.spacing.sm,
            paddingBottom: theme.spacing.md,
            gap: theme.spacing.xxs,
          },
        ]}
      >
        <Animated.Text numberOfLines={1} style={[theme.typography.overline, caption]}>
          {label}
        </Animated.Text>

        <TextInput
          ref={ref}
          value={value}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textTertiary}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            theme.typography.bodyLg,
            styles.input,
            { color: theme.colors.textPrimary },
            rest.multiline ? styles.multiline : null,
            style,
          ]}
          {...rest}
        />
      </Animated.View>

      {error ?? hint ? (
        <Text
          style={[
            theme.typography.caption,
            {
              color: error ? theme.colors.danger : theme.colors.textTertiary,
              paddingHorizontal: theme.spacing.xs,
            },
          ]}
        >
          {error ?? hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  // Своя высота вместо системных отступов: иначе iOS и Android считают её по-разному
  input: { padding: 0, minHeight: 24, textAlignVertical: 'center' },
  multiline: { minHeight: 66, textAlignVertical: 'top' },
});
