import type { Ionicons } from '@expo/vector-icons';

import type { OrderCreate } from '@/api/client';

export type PaymentMethod = OrderCreate['payment_method'];

export const PAYMENTS: {
  value: PaymentMethod;
  label: string;
  note: string;
  icon: keyof typeof Ionicons.glyphMap;
  online: boolean;
}[] = [
  {
    value: 'online_sbp',
    label: 'СБП',
    note: 'Из банковского приложения',
    icon: 'qr-code',
    online: true,
  },
  {
    value: 'online_card',
    label: 'Картой онлайн',
    note: 'Мир, Visa, Mastercard',
    icon: 'card',
    online: true,
  },
  { value: 'cash_on_delivery', label: 'Наличными', note: 'При получении', icon: 'cash', online: false },
  {
    value: 'card_on_delivery',
    label: 'Картой при получении',
    note: 'Курьеру или на кассе',
    icon: 'card-outline',
    online: false,
  },
];

/** Круглая кнопка счётчика: 36 pt — в неё попадают, не целясь. */
