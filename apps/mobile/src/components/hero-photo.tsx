import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { Ember } from '@/components/skia/ember';

// Тот самый кадр из прототипа: лежит в приложении, а не тянется с сервера —
// шапка появляется мгновенно и не зависит от сети
const HERO = require('../../assets/images/hero-pizza.jpg');

/**
 * Фон шапки: фотография под вуалью. Размытия нет намеренно — оно съедало
 * последнюю резкость у и без того небольшого исходника. Читаемость держит
 * градиент: сверху он мягче, к поиску и категориям уплотняется.
 *
 * Понизу идёт отсвет печи. Он тише, чем на заставке, и без резких вспышек:
 * шапка висит на экране постоянно, и мельтешение здесь быстро надоело бы.
 * Смысл в другом — от снимка идёт тепло, и меню перестаёт быть каталогом.
 */
export function HeroPhoto({ height }: { height: number }) {
  const { width } = useWindowDimensions();
  const glow = Math.max(120, height * 0.55);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image source={HERO} style={StyleSheet.absoluteFill} contentFit="cover" />

      <Ember
        width={width}
        height={glow}
        power={0.42}
        style={{ bottom: 0, left: 0 }}
      />

      <LinearGradient
        colors={['rgba(20, 17, 16, 0.6)', 'rgba(20, 17, 16, 0.78)', 'rgba(20, 17, 16, 0.92)']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
