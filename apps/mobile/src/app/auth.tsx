import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { api, ApiError } from '@/api/client';
import { tenant } from '@/lib/tenant';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

const phoneForm = z.object({
  phone: z.string().min(10, 'Введите номер целиком'),
});

const codeForm = z.object({
  code: z.string().length(4, 'Код состоит из четырёх цифр'),
});

type PhoneValues = z.infer<typeof phoneForm>;
type CodeValues = z.infer<typeof codeForm>;

export default function AuthScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const signIn = useSession((state) => state.signIn);

  const [phone, setPhone] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const phoneControl = useForm<PhoneValues>({
    resolver: zodResolver(phoneForm),
    defaultValues: { phone: '' },
  });

  const codeControl = useForm<CodeValues>({
    resolver: zodResolver(codeForm),
    defaultValues: { code: '' },
  });

  const requestCode = useMutation({
    mutationFn: (values: PhoneValues) => api.requestCode(values.phone),
    onSuccess: (result) => {
      setFailure(null);
      setPhone(result.phone);
      if (result.debug_code) {
        codeControl.setValue('code', result.debug_code);
      }
    },
    onError: (error: ApiError) => setFailure(error.message),
  });

  const verifyCode = useMutation({
    mutationFn: (values: CodeValues) => api.verifyCode(phone ?? '', values.code),
    onSuccess: async (session) => {
      await signIn(session);
      router.back();
    },
    onError: (error: ApiError) => setFailure(error.message),
  });

  const busy = requestCode.isPending || verifyCode.isPending;

  const field = (
    value: string,
    onChange: (next: string) => void,
    placeholder: string,
    keyboard: 'phone-pad' | 'number-pad',
    maxLength?: number,
  ) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.textTertiary}
      keyboardType={keyboard}
      maxLength={maxLength}
      autoFocus
      style={[
        theme.typography.bodyLg,
        {
          color: theme.colors.textPrimary,
          backgroundColor: theme.colors.surfaceSunken,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.base,
          minHeight: theme.layout.minTouchTarget + theme.spacing.xs,
        },
      ]}
    />
  );

  const submitButton = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: theme.layout.minTouchTarget + theme.spacing.xs,
          borderRadius: theme.radius.pill,
          backgroundColor: pressed ? theme.colors.brandPressed : theme.colors.brand,
          opacity: busy ? 0.6 : 1,
        },
      ]}
    >
      <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>{label}</Text>
    </Pressable>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: theme.colors.background }]}
    >
      <View
        style={{
          flex: 1,
          padding: theme.layout.screenPadding,
          paddingTop: insets.top + theme.spacing.xl,
          gap: theme.spacing.base,
        }}
      >
        <Text style={[theme.typography.h1, { color: theme.colors.textPrimary }]}>
          {phone === null ? 'Вход по номеру' : 'Код из SMS'}
        </Text>

        <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
          {phone === null
            ? `Начислим ${tenant.loyalty.welcomeBonus} приветственных баллов — их можно потратить на первый заказ.`
            : `Отправили код на ${phone}. Он действует пять минут.`}
        </Text>

        {phone === null ? (
          <Controller
            control={phoneControl.control}
            name="phone"
            render={({ field: { value, onChange } }) =>
              field(value, onChange, '+7 (999) 123-45-67', 'phone-pad')
            }
          />
        ) : (
          <Controller
            control={codeControl.control}
            name="code"
            render={({ field: { value, onChange } }) =>
              field(value, onChange, '0000', 'number-pad', 4)
            }
          />
        )}

        {(phoneControl.formState.errors.phone ?? codeControl.formState.errors.code) || failure ? (
          <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>
            {failure ??
              phoneControl.formState.errors.phone?.message ??
              codeControl.formState.errors.code?.message}
          </Text>
        ) : null}

        {phone === null
          ? submitButton(
              requestCode.isPending ? 'Отправляем…' : 'Получить код',
              phoneControl.handleSubmit((values) => requestCode.mutate(values)),
            )
          : submitButton(
              verifyCode.isPending ? 'Проверяем…' : 'Войти',
              codeControl.handleSubmit((values) => verifyCode.mutate(values)),
            )}

        {phone !== null ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={theme.hitSlop}
            onPress={() => {
              setPhone(null);
              setFailure(null);
            }}
            style={[styles.secondary, { paddingVertical: theme.spacing.sm }]}
          >
            <Text style={[theme.typography.bodyMedium, { color: theme.colors.brand }]}>
              Изменить номер
            </Text>
          </Pressable>
        ) : null}

        <Text
          style={[
            theme.typography.caption,
            styles.legal,
            { color: theme.colors.textTertiary, marginTop: theme.spacing.sm },
          ]}
        >
          Продолжая, вы соглашаетесь на обработку персональных данных.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: { alignItems: 'center' },
  legal: { textAlign: 'center' },
});
