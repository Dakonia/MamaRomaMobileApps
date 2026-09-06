import { forwardRef } from 'react';
import { Text as Native, TextInput as NativeInput } from 'react-native';
import type { TextInputProps, TextProps } from 'react-native';

/**
 * ТЕКСТ ПРИЛОЖЕНИЯ. Тот же Text из React Native, но с потолком увеличения.
 *
 * Гость может поднять размер шрифта в настройках телефона — после сорока это
 * делает почти каждый второй. Система тогда увеличивает весь наш текст, и без
 * ограничения цена в карточке уезжает из блока, а подписи под вкладками
 * наползают друг на друга.
 *
 * Потолок в 1,3 — компромисс: слабовидящему заметно крупнее, а вёрстка,
 * рассчитанная на две строки, в две строки и остаётся. Там, где места совсем
 * нет (значок на сумке, метка на карте), потолок опускается до 1,1 прямо в
 * месте применения — свойство никуда не делось, оно просто задано по умолчанию.
 *
 * Пользоваться так же, как обычным Text:
 *
 *   import { Text } from '@/components/text';
 */
const MAX_SCALE = 1.3;

export function Text({ maxFontSizeMultiplier = MAX_SCALE, ...rest }: TextProps) {
  return <Native maxFontSizeMultiplier={maxFontSizeMultiplier} {...rest} />;
}

/**
 * Поле ввода с тем же потолком: набранный адрес не должен вылезать из рамки.
 * Ссылку пропускаем насквозь — на поле наводят фокус и очищают его снаружи.
 */
export const TextInput = forwardRef<NativeInput, TextInputProps>(
  ({ maxFontSizeMultiplier = MAX_SCALE, ...rest }, ref) => (
    <NativeInput ref={ref} maxFontSizeMultiplier={maxFontSizeMultiplier} {...rest} />
  ),
);

TextInput.displayName = 'TextInput';
