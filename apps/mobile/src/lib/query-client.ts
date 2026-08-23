import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, type Query } from '@tanstack/react-query';
import Constants from 'expo-constants';

/**
 * Общий клиент запросов. Живёт отдельно от корневого экрана, чтобы прогревать
 * данные можно было и до того, как отрисуется первый экран.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 2,
      // Возврат в приложение — повод перечитать данные: пока гость выбирал,
      // ресторан мог убрать блюдо со стоп-листа или вернуть его
      refetchOnWindowFocus: true,
    },
  },
});

/** Что кладём на диск: только общий каталог, ничего личного. */
const PUBLIC_KEYS = ['menu', 'restaurants', 'cities', 'promotions', 'popular'];

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'mr-cache',
});

export const persistOptions = {
  persister,
  // Сутки: меню меняется редко, но вчерашним ценам верить уже нельзя
  maxAge: 24 * 60 * 60 * 1000,
  // Новая версия приложения — новый формат данных, старый кэш выбрасываем
  buster: Constants.expoConfig?.version ?? '1',
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Query) => {
      const first = query.queryKey[0];

      // Заказы, адреса и профиль на диск не пишем: это персональные данные,
      // и по ФЗ-152 им незачем лежать в открытом хранилище телефона
      return typeof first === 'string' && PUBLIC_KEYS.includes(first) && query.state.status === 'success';
    },
  },
};
