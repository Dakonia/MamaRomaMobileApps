import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

import type { Point } from '@/lib/geo';

type State = {
  coords: Point | null;
  /** Разрешение ещё не спрашивали — можно предложить показать ближайшие. */
  askable: boolean;
  denied: boolean;
  ask: () => void;
};

async function read(): Promise<Point | null> {
  // Последняя известная точка приходит мгновенно, свежую ждём только если её нет
  const last = await Location.getLastKnownPositionAsync();
  const position = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  return position ? { latitude: position.coords.latitude, longitude: position.coords.longitude } : null;
}

/**
 * Где сейчас гость. Без спроса разрешение не запрашиваем: если оно уже выдано —
 * берём точку молча, иначе экран сам решает, когда предложить.
 */
export function useCoords(): State {
  const [coords, setCoords] = useState<Point | null>(null);
  const [askable, setAskable] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const granted = await Location.getForegroundPermissionsAsync();
        if (!alive) return;

        if (!granted.granted) {
          setAskable(granted.canAskAgain);
          setDenied(!granted.canAskAgain);
          return;
        }

        const point = await read();
        if (alive) setCoords(point);
      } catch {
        // Геолокация недоступна — экран просто обойдётся без неё
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const ask = useCallback(() => {
    void (async () => {
      try {
        const granted = await Location.requestForegroundPermissionsAsync();
        if (!granted.granted) {
          setAskable(false);
          setDenied(true);
          return;
        }

        setAskable(false);
        setCoords(await read());
      } catch {
        setAskable(false);
      }
    })();
  }, []);

  return { coords, askable, denied, ask };
}
