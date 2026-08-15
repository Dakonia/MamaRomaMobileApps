import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { api, type ApiError } from '@/api/client';
import { ScreenHeader } from '@/components/screen-header';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

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

export default function ProfileEditScreen() {
  const theme = useTheme();
  const session = useSession();

  const [name, setName] = useState(session.guest?.name ?? '');
  const [email, setEmail] = useState(session.guest?.email ?? '');
  const [birthday, setBirthday] = useState(fromIsoBirthday(session.guest?.birthday));
  const [failure, setFailure] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const iso = birthday.trim().length > 0 ? toIsoBirthday(birthday) : null;
      if (birthday.trim().length > 0 && iso === null) {
        throw new Error('Дата в формате 15.08.1990');
      }
      return api.updateMe({
        name: name.trim().length > 0 ? name.trim() : null,
        email: email.trim().length > 0 ? email.trim() : null,
        birthday: iso,
      });
    },
    onSuccess: async () => {
      await session.restore();
      router.back();
    },
    onError: (error: ApiError | Error) => setFailure(error.message),
  });

  const field = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    placeholder: string,
    keyboard: 'default' | 'email-address' | 'numbers-and-punctuation' = 'default',
  ) => (
    <View style={{ gap: theme.spacing.xs }}>
      <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textTertiary}
        keyboardType={keyboard}
        autoCapitalize={keyboard === 'email-address' ? 'none' : 'sentences'}
        style={[
          theme.typography.body,
          {
            color: theme.colors.textPrimary,
            backgroundColor: theme.colors.surfaceSunken,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.spacing.base,
            minHeight: theme.layout.minTouchTarget,
          },
        ]}
      />
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title="Личные данные" subtitle="Нужны для чека и подарка ко дню рождения" />

      <ScrollView
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          gap: theme.spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {field('Как к вам обращаться', name, setName, 'Владислав')}
        {field('Почта', email, setEmail, 'vlad@example.ru', 'email-address')}
        {field('День рождения', birthday, setBirthday, '15.08.1990', 'numbers-and-punctuation')}

        <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
          Телефон {session.guest?.phone} изменить нельзя — по нему работает вход.
        </Text>

        {failure ? (
          <Text style={[theme.typography.body, { color: theme.colors.danger }]}>{failure}</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={save.isPending}
          onPress={() => {
            setFailure(null);
            save.mutate();
          }}
          style={({ pressed }) => [
            styles.submit,
            {
              minHeight: theme.layout.minTouchTarget + theme.spacing.xs,
              borderRadius: theme.radius.pill,
              backgroundColor: pressed ? theme.colors.brandPressed : theme.colors.brand,
              opacity: save.isPending ? 0.6 : 1,
            },
          ]}
        >
          <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
            {save.isPending ? 'Сохраняем…' : 'Сохранить'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  submit: { alignItems: 'center', justifyContent: 'center' },
});
