/**
 * Заглушки нативных модулей: в тестах их нет, а без них падает импорт.
 *
 * Хранилище корзины подменяем библиотечной заглушкой — она сохраняет данные в
 * памяти, чего для проверки счёта достаточно. Аналитику глушим целиком: в
 * тестах некуда и незачем отправлять события.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@/lib/analytics', () => ({
  track: jest.fn(),
  trackCartAdd: jest.fn(),
  trackCartRemove: jest.fn(),
  trackCheckout: jest.fn(),
  trackProductView: jest.fn(),
  trackPurchase: jest.fn(),
  trackRevenue: jest.fn(),
  trackError: jest.fn(),
  trackScreen: jest.fn(),
  startAnalytics: jest.fn(),
  identify: jest.fn(),
  describe: jest.fn(),
}));

/**
 * Нативные виды, которых в тестах нет: снимок блюда и отдача при нажатии.
 * Проверяем поведение, а не картинку, поэтому подменяем их простыми заглушками.
 */
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: View };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

/** Токены гостя лежат в защищённом хранилище телефона — в тестах его нет. */
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
