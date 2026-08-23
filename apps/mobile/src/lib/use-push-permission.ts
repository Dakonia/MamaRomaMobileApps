import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { pushAllowed } from '@/lib/push';

/**
 * Разрешение телефона на уведомления, живое.
 *
 * Гость уходит в настройки, включает уведомления и возвращается — приложение
 * должно это заметить. Одной проверки при открытии экрана мало: она случается
 * до похода в настройки, и переключатели остаются в старом состоянии.
 */
export function usePushPermission(): boolean {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let alive = true;

    const check = () => {
      void pushAllowed().then((granted) => {
        if (alive) setAllowed(granted);
      });
    };

    check();

    const listener = AppState.addEventListener('change', (status) => {
      if (status === 'active') check();
    });

    return () => {
      alive = false;
      listener.remove();
    };
  }, []);

  return allowed;
}
