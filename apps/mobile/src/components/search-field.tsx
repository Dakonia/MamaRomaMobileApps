import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useTheme } from '@/theme/theme-provider';

type Props = {
  /** Подпись зависит от экрана: блюдо в меню, улица в списке ресторанов. */
  placeholder?: string;
  /** Список ресторанов — светлый экран, там нужны обычные цвета. */
  onLight?: boolean;
  value: string;
  onChange: (value: string) => void;
};

/** Поиск по меню. Живёт на тёмной витрине, поэтому цвета из ролей hero. */
export function SearchField({ value, onChange, placeholder = 'Найти блюдо', onLight = false }: Props) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.root,
        {
          minHeight: theme.layout.minTouchTarget,
          paddingHorizontal: theme.spacing.md,
          gap: theme.spacing.sm,
          borderRadius: theme.radius.pill,
          backgroundColor: onLight ? theme.colors.surfaceSunken : theme.colors.heroRaised,
        },
      ]}
    >
      <Ionicons
        name="search"
        size={theme.spacing.lg}
        color={onLight ? theme.colors.textTertiary : theme.colors.onHeroMuted}
      />

      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={onLight ? theme.colors.textTertiary : theme.colors.onHeroMuted}
        returnKeyType="search"
        clearButtonMode="never"
        style={[
          theme.typography.body,
          styles.input,
          {
            color: onLight ? theme.colors.textPrimary : theme.colors.onHero,
            minHeight: theme.layout.minTouchTarget,
          },
        ]}
      />

      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Очистить поиск"
          hitSlop={theme.hitSlop}
          onPress={() => onChange('')}
        >
          <Ionicons
            name="close-circle"
            size={theme.spacing.lg}
            color={onLight ? theme.colors.textTertiary : theme.colors.onHeroMuted}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, padding: 0 },
});
