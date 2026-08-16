import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useTheme } from '@/theme/theme-provider';

type Props = {
  value: string;
  onChange: (value: string) => void;
};

/** Поиск по меню. Живёт на тёмной витрине, поэтому цвета из ролей hero. */
export function SearchField({ value, onChange }: Props) {
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
          backgroundColor: theme.colors.heroRaised,
        },
      ]}
    >
      <Ionicons name="search" size={theme.spacing.lg} color={theme.colors.onHeroMuted} />

      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Найти блюдо"
        placeholderTextColor={theme.colors.onHeroMuted}
        returnKeyType="search"
        clearButtonMode="never"
        style={[
          theme.typography.body,
          styles.input,
          { color: theme.colors.onHero, minHeight: theme.layout.minTouchTarget },
        ]}
      />

      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Очистить поиск"
          hitSlop={theme.hitSlop}
          onPress={() => onChange('')}
        >
          <Ionicons name="close-circle" size={theme.spacing.lg} color={theme.colors.onHeroMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, padding: 0 },
});
