import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/theme-provider';

type Props = {
  name?: string | null;
  size?: number;
  /** На тёмной карте кружок светлый, на белом фоне — фирменный градиент. */
  onDark?: boolean;
};

/** «Владислав Петров» → «ВП», «Влад» → «В». */
function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({ name, size = 48, onDark = false }: Props) {
  const theme = useTheme();
  const initials = initialsOf(name);

  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
      <LinearGradient
        colors={
          onDark
            ? [theme.colors.heroRaised, theme.colors.heroRaised]
            : [theme.colors.brand, theme.colors.brandPressed]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, styles.center]}
      >
        {initials ? (
          <Text
            style={{
              fontFamily: theme.typography.display.fontFamily,
              fontSize: size * 0.38,
              color: onDark ? theme.colors.onHero : theme.colors.textOnBrand,
            }}
          >
            {initials}
          </Text>
        ) : (
          <Ionicons
            name="person"
            size={size * 0.46}
            color={onDark ? theme.colors.onHero : theme.colors.textOnBrand}
          />
        )}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
