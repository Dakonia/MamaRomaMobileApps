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
