import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from '@/api/client';
import { trackError } from '@/lib/analytics';

/** Пока приложение открыто, уведомление показываем сверху, а не глотаем. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
  ?.projectId;

/**
 * Отдельный канал под заказы: Android показывает его настройки гостю, и статус
 * заказа не смешивается с рассылками об акциях.
 */
async function prepareChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('orders', {
    name: 'Заказы',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 100, 200],
    lightColor: '#C0392B',
  });

  await Notifications.setNotificationChannelAsync('promos', {
    name: 'Акции и новости',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** Разрешение уже выдано — спрашивать второй раз не нужно. */
export async function pushAllowed(): Promise<boolean> {
  const status = await Notifications.getPermissionsAsync();
  return status.granted;
}

/**
 * Гость запретил уведомления насовсем: системное окно больше не появится,
 * вернуть можно только в настройках телефона.
 */
export async function pushBlocked(): Promise<boolean> {
  const status = await Notifications.getPermissionsAsync();
  return !status.granted && !status.canAskAgain;
}

/**
 * Спрашивает разрешение и отдаёт токен устройства. Токен привязывается к гостю
 * на сервере — по нему приходит статус его заказа.
 */
/** Телефон запретил уведомления насовсем: код, а не текст для гостя. */
export const BLOCKED_BY_SETTINGS = 'settings';

export let lastPushError: string | null = null;

export async function enablePush(ask: boolean): Promise<string | null> {
  lastPushError = null;

  if (!Device.isDevice) {
    lastPushError = 'Эмулятор: уведомления не поддерживаются';
    return null;
  }

  if (!projectId) {
    lastPushError = 'В сборке нет идентификатора проекта';
    return null;
  }

  try {
    await prepareChannels();

    const current = await Notifications.getPermissionsAsync();

    if (!current.granted && ask && !current.canAskAgain) {
      // Один раз уже отказали: системное окно больше никогда не покажется
      lastPushError = BLOCKED_BY_SETTINGS;
      return null;
    }

    const granted =
      current.granted || (ask && (await Notifications.requestPermissionsAsync()).granted);

    if (!granted) {
      lastPushError = 'Телефон не дал разрешение на уведомления';
      return null;
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

    await api.registerDevice({
      push_token: token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      app_version: Constants.expoConfig?.version ?? null,
    });

    return token;
  } catch (error) {
    lastPushError = error instanceof Error ? error.message : String(error);
    trackError('Не удалось подключить уведомления', error);
    return null;
  }
}

/** Гость выключил уведомления в профиле: сервер перестаёт слать на это устройство. */
export async function disablePush(): Promise<void> {
  if (!projectId) return;

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api.forgetDevice(token);
  } catch (error) {
    trackError('Не удалось отключить уведомления', error);
  }
}
