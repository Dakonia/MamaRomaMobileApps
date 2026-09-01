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
