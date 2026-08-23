import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { trackError } from '@/lib/analytics';

/**
 * Обновления по воздуху: правки на TypeScript прилетают гостю сами, без
 * магазина. Обновление скачивается в фоне и применяется, когда гость сам
 * решит — прерывать его на середине заказа мы не будем.
 */
export function useAppUpdate(): { ready: boolean; apply: () => void } {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // В разработке обновления не работают вовсе — там код и так свежий
    if (__DEV__ || !Updates.isEnabled) return;

    let alive = true;

    const check = async () => {
      try {
        const found = await Updates.checkForUpdateAsync();
        if (!found.isAvailable || !alive) return;

        await Updates.fetchUpdateAsync();
        if (alive) setReady(true);
      } catch (error) {
        // Нет сети или сервер обновлений недоступен — просто работаем дальше
        trackError('Не удалось проверить обновление', error);
      }
    };

    void check();

    // Возврат в приложение — хороший момент проверить ещё раз
    const listener = AppState.addEventListener('change', (status) => {
      if (status === 'active') void check();
    });

    return () => {
      alive = false;
      listener.remove();
    };
  }, []);

  return {
    ready,
    apply: () => {
      void Updates.reloadAsync();
    },
  };
}
