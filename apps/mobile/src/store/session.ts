import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { identify, track } from '@/lib/analytics';

import { useCart } from '@/store/cart';

import {
  api,
  onTokens,
  setAccessToken,
  setTokens,
  type Guest,
  type Loyalty,
  type Session,
} from '@/api/client';

const ACCESS_KEY = 'mr.access_token';
const REFRESH_KEY = 'mr.refresh_token';

// SecureStore не работает в браузере. Веб у нас только для быстрого просмотра,
// поэтому там сессия живёт до перезагрузки страницы и на диск не попадает.
const storage = {
  get: async (key: string) => (Platform.OS === 'web' ? null : SecureStore.getItemAsync(key)),
  set: async (key: string, value: string) => {
    if (Platform.OS !== 'web') await SecureStore.setItemAsync(key, value);
  },
  remove: async (key: string) => {
    if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(key);
  },
};

type SessionState = {
  status: 'restoring' | 'anonymous' | 'authorized';
  guest: Guest | null;
  loyalty: Loyalty | null;
  restore: () => Promise<void>;
  signIn: (session: Session) => Promise<void>;
  signOut: () => Promise<void>;
  setGuest: (guest: Guest) => void;
};

export const useSession = create<SessionState>((set) => ({
  status: 'restoring',
  guest: null,
  loyalty: null,

  restore: async () => {
    const [access, refresh] = await Promise.all([
      storage.get(ACCESS_KEY),
      storage.get(REFRESH_KEY),
    ]);

    if (!access) {
      set({ status: 'anonymous' });
      return;
    }

    setTokens(access, refresh);
    try {
      const profile = await api.me();
      identify(profile.guest.id);
      set({ status: 'authorized', guest: profile.guest, loyalty: profile.loyalty });
    } catch {
      // Обе стороны пары мертвы — начинаем как аноним, без падений
      setTokens(null, null);
      await storage.remove(ACCESS_KEY);
      await storage.remove(REFRESH_KEY);
      set({ status: 'anonymous', guest: null, loyalty: null });
    }
  },

  signIn: async (session) => {
    await storage.set(ACCESS_KEY, session.access_token);
    await storage.set(REFRESH_KEY, session.refresh_token);
    setTokens(session.access_token, session.refresh_token);
    identify(session.guest.id);
    track('signed_in', { tier: session.loyalty?.tier_code ?? null });
    set({ status: 'authorized', guest: session.guest, loyalty: session.loyalty });
  },

  signOut: async () => {
    await storage.remove(ACCESS_KEY);
    await storage.remove(REFRESH_KEY);
    setAccessToken(null);
    setTokens(null, null);

    track('signed_out');

    // Корзина, адрес и выбранный ресторан принадлежали прошлому гостю
    useCart.getState().reset();

    set({ status: 'anonymous', guest: null, loyalty: null });
  },

  setGuest: (guest) => set({ guest }),
}));

// Клиент сам меняет протухший токен на свежий — здесь только сохраняем результат
onTokens((tokens) => {
  if (tokens === null) {
    void useSession.getState().signOut();
    return;
  }

  void storage.set(ACCESS_KEY, tokens.access);
  void storage.set(REFRESH_KEY, tokens.refresh);
});
