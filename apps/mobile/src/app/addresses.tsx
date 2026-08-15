import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { api, type ApiError } from '@/api/client';
import { EmptyState } from '@/components/empty-state';
import { ScreenHeader } from '@/components/screen-header';
import { useTheme } from '@/theme/theme-provider';

export default function AddressesScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [street, setStreet] = useState('');
  const [house, setHouse] = useState('');
  const [flat, setFlat] = useState('');
  const [title, setTitle] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const cities = useQuery({ queryKey: ['cities'], queryFn: () => api.cities() });
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: () => api.addresses() });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['addresses'] });

  const add = useMutation({
    mutationFn: () =>
      api.addAddress({
        city_id: cities.data?.[0]?.id ?? '',
        street: street.trim(),
        house: house.trim(),
        flat: flat.trim().length > 0 ? flat.trim() : null,
        title: title.trim().length > 0 ? title.trim() : null,
        entrance: null,
        floor: null,
        intercom: null,
        comment: null,
        latitude: null,
        longitude: null,
        is_default: false,
      }),
    onSuccess: () => {
      setStreet('');
      setHouse('');
      setFlat('');
      setTitle('');
      setFailure(null);
      void refresh();
    },
    onError: (error: ApiError) => setFailure(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAddress(id),
    onSuccess: () => void refresh(),
    onError: (error: ApiError) => setFailure(error.message),
  });

  const input = (
    value: string,
    onChange: (next: string) => void,
    placeholder: string,
    flex = 1,
  ) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.textTertiary}
      style={[
        theme.typography.body,
        {
          flex,
          color: theme.colors.textPrimary,
          backgroundColor: theme.colors.surfaceSunken,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.base,
          minHeight: theme.layout.minTouchTarget,
        },
      ]}
    />
  );

  const canSubmit = street.trim().length > 1 && house.trim().length > 0;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title="Адреса доставки" subtitle="Чтобы не вводить заново каждый раз" />

      <ScrollView
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing.xxxl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: theme.spacing.md }}>
          <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
            Новый адрес
          </Text>

          {input(street, setStreet, 'Улица')}
          <View style={[styles.row, { gap: theme.spacing.md }]}>
            {input(house, setHouse, 'Дом')}
            {input(flat, setFlat, 'Квартира')}
          </View>
          {input(title, setTitle, 'Название: дом, работа')}

          {failure ? (
            <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>
              {failure}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit || add.isPending}
            onPress={() => {
              setFailure(null);
              add.mutate();
            }}
            style={({ pressed }) => [
              styles.submit,
              {
                minHeight: theme.layout.minTouchTarget,
                borderRadius: theme.radius.pill,
                backgroundColor: pressed ? theme.colors.brandPressed : theme.colors.brand,
                opacity: !canSubmit || add.isPending ? 0.5 : 1,
              },
            ]}
          >
            <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
              {add.isPending ? 'Сохраняем…' : 'Добавить'}
            </Text>
          </Pressable>
        </View>

        {addresses.isPending ? null : (addresses.data ?? []).length === 0 ? (
          <EmptyState
            icon="home-outline"
            title="Пока нет адресов"
            description="Добавьте первый — он подставится в заказ автоматически."
          />
        ) : (
          <View style={{ gap: theme.spacing.md }}>
            <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
              Сохранённые
            </Text>

            {(addresses.data ?? []).map((address) => (
              <View
                key={address.id}
                style={[
                  styles.row,
                  {
                    padding: theme.spacing.base,
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.surfaceSunken,
                    gap: theme.spacing.md,
                  },
                ]}
              >
                <View style={styles.grow}>
                  <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                    {address.title ?? address.street}
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    {address.full_text}
                  </Text>
                  {address.is_default ? (
                    <Text style={[theme.typography.caption, { color: theme.colors.accent }]}>
                      Основной
                    </Text>
                  ) : null}
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Удалить адрес"
                  hitSlop={theme.hitSlop}
                  onPress={() => remove.mutate(address.id)}
                >
                  <Ionicons
                    name="trash-outline"
                    size={theme.spacing.lg}
                    color={theme.colors.danger}
                  />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  submit: { alignItems: 'center', justifyContent: 'center' },
});
