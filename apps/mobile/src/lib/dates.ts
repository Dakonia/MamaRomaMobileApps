const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** Ближайшие дни для выбора даты брони. */
export function nextDays(count: number): Date[] {
  const today = new Date();
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() + index);
    return day;
  });
}

/** Дата в виде YYYY-MM-DD по местному времени, без сдвига через UTC. */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function dayLabel(date: Date, index: number): string {
  if (index === 0) return 'Сегодня';
  if (index === 1) return 'Завтра';
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()}`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getDate()} ${MONTHS[date.getMonth()]}, ${hours}:${minutes}`;
}

export function guestsLabel(count: number): string {
  const tail = count % 100;
  const last = count % 10;
  if (tail < 11 || tail > 14) {
    if (last === 1) return `${count} гость`;
    if (last >= 2 && last <= 4) return `${count} гостя`;
  }
  return `${count} гостей`;
}
