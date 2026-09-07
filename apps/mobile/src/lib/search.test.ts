/**
 * Поиск по меню.
 *
 * Проверяем то, ради чего он и переписан: гость печатает с ошибками, а блюдо
 * всё равно находится — и находится первым, а не третьим.
 */

import { type Dish } from '@/api/client';
import { normalize, searchDishes, slips } from '@/lib/search';

function dish(name: string, composition?: string): Dish {
  return { id: name, name, composition: composition ?? null, description: null } as Dish;
}

const MENU = [
  dish('Маргарита', 'томаты, моцарелла, базилик'),
  dish('Пепперони', 'салями, моцарелла'),
  dish('Четыре сыра', 'моцарелла, горгонзола, пармезан, чеддер'),
  dish('Цезарь с курицей', 'салат романо, куриное филе, пармезан'),
  dish('Кальцоне ветчина грибы', 'ветчина, шампиньоны, моцарелла'),
];

function names(dishes: Dish[]): string[] {
  return dishes.map((row) => row.name);
}

describe('приведение к общему виду', () => {
  it('снимает регистр, ё и лишние пробелы', () => {
    expect(normalize('  Пицца   Четыре   Сыра ')).toBe('пицца четыре сыра');
    expect(normalize('Кальцонё')).toBe('кальцоне');
  });
});

describe('расстояние между словами', () => {
  it('пропущенная буква — одна ошибка', () => {
    expect(slips('маргрита', 'маргарита', 2)).toBe(1);
  });

  it('переставленные соседние буквы — тоже одна', () => {
    expect(slips('пецца', 'пицца', 2)).toBe(1);
    expect(slips('маргаирта', 'маргарита', 2)).toBe(1);
  });

  it('дальше предела не считает', () => {
    expect(slips('борщ', 'маргарита', 2)).toBeGreaterThan(2);
  });
});

describe('поиск блюд', () => {
  it('находит точное вхождение', () => {
    expect(names(searchDishes(MENU, 'пепперони'))).toEqual(['Пепперони']);
  });

  it('прощает пропущенную букву', () => {
    expect(names(searchDishes(MENU, 'маргрита'))[0]).toBe('Маргарита');
  });

  it('прощает лишнюю букву', () => {
    expect(names(searchDishes(MENU, 'пепперрони'))[0]).toBe('Пепперони');
  });

  it('прощает перепутанные буквы', () => {
    expect(names(searchDishes(MENU, 'маргаирта'))[0]).toBe('Маргарита');
  });

  it('прощает неверную букву', () => {
    expect(names(searchDishes(MENU, 'цезарь с курецей'))[0]).toBe('Цезарь с курицей');
  });

  it('ищет по составу, когда в названии ингредиента нет', () => {
    expect(names(searchDishes(MENU, 'шампиньоны'))).toEqual(['Кальцоне ветчина грибы']);
  });

  it('название весомее состава', () => {
    // Моцарелла есть в составе трёх блюд, но «Четыре сыра» названо про сыр
    const found = names(searchDishes(MENU, 'сыра'));

    expect(found[0]).toBe('Четыре сыра');
  });

  it('начало названия выше середины', () => {
    const found = names(searchDishes(MENU, 'кальцоне'));

    expect(found[0]).toBe('Кальцоне ветчина грибы');
  });

  it('запрос из нескольких слов ищет по каждому', () => {
    expect(names(searchDishes(MENU, 'пицца пепперони'))[0]).toBe('Пепперони');
  });

  it('пустой запрос ничего не находит', () => {
    expect(searchDishes(MENU, '   ')).toEqual([]);
  });

  it('короткое слово не прощаем: иначе найдётся половина меню', () => {
    // «сыр» и «сон» отличаются на две буквы из трёх — это разные слова
    expect(names(searchDishes(MENU, 'сон'))).toEqual([]);
  });
});
