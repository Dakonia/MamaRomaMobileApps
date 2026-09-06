/**
 * КОГДА ПРИВЕЗУТ. Расписание слотов доставки и самовывоза.
 *
 * Считается на телефоне, потому что зависит от часов гостя: он выбирает время
 * из тех получасовок, которые ещё можно успеть. Рабочие часы приходят с
 * сервера — их задаёт ресторан.
 */

/** Кухня не отдаёт заказы с первой минуты смены: полтора часа на разогрев. */
const WARMUP_MINUTES = 90;

/** Раньше чем через сорок пять минут заказ не соберут и не довезут. */
const LEAD_MINUTES = 45;

/** Дальше двенадцати получасовок список никто не листает. */
const MAX_SLOTS = 12;

const STEP_MINUTES = 30;

export type Slot = { iso: string | null; label: string };

/** «11:00:00» → минуты от полуночи. */
export function minutesOf(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function atMinutes(date: Date, minutes: number): Date {
  const result = new Date(date);
  result.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return result;
}

/**
 * Слоты внутри рабочих часов.
 *
 * Если сегодняшнее окно уже закрылось, предлагаем завтрашние: заказать «на
 * сейчас» в нерабочее время нельзя, а обещать несбыточное — тем более.
 *
 * @param now задаётся в тестах; в приложении это текущее время
 */
export function timeSlots(
  opensAt: string | null,
  closesAt: string | null,
  openNow: boolean,
  now: Date = new Date(),
): Slot[] {
  const slots: Slot[] = [];

  // «Как можно скорее» имеет смысл, только пока доставка работает
  if (openNow) slots.push({ iso: null, label: 'Как можно скорее' });

  const opens = opensAt ? minutesOf(opensAt) : 0;
  const closes = closesAt ? minutesOf(closesAt) : 24 * 60;

  const earliest = new Date(now.getTime() + LEAD_MINUTES * 60_000);
  earliest.setMinutes(earliest.getMinutes() > 30 ? 60 : 30, 0, 0);

  let cursor = new Date(earliest);

  // Слишком рано или уже поздно — переносим на ближайшее рабочее окно
  const todayOpens = atMinutes(now, opens + WARMUP_MINUTES);
  const todayCloses = atMinutes(now, closes);
  if (cursor < todayOpens) cursor = todayOpens;
  if (cursor > todayCloses) {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000);
    cursor = atMinutes(tomorrow, opens + WARMUP_MINUTES);
  }

  const tomorrow = cursor.getDate() !== now.getDate();
  const limit = atMinutes(cursor, closes);

  for (let step = 0; step < MAX_SLOTS && cursor <= limit; step += 1) {
    const hh = String(cursor.getHours()).padStart(2, '0');
    const mm = String(cursor.getMinutes()).padStart(2, '0');

    slots.push({
      iso: cursor.toISOString(),
      label: tomorrow ? `Завтра ${hh}:${mm}` : `${hh}:${mm}`,
    });

    cursor = new Date(cursor.getTime() + STEP_MINUTES * 60_000);
  }

  return slots;
}
