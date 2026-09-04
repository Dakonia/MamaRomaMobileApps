import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { apiUrl } from '@/lib/tenant';

/**
 * Связь проверяем по нашему серверу, а не по гугловской заглушке.
 *
 * Гостю всё равно, ходит ли интернет вообще: меню, заказы и баллы живут у
 * нас, и «интернет есть, а сервер недоступен» для него то же самое, что
 * офлайн. К тому же в российских сетях гугловский адрес отвечает через раз,
 * и приложение объявляло офлайн там, где всё работало.
 *
 * Проверку делаем быстрой: по умолчанию она ждёт ответа секундами, и в
 * авиарежиме приложение узнавало о потере связи с задержкой.
 */
NetInfo.configure({
  reachabilityUrl: `${apiUrl}/ping`,
  reachabilityTest: async (response) => response.status === 200,
  reachabilityShortTimeout: 3_000,
  // Реже, чем раз в минуту, спрашивать незачем: на двадцати пяти ресторанах
  // это тысячи телефонов, и каждая проверка — запрос к серверу
  reachabilityLongTimeout: 60_000,
  reachabilityRequestTimeout: 4_000,
});

type State = { isConnected: boolean | null; isInternetReachable: boolean | null };

/**
 * Связь есть, если телефон подключён к сети и интернет через неё ходит.
 * Отключение сети (авиарежим) видно сразу, а «вайфай без интернета» —
 * только после проверки, поэтому неизвестность считаем связью.
 */
function alive(state: State): boolean {
  if (state.isConnected === false) return false;
  return state.isInternetReachable !== false;
}

/** React Query должен знать о сети: без этого запросы уходят в пустоту. */
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(alive(state))),
);

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const stop = NetInfo.addEventListener((state) => setOnline(alive(state)));
    void NetInfo.refresh().then((state) => setOnline(alive(state)));

    return stop;
  }, []);

  return online;
}

/** Перепроверить связь по кнопке: гость включил вайфай и хочет продолжить. */
export async function recheck(): Promise<boolean> {
  const state = await NetInfo.refresh();
  return alive(state);
}
