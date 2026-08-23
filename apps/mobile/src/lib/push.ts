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
 * Спрашивает разрешение и отдаёт токен устройства. Токен привязывается к гостю
 * на сервере — по нему приходит статус его заказа.
 */
export async function enablePush(ask: boolean): Promise<string | null> {
  // На эмуляторе пушей не бывает: там нет ни Firebase, ни APNs
  if (!Device.isDevice || !projectId) return null;

  try {
    await prepareChannels();

    const current = await Notifications.getPermissionsAsync();
    const granted =
      current.granted || (ask && (await Notifications.requestPermissionsAsync()).granted);

    if (!granted) return null;

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

    await api.registerDevice({
      push_token: token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      app_version: Constants.expoConfig?.version ?? null,
    });

    return token;
  } catch (error) {
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


/**
 * Тестовое уведомление на разработке: телефон показывает его сам, без сервера
 * и без Firebase. Нужно, чтобы посмотреть на вид и звук ещё до сборки.
 */
export async function sendTestNotification(): Promise<boolean> {
  const allowed = await pushAllowed();
  if (!allowed) return false;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Курьер в пути · заказ № 1024',
      body: 'Скоро будем у вас',
      sound: 'default',
      data: { screen: 'order' },
    },
    // Через пять секунд: успеете заблокировать телефон и увидеть, как придёт
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 5,
    },
  });

  return true;
}
