/**
 * Расписание доставки.
 *
 * Слот — это обещание: гость выбирает время, и ресторан должен успеть. Ошибка
 * здесь стоит не денег, а доверия — привезут не тогда, когда сказано, либо
 * заказ примут в закрытый ресторан.
 */

import { minutesOf, timeSlots } from '@/lib/slots';

/** Момент, от которого считаем: будний день, полдень. */
function at(hours: number, minutes = 0): Date {
  return new Date(2026, 8, 7, hours, minutes, 0, 0);
}

function labels(slots: { label: string }[]): string[] {
  return slots.map((slot) => slot.label);
}

describe('минуты от полуночи', () => {
  it('разбирает время из настроек ресторана', () => {
    expect(minutesOf('11:00:00')).toBe(660);
    expect(minutesOf('23:30')).toBe(1410);
    expect(minutesOf('00:00:00')).toBe(0);
  });
});

describe('слоты доставки', () => {
  it('первым идёт «как можно скорее», пока ресторан открыт', () => {
    const slots = timeSlots('11:00', '23:00', true, at(13));

    expect(slots[0]).toEqual({ iso: null, label: 'Как можно скорее' });
  });

  it('в закрытом ресторане «как можно скорее» не предлагаем', () => {
    const slots = timeSlots('11:00', '23:00', false, at(9));

    expect(labels(slots)).not.toContain('Как можно скорее');
  });

  it('ближайший слот не раньше чем через сорок пять минут', () => {
    const slots = timeSlots('11:00', '23:00', true, at(13, 5));

    // 13:05 + 45 минут = 13:50, округляем вверх до 14:00
    expect(labels(slots)[1]).toBe('14:00');
  });

  it('утром до разогрева кухни первый слот сдвигается к открытию', () => {
    // Открытие в 11:00, полтора часа разогрева — раньше 12:30 не отдают
    const slots = timeSlots('11:00', '23:00', false, at(8));

    expect(labels(slots)[0]).toBe('12:30');
  });

  it('после закрытия предлагаем завтрашние слоты', () => {
    const slots = timeSlots('11:00', '23:00', false, at(23, 30));

    expect(labels(slots)[0]).toBe('Завтра 12:30');
    expect(labels(slots).every((label) => label.startsWith('Завтра'))).toBe(true);
  });

  it('слоты идут через полчаса и не выходят за закрытие', () => {
    const slots = timeSlots('11:00', '16:00', true, at(13));
    const times = labels(slots).slice(1);

    expect(times.slice(0, 3)).toEqual(['14:00', '14:30', '15:00']);
    expect(times.at(-1)).toBe('16:00');
  });

  it('больше двенадцати получасовок не показываем', () => {
    const slots = timeSlots('11:00', '23:00', true, at(12));

    expect(slots.filter((slot) => slot.iso !== null)).toHaveLength(12);
  });

  it('без рабочих часов считаем, что ресторан работает круглосуточно', () => {
    const slots = timeSlots(null, null, true, at(13));

    expect(labels(slots)[1]).toBe('14:00');
  });
});
