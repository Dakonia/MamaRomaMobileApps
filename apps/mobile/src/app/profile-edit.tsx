import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, type Guest } from '@/api/client';
import { PizzaBackdrop } from '@/components/pizza-backdrop';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/components/screen-header';
import { TextField } from '@/components/text-field';
import { formatPhone } from '@/lib/phone';
import { useSession } from '@/store/session';
import { keyboardScroll } from '@/lib/keyboard';
import { useTheme } from '@/theme/theme-provider';

const GENDERS = [
  { value: 'female' as const, label: 'Женский' },
  { value: 'male' as const, label: 'Мужской' },
];

/** 15.08.1990 → 1990-08-15. Пустая строка означает «не указано». */
function toIsoBirthday(input: string): string | null {
  const match = input.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function fromIsoBirthday(iso: string | null | undefined): string {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

function maskBirthday(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)]
    .filter((part) => part.length > 0)
    .join('.');
}

export default function ProfileEditScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const session = useSession();

  const [name, setName] = useState(session.guest?.name ?? '');
  const [email, setEmail] = useState(session.guest?.email ?? '');
  const [birthday, setBirthday] = useState(fromIsoBirthday(session.guest?.birthday));
  const [gender, setGender] = useState<Guest['gender']>(session.guest?.gender ?? null);
  const [failure, setFailure] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const iso = birthday.trim().length > 0 ? toIsoBirthday(birthday) : null;
      if (birthday.trim().length > 0 && iso === null) {
        throw new ApiError(0, 'Дата в формате 15.08.1990');
      }
      return api.updateMe({
        name: name.trim().length > 0 ? name.trim() : null,
        email: email.trim().length > 0 ? email.trim() : null,
        birthday: iso,
        gender,
      });
    },
    onSuccess: (guest) => {
      session.setGuest(guest);
      router.back();
    },
    onError: (error: ApiError | Error) => setFailure(error.message),
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: theme.colors.background }]}
    >
      <PizzaBackdrop strength={0.7} />

      <ScreenHeader title="Личные данные" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          paddingBottom: insets.bottom + theme.spacing.xxl,
          gap: theme.spacing.lg,
        }}
        {...keyboardScroll}
      >
        <TextField label="Имя" value={name} onChangeText={setName} autoCapitalize="words" />

        <TextField
          label="Почта"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TextField
          label="День рождения"
          hint="Подарим бонус ко дню рождения"
          value={birthday}
          onChangeText={(next) => setBirthday(maskBirthday(next))}
          keyboardType="number-pad"
          placeholder="15.08.1990"
        />

        <View style={{ gap: theme.spacing.sm }}>
          <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>Пол</Text>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            {GENDERS.map((option) => {
              const selected = gender === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setGender(selected ? null : option.value)}
                  style={[
                    styles.chip,
                    {
                      minHeight: theme.layout.minTouchTarget,
                      borderRadius: theme.radius.pill,
                      borderColor: selected ? theme.colors.brand : theme.colors.border,
                      backgroundColor: selected ? theme.colors.brandSubtle : theme.colors.surface,
                    },
                  ]}
                >
                  <Text
                    style={[
                      theme.typography.bodyMedium,
                      { color: selected ? theme.colors.brand : theme.colors.textSecondary },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
          Телефон {formatPhone(session.guest?.phone ?? '')}
        </Text>

        {failure ? (
          <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>{failure}</Text>
        ) : null}

        <PrimaryButton
          label="Сохранить"
          loading={save.isPending}
          onPress={() => {
            setFailure(null);
            save.mutate();
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row' },
  chip: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
});
