import { StyleSheet, View } from 'react-native';

// Кодировка EAN-13. Первая цифра не рисуется полосами — она задаёт, каким
// набором кодируются шесть левых цифр, по этому и определяется на кассе.
const LEFT_ODD = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
const LEFT_EVEN = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
const RIGHT = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];
const PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

/** Номер карты → строка из 95 модулей, где единица это тёмная полоса. */
function modules(code: string): string {
  const digits = code.padStart(13, '0').slice(0, 13).split('').map(Number);
  const parity = PARITY[digits[0]];

  let left = '';
  for (let index = 0; index < 6; index += 1) {
    const table = parity[index] === 'L' ? LEFT_ODD : LEFT_EVEN;
    left += table[digits[index + 1]];
  }

  let right = '';
  for (let index = 7; index < 13; index += 1) {
    right += RIGHT[digits[index]];
  }

  // Границы и разделитель посередине — по ним сканер ловит масштаб
  return `101${left}01010${right}101`;
}

type Props = {
  value: string;
  height?: number;
  color?: string;
};

/**
 * Штрихкод карты гостя. Рисуем полосами, а не картинкой: так он остаётся
 * чётким на любом экране и не тянет за собой стороннюю библиотеку.
 */
export function Barcode({ value, height = 64, color = '#111111' }: Props) {
  const bits = modules(value);

  // Соседние одинаковые модули склеиваем в одну полосу: вместо 95 элементов
  // получается около тридцати
  const bars: { width: number; dark: boolean }[] = [];
  for (const bit of bits) {
    const dark = bit === '1';
    const last = bars[bars.length - 1];
    if (last && last.dark === dark) last.width += 1;
    else bars.push({ width: 1, dark });
  }

  return (
    <View style={[styles.root, { height }]}>
      {bars.map((bar, index) => (
        <View
          key={index}
          style={{
            flex: bar.width,
            height: '100%',
            backgroundColor: bar.dark ? color : 'transparent',
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', width: '100%' },
});
