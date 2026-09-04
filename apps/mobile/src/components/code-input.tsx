import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/theme-provider';

type Props = {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  invalid?: boolean;
};

type CellProps = {
  digit: string;
  active: boolean;
  invalid: boolean;
};

function Cell({ digit, active, invalid }: CellProps) {
  const theme = useTheme();
  const pop = useSharedValue(0);
  const blink = useSharedValue(1);

  useEffect(() => {
    pop.value = digit ? withSpring(1, { damping: 12, stiffness: 300 }) : withTiming(0, { duration: 120 });
  }, [digit, pop]);

  useEffect(() => {
    blink.value = active
      ? withRepeat(withSequence(withTiming(0.15, { duration: 520 }), withTiming(1, { duration: 520 })), -1, true)
      : withTiming(0, { duration: 120 });
  }, [active, blink]);

  const box = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + 0.04 * pop.value }],
  }));

  const caret = useAnimatedStyle(() => ({ opacity: blink.value }));

  const borderColor = invalid
    ? theme.colors.danger
    : active || digit
      ? theme.colors.brand
      : theme.colors.border;

  return (
    <Animated.View
      style={[
        styles.cell,
        box,
        {
          borderColor,
          borderRadius: theme.radius.lg,
          backgroundColor: digit ? theme.colors.brandSubtle : theme.colors.surfaceSunken,
        },
      ]}
    >
      {digit ? (
        <Text style={[theme.typography.display, { color: theme.colors.textPrimary }]}>{digit}</Text>
      ) : (
        <Animated.View
          style={[styles.caret, caret, { backgroundColor: theme.colors.brand }]}
        />
      )}
    </Animated.View>
  );
}

/**
 * Четыре клетки поверх одного скрытого поля.
 *
 * Автозаполнение работает тремя путями:
 * iOS сам предлагает код над клавиатурой (`textContentType="oneTimeCode"`),
 * Android подставляет его через автозаполнение (`autoComplete="sms-otp"`),
 * а код, скопированный из любого мессенджера, подхватывается из буфера обмена.
 */
export function CodeInput({ value, onChange, length = 4, invalid = false }: Props) {
  const theme = useTheme();
  const input = useRef<TextInput>(null);
  const shift = useSharedValue(0);

  useEffect(() => {
    if (invalid) {
      shift.value = withSequence(
        withTiming(-9, { duration: 50 }),
        withRepeat(withTiming(9, { duration: 90 }), 3, true),
        withTiming(0, { duration: 50 }),
      );
    }
  }, [invalid, shift]);

  const shake = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));

  const takeFromClipboard = useCallback(async () => {
    if (value.length > 0) return;

    try {
      const text = await Clipboard.getStringAsync();
      const found = text.match(/(?<!\d)\d{4}(?!\d)/);
      if (found) onChange(found[0]);
    } catch {
      // Буфер недоступен — не беда, гость наберёт код руками
    }
  }, [onChange, value.length]);

  // Гость уходил в мессенджер за кодом и вернулся — проверяем, не скопировал ли он его.
  // На iOS читаем буфер только по возвращению, иначе система покажет запрос на вставку
  // на пустом месте
  useEffect(() => {
    if (Platform.OS === 'android') void takeFromClipboard();

    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void takeFromClipboard();
    });
    return () => listener.remove();
  }, [takeFromClipboard]);

  const digits = value.padEnd(length, ' ').slice(0, length).split('');

  return (
    <Pressable accessibilityRole="none" onPress={() => input.current?.focus()}>
      <Animated.View style={[styles.row, shake, { gap: theme.spacing.md }]}>
        {digits.map((digit, index) => (
          <Cell
            key={index}
            digit={digit.trim()}
            active={index === Math.min(value.length, length - 1) && value.length < length}
            invalid={invalid}
          />
        ))}
      </Animated.View>

      <TextInput
        ref={input}
        value={value}
        onChangeText={(next) => onChange(next.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        maxLength={length}
        autoFocus
        caretHidden
        style={styles.hidden}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  cell: {
    flex: 1,
    aspectRatio: 0.85,
    maxHeight: 76,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caret: { width: 2, height: 26, borderRadius: 1 },
  hidden: { ...StyleSheet.absoluteFill, opacity: 0 },
});
