import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

// Тот самый кадр из прототипа: лежит в приложении, а не тянется с сервера —
// шапка появляется мгновенно и не зависит от сети
const HERO = require('../../assets/images/hero-pizza.jpg');

/**
 * Фон шапки: фотография под вуалью. Размытия нет намеренно — оно съедало
 * последнюю резкость у и без того небольшого исходника. Читаемость держит
 * градиент: сверху он мягче, к поиску и категориям уплотняется.
 */
export function HeroPhoto() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image source={HERO} style={StyleSheet.absoluteFill} contentFit="cover" />

      <LinearGradient
        colors={['rgba(20, 17, 16, 0.6)', 'rgba(20, 17, 16, 0.78)', 'rgba(20, 17, 16, 0.92)']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
