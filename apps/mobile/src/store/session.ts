import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { api, setAccessToken, type Guest, type Loyalty, type Session } from '@/api/client';

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
};

export const useSession = create<SessionState>((set) => ({
  status: 'restoring',
  guest: null,
  loyalty: null,

  restore: async () => {
    const token = await storage.get(ACCESS_KEY);
    if (!token) {
      set({ status: 'anonymous' });
      return;
    }

    setAccessToken(token);
    try {
      const profile = await api.me();
      set({ status: 'authorized', guest: profile.guest, loyalty: profile.loyalty });
    } catch {
      // Токен протух или отозван — начинаем как аноним, без падений
      setAccessToken(null);
      await storage.remove(ACCESS_KEY);
      await storage.remove(REFRESH_KEY);
      set({ status: 'anonymous', guest: null, loyalty: null });
    }
  },

  signIn: async (session) => {
    await storage.set(ACCESS_KEY, session.access_token);
    await storage.set(REFRESH_KEY, session.refresh_token);
    setAccessToken(session.access_token);
    set({ status: 'authorized', guest: session.guest, loyalty: session.loyalty });
  },

  signOut: async () => {
    await storage.remove(ACCESS_KEY);
    await storage.remove(REFRESH_KEY);
    setAccessToken(null);
    set({ status: 'anonymous', guest: null, loyalty: null });
  },
}));
