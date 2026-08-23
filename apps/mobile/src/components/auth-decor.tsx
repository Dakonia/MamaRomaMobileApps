import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { PizzaBackdrop } from '@/components/pizza-backdrop';
import { useTheme } from '@/theme/theme-provider';

const ATMOSPHERE = require('../../assets/images/vera-pizza.jpg');

/** #FFFFFF + 0.85 → #FFFFFFD9. Токены хранят цвет без прозрачности. */
function withAlpha(hex: string, alpha: number): string {
  const value = Math.round(Math.min(Math.max(alpha, 0), 1) * 255);
  return `${hex}${value.toString(16).padStart(2, '0')}`;
}

type Props = {
  /** 'photo' — атмосферный кадр за первым экраном, 'icons' — летающие пиццы. */
  variant: 'photo' | 'icons';
};

export function AuthDecor({ variant }: Props) {
  const theme = useTheme();

  if (variant === 'icons') {
    return <PizzaBackdrop />;
  }

  return (
    <View pointerEvents="none" style={styles.band}>
      <Image source={ATMOSPHERE} style={StyleSheet.absoluteFill} contentFit="cover" />
      {/* Кадр живёт полосой наверху и мягко растворяется в фоне — текст ниже
          лежит уже на чистом белом */}
      <LinearGradient
        colors={[
          withAlpha(theme.colors.background, 0),
          withAlpha(theme.colors.background, theme.isDark ? 0.7 : 0.6),
          theme.colors.background,
        ]}
        locations={[0, 0.5, 0.86]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },
});
