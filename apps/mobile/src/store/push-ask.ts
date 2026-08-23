import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const KEY = 'mr-push-ask';
const WANTED_KEY = 'mr-push-wanted';
const ASKED_KEY = 'mr-push-asked';
const LAUNCH_KEY = 'mr-push-launches';
const NAG_KEY = 'mr-push-nag';

/** Через столько запусков напоминаем тем, кто запретил уведомления в системе. */
const NAG_EVERY = 20;

/** Больше двух раз не предлагаем: третий заход — уже навязчивость. */
const MAX_ASKS = 2;

type PushAskState = {
  /**
   * Выбор гостя в профиле. Отдельно от системного разрешения: разрешение
   * телефона можно выдать один раз навсегда, а тумблером гость пользуется
   * как хочет — и его «выключено» должно переживать перезапуск.
   */
  wanted: boolean;
  /** Гость ответил «не сейчас» — снова спросим только после следующего заказа. */
  postponed: boolean;
  /** Ответ уже получен в этой сессии: плашку больше не показываем. */
  answered: boolean;
  restore: () => Promise<void>;
  setWanted: (wanted: boolean) => void;
  postpone: () => void;
  answer: () => void;
  /** Новый заказ — повод предложить ещё раз тем, кто откладывал. */
  revive: () => void;
  /** Сколько раз уже предлагали: предел бережёт от навязчивости. */
  asked: number;
  /** Сколько раз открывали приложение: по ним отмеряем редкие напоминания. */
  launches: number;
  /** На каком запуске напомнить тем, кто запретил уведомления в настройках. */
  nagAt: number;
  /** «Пропустить» на напоминании: вернёмся через два десятка запусков. */
  skipNag: () => void;
};

/**
 * Память про предложение включить уведомления. Отдельно от самих уведомлений:
 * системное окно показывается один раз в жизни, и тратить его на человека,
 * который сказал «потом», нельзя.
 */
export const usePushAsk = create<PushAskState>((set) => ({
  postponed: false,
  answered: false,
  wanted: true,
  asked: 0,
  launches: 0,
  nagAt: NAG_EVERY,

  restore: async () => {
    const [saved, wanted, asked, launches, nagAt] = await Promise.all([
      AsyncStorage.getItem(KEY),
      AsyncStorage.getItem(WANTED_KEY),
      AsyncStorage.getItem(ASKED_KEY),
      AsyncStorage.getItem(LAUNCH_KEY),
      AsyncStorage.getItem(NAG_KEY),
    ]);

    // Запуск считаем здесь: восстановление случается ровно раз за открытие
    const count = Number(launches ?? 0) + 1;
    void AsyncStorage.setItem(LAUNCH_KEY, String(count));

    set({
      postponed: saved === 'postponed',
      answered: saved === 'answered',
      // Пока гость не трогал тумблер, считаем, что уведомления ему нужны
      wanted: wanted !== 'off',
      asked: Number(asked ?? 0),
      launches: count,
      nagAt: Number(nagAt ?? NAG_EVERY),
    });
  },

  setWanted: (wanted) => {
    set({ wanted });
    void AsyncStorage.setItem(WANTED_KEY, wanted ? 'on' : 'off');
  },

  postpone: () => {
    set((state) => {
      const asked = state.asked + 1;
      void AsyncStorage.setItem(ASKED_KEY, String(asked));
      return { ...state, postponed: true, answered: true, asked };
    });
    void AsyncStorage.setItem(KEY, 'postponed');
  },

  answer: () => {
    set((state) => {
      const asked = state.asked + 1;
      void AsyncStorage.setItem(ASKED_KEY, String(asked));
      return { ...state, answered: true, postponed: false, asked };
    });
    void AsyncStorage.setItem(KEY, 'answered');
  },

  revive: () => {
    // Возвращаемся только к тем, кто откладывал, и только пока есть запас попыток
    set((state) =>
      state.postponed && state.asked < MAX_ASKS ? { ...state, answered: false } : state,
    );
  },

  skipNag: () => {
    set((state) => {
      const nagAt = state.launches + NAG_EVERY;
      void AsyncStorage.setItem(NAG_KEY, String(nagAt));
      return { ...state, nagAt };
    });
  },

}));
