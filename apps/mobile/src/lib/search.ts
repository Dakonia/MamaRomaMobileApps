/**
 * ПОИСК ПО МЕНЮ, который прощает опечатки.
 *
 * Гость печатает одним пальцем на ходу: «маргрита», «пеперони», «цезар».
 * Точное совпадение строки такое не находит, и человек видит пустой экран —
 * хотя блюдо в меню есть.
 *
 * Ищем по названию, составу и описанию. Сначала точные вхождения, потом
 * слова, набранные с ошибкой. Всё считается на телефоне по уже загруженному
 * меню: сервер для этого не нужен.
 */

import type { Dish } from '@/api/client';

/** Сколько букв разрешаем перепутать. Короткое слово — только одну. */
function allowedSlips(word: string): number {
  if (word.length <= 4) return 0;
  if (word.length <= 7) return 1;
  return 2;
}

/**
 * Приводим к общему виду: регистр, ё и лишние пробелы.
 * «Пицца  Маргарита» и «пицца маргарита» должны совпасть.
 */
export function normalize(value: string): string {
  return value.toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ').trim();
}

/**
 * Расстояние между словами: сколько букв нужно вставить, убрать, заменить
 * или переставить местами, чтобы одно стало другим.
 *
 * Перестановка считается за одну ошибку, а не за две: «пецца» и «пицца»
 * отличаются на один промах пальцем, и поиск должен считать так же.
 * Считаем не дальше предела — дальше нам всё равно не интересно.
 */
export function slips(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let beforePrevious: number[] = [];

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i, ...Array<number>(b.length).fill(0)];
    let best = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const same = a[i - 1] === b[j - 1] ? 0 : 1;

      current[j] = Math.min(
        current[j - 1] + 1, // вставили букву
        previous[j] + 1, // пропустили букву
        previous[j - 1] + same, // набрали другую
      );

      // Переставили две соседние буквы местами
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j], beforePrevious[j - 2] + 1);
      }

      best = Math.min(best, current[j]);
    }

    // Дальше будет только хуже — считать до конца незачем
    if (best > limit) return limit + 1;

    beforePrevious = previous;
    previous = current;
  }

  return previous[b.length];
}

/** Нашлось ли слово запроса среди слов текста — точно или с опечаткой. */
function matches(words: string[], needle: string): boolean {
  if (words.some((word) => word.includes(needle))) return true;

  const limit = allowedSlips(needle);
  if (limit === 0) return false;

  return words.some((word) => slips(word, needle, limit) <= limit);
}

/**
 * Насколько блюдо подходит запросу. Больше — выше в списке.
 *
 * Совпадение в названии весомее, чем в составе: гость ищет блюдо, а не
 * ингредиент. Начало названия весомее середины — «Маргарита» по запросу
 * «марг» должна стоять выше «Пиццы с маргариткой».
 */
function score(dish: Dish, needle: string): number {
  const name = normalize(dish.name);
  const composition = normalize(dish.composition ?? '');
  const description = normalize(dish.description ?? '');

  if (name.startsWith(needle)) return 100;
  if (name.includes(needle)) return 80;

  if (matches(name.split(' '), needle)) return 60;
  if (composition.includes(needle) || description.includes(needle)) return 40;
  if (matches(composition.split(' '), needle)) return 20;

  return 0;
}

/**
 * Блюда под запрос, самые подходящие первыми.
 *
 * Запрос из нескольких слов ищем целиком и по словам: «пицца пеперони»
 * найдёт «Пепперони», даже если слова «пицца» в названии нет.
 */
export function searchDishes(dishes: Dish[], query: string): Dish[] {
  const needle = normalize(query);
  if (needle.length === 0) return [];

  const words = needle.split(' ').filter((word) => word.length > 1);

  const ranked = dishes
    .map((dish) => {
      const whole = score(dish, needle);
      // Каждое слово запроса добавляет уверенности, но целое совпадение важнее
      const parts = words.reduce((sum, word) => sum + score(dish, word), 0);

      return { dish, weight: Math.max(whole, parts / Math.max(1, words.length)) };
    })
    .filter((row) => row.weight > 0);

  ranked.sort((a, b) => b.weight - a.weight || a.dish.name.localeCompare(b.dish.name));

  return ranked.map((row) => row.dish);
}
