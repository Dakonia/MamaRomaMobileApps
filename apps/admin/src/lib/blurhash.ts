const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

function decode83(value: string): number {
  let result = 0;
  for (const symbol of value) result = result * 83 + DIGITS.indexOf(symbol);
  return result;
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * Насколько кадр светлый — по его хешу размытия, не скачивая сам снимок.
 *
 * В хеше первые символы после заголовка хранят средний цвет всей картинки.
 * Этого хватает, чтобы отличить тёмный вечерний зал от залитого солнцем: на
 * первом белые буквы читаются, на втором тонут.
 */
export function brightness(hash: string | null | undefined): number {
  if (!hash || hash.length < 6) return 1;

  const average = decode83(hash.slice(2, 6));
  const red = (average >> 16) & 255;
  const green = (average >> 8) & 255;
  const blue = average & 255;

  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/**
 * Насколько кадр пёстрый — по тому же хешу.
 *
 * После среднего цвета в хеше лежат составляющие деталей: чем они крупнее, тем
 * сильнее картинка изрезана пятнами. Спокойный зал в вечернем свете даёт малое
 * число, витрина с бутылками, цветами и телевизорами — большое. Поверх такой
 * витрины текст читать невозможно, сколько её ни затемняй.
 */
export function busyness(hash: string | null | undefined): number {
  if (!hash || hash.length < 8) return 1;

  const ceiling = (decode83(hash.slice(1, 2)) + 1) / 166;
  let sum = 0;

  for (let index = 6; index + 2 <= hash.length; index += 2) {
    const value = decode83(hash.slice(index, index + 2));
    const red = Math.floor(value / (19 * 19));
    const green = Math.floor(value / 19) % 19;
    const blue = value % 19;

    // Каждая составляющая лежит в диапазоне от минус до плюс единицы
    sum +=
      (Math.abs(red - 9) + Math.abs(green - 9) + Math.abs(blue - 9)) / 27;
  }

  return sum * ceiling;
}
