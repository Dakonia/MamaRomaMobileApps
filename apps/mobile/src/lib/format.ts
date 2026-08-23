const NBSP = ' ';

function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Копейки из API → «1 290 ₽». Дробную часть не показываем: в меню её не бывает. */
export function formatPrice(kopecks: number): string {
  return `${groupDigits(Math.round(kopecks / 100))}${NBSP}₽`;
}

/** Конфиг тенанта хранит пороги в рублях, а API — в копейках. Это про рубли. */
export function formatRubles(rubles: number): string {
  return `${groupDigits(rubles)}${NBSP}₽`;
}

export function formatPoints(points: number): string {
  const tail = Math.abs(points) % 100;
  const last = Math.abs(points) % 10;

  let word = 'баллов';
  if (tail < 11 || tail > 14) {
    if (last === 1) word = 'балл';
    else if (last >= 2 && last <= 4) word = 'балла';
  }

  return `${groupDigits(points)}${NBSP}${word}`;
}

export function formatPhone(phone: string): string {
  return phone.replace(/\s/g, NBSP);
}

export function phoneToUri(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/** Русское склонение по числу: 1 вариант, 2 варианта, 5 вариантов. */
export function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  if (tens > 10 && tens < 20) return many;

  const ones = count % 10;
  if (ones === 1) return one;
  if (ones > 1 && ones < 5) return few;
  return many;
}
