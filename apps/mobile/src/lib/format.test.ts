/**
 * Как гость видит деньги, баллы и количества.
 *
 * Копейки приходят целым числом, а на экране должны читаться как в чеке:
 * с разрядами, без копеек и с правильным русским окончанием. Ошибка здесь не
 * ломает расчёт, но выглядит как ошибка расчёта — гость видит «1290 ₽» вместо
 * «1 290 ₽» и перестаёт доверять цифрам.
 */

import { formatPoints, formatPrice, formatRubles, phoneToUri, plural } from '@/lib/format';

/** В цене стоит неразрывный пробел: цифры не должны отрываться от знака рубля. */
const NBSP = '\u00A0';

describe('цены', () => {
  it('копейки превращаются в рубли с разрядами', () => {
    expect(formatPrice(129_000)).toBe(`1${NBSP}290${NBSP}₽`);
    expect(formatPrice(41_000)).toBe(`410${NBSP}₽`);
  });

  it('миллион разбит по три цифры', () => {
    expect(formatPrice(123_456_700)).toBe(`1${NBSP}234${NBSP}567${NBSP}₽`);
  });

  it('копейки округляются, а не отбрасываются', () => {
    expect(formatPrice(41_050)).toBe(`411${NBSP}₽`);
    expect(formatPrice(41_049)).toBe(`410${NBSP}₽`);
  });

  it('ноль остаётся нулём', () => {
    expect(formatPrice(0)).toBe(`0${NBSP}₽`);
  });

  it('пороги из конфига тенанта уже в рублях', () => {
    expect(formatRubles(15_000)).toBe(`15${NBSP}000${NBSP}₽`);
  });
});

describe('баллы', () => {
  it('склоняются по последней цифре', () => {
    expect(formatPoints(1)).toBe(`1${NBSP}балл`);
    expect(formatPoints(3)).toBe(`3${NBSP}балла`);
    expect(formatPoints(7)).toBe(`7${NBSP}баллов`);
  });

  it('вторая десятка — исключение', () => {
    expect(formatPoints(11)).toBe(`11${NBSP}баллов`);
    expect(formatPoints(12)).toBe(`12${NBSP}баллов`);
    expect(formatPoints(14)).toBe(`14${NBSP}баллов`);
  });

  it('за десятками счёт начинается заново', () => {
    expect(formatPoints(21)).toBe(`21${NBSP}балл`);
    expect(formatPoints(102)).toBe(`102${NBSP}балла`);
    expect(formatPoints(1_000)).toBe(`1${NBSP}000${NBSP}баллов`);
  });
});

describe('склонение по числу', () => {
  it('считает блюда', () => {
    expect(plural(1, 'блюдо', 'блюда', 'блюд')).toBe('блюдо');
    expect(plural(2, 'блюдо', 'блюда', 'блюд')).toBe('блюда');
    expect(plural(5, 'блюдо', 'блюда', 'блюд')).toBe('блюд');
    expect(plural(11, 'блюдо', 'блюда', 'блюд')).toBe('блюд');
    expect(plural(21, 'блюдо', 'блюда', 'блюд')).toBe('блюдо');
  });
});

describe('телефон', () => {
  it('в ссылку для звонка уходят только цифры и плюс', () => {
    expect(phoneToUri('+7 (812) 407-13-72')).toBe('tel:+78124071372');
  });
});
