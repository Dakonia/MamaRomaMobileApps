/** Оставляем только цифры и приводим к российским десяти после кода страны. */
export function phoneDigits(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (!digits.startsWith('7')) digits = `7${digits}`;
  return digits.slice(0, 11);
}

/** 79991234567 → +7 (999) 123-45-67, с частичным вводом. */
export function formatPhone(input: string): string {
  const digits = phoneDigits(input);
  const rest = digits.slice(1);

  let result = '+7';
  if (rest.length > 0) result += ` (${rest.slice(0, 3)}`;
  if (rest.length >= 3) result += ')';
  if (rest.length > 3) result += ` ${rest.slice(3, 6)}`;
  if (rest.length > 6) result += `-${rest.slice(6, 8)}`;
  if (rest.length > 8) result += `-${rest.slice(8, 10)}`;
  return result;
}

export function isPhoneComplete(input: string): boolean {
  return phoneDigits(input).length === 11;
}

/** В API уходит канонический вид, чтобы гость нашёлся по любому написанию. */
export function toApiPhone(input: string): string {
  return `+${phoneDigits(input)}`;
}
