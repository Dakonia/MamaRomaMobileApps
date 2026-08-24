import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Order } from '@/api/client';

const ID = 'live-order';

/** Что показываем в живом уведомлении на каждом шаге. */
const STAGE: Record<Order['status'], { text: string; done: boolean }> = {
  created: { text: 'Ждём подтверждения ресторана', done: false },
  paid: { text: 'Оплачен, ждём ресторан', done: false },
  accepted: { text: 'Ресторан принял заказ', done: false },
  cooking: { text: 'Готовим', done: false },
  ready: { text: 'Заказ готов', done: false },
  delivering: { text: 'Курьер в пути', done: false },
  completed: { text: 'Доставлен', done: true },
  cancelled: { text: 'Отменён', done: true },
};

/** Полоска шагов прямо в тексте: место в уведомлении одно, а этапов пять. */
function track(status: Order['status']): string {
  const steps: Order['status'][] = ['accepted', 'cooking', 'ready', 'delivering', 'completed'];
  const at = steps.indexOf(status);

  return steps.map((_, index) => (index <= at ? '●' : '○')).join(' ');
}

/**
 * Живой статус заказа в шторке телефона.
 *
 * Уведомление одно и то же: на каждом шаге оно переписывается, а не плодит
 * новые. Тихое и несмахиваемое — это не новость, а табло, которое висит, пока
 * едет курьер. На iPhone для такого нужен отдельный виджет и платный аккаунт
 * Apple, поэтому пока показываем только на Android.
 */
export async function showLiveOrder(order: Order): Promise<void> {
  if (Platform.OS !== 'android') return;

  const stage = STAGE[order.status];

  if (stage.done) {
    await hideLiveOrder();
    return;
  }

  const when = order.delivery_at
    ? new Date(order.delivery_at).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  await Notifications.scheduleNotificationAsync({
    identifier: ID,
    content: {
      title: `${stage.text} · заказ № ${order.number}`,
      body: when ? `${track(order.status)}   ${when}` : track(order.status),
      // Табло не должно шуметь: звук уже был у обычного уведомления
      sound: false,
      sticky: true,
      autoDismiss: false,
      priority: Notifications.AndroidNotificationPriority.LOW,
      data: { screen: 'order', orderId: order.id },
    },
    trigger: null,
  });
}

/** Заказ доехал или отменён — табло убираем. */
export async function hideLiveOrder(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.dismissNotificationAsync(ID).catch(() => undefined);
  await Notifications.cancelScheduledNotificationAsync(ID).catch(() => undefined);
}
