import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const KEY = 'mr-push-ask';

type PushAskState = {
  /** Гость ответил «не сейчас» — снова спросим только после следующего заказа. */
  postponed: boolean;
  /** Ответ уже получен в этой сессии: плашку больше не показываем. */
  answered: boolean;
  restore: () => Promise<void>;
  postpone: () => void;
  answer: () => void;
  /** Новый заказ — повод предложить ещё раз тем, кто откладывал. */
  revive: () => void;
};

/**
 * Память про предложение включить уведомления. Отдельно от самих уведомлений:
 * системное окно показывается один раз в жизни, и тратить его на человека,
 * который сказал «потом», нельзя.
 */
export const usePushAsk = create<PushAskState>((set) => ({
  postponed: false,
  answered: false,

  restore: async () => {
    const saved = await AsyncStorage.getItem(KEY);
    set({ postponed: saved === 'postponed', answered: saved === 'answered' });
  },

  postpone: () => {
    set({ postponed: true, answered: true });
    void AsyncStorage.setItem(KEY, 'postponed');
  },

  answer: () => {
    set({ answered: true, postponed: false });
    void AsyncStorage.setItem(KEY, 'answered');
  },

  revive: () => {
    set((state) => (state.postponed ? { ...state, answered: false } : state));
  },
}));
