import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type Appearance = 'light' | 'dark';

const KEY = 'mr-appearance';

type AppearanceState = {
  mode: Appearance;
  ready: boolean;
  restore: () => Promise<void>;
  set: (mode: Appearance) => void;
};

/**
 * Оформление приложения. По умолчанию светлое — таким сделан бренд, и от
 * настроек телефона это не зависит. Выбор гостя переживает перезапуск.
 */
export const useAppearance = create<AppearanceState>((set) => ({
  mode: 'light',
  ready: false,

  restore: async () => {
    const saved = await AsyncStorage.getItem(KEY);
    set({ mode: saved === 'dark' ? 'dark' : 'light', ready: true });
  },

  set: (mode) => {
    set({ mode });
    void AsyncStorage.setItem(KEY, mode);
  },
}));
