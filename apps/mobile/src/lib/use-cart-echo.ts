import { useEffect, useRef } from 'react';

import { api } from '@/api/client';
import { cartSubtotal, useCart } from '@/store/cart';
import { useSession } from '@/store/session';

/** Ждём паузу в действиях: гость ещё выбирает, а не забыл корзину. */
const SETTLE_MS = 4000;

/**
 * Сообщает серверу, что в корзине что-то лежит.
 *
 * Корзина живёт на телефоне, и без этого сервер никогда не узнает, что гость
 * собрал заказ и ушёл. Отправляем только счёт и сумму — состав остаётся здесь.
 */
export function useCartEcho(): void {
  const items = useCart((state) => state.items);
  const authorized = useSession((state) => state.status) === 'authorized';

  const last = useRef<string>('');

  useEffect(() => {
    if (!authorized) return;

    const positions = items.length;
    const total = cartSubtotal(items);
    const mark = `${positions}:${total}`;

    if (mark === last.current) return;

    const timer = setTimeout(() => {
      last.current = mark;
      void api.rememberCart(positions, total).catch(() => {
        // Не дошло — не беда: напоминание не стоит того, чтобы мешать гостю
        last.current = '';
      });
    }, SETTLE_MS);

    return () => clearTimeout(timer);
  }, [items, authorized]);
}
