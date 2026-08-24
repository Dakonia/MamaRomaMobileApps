import { create } from 'zustand';

type State = {
  /** Идёт ли обновление прямо сейчас. */
  active: boolean;
  /** Откуда рисовать значок: у экранов с плавающей шапкой он ниже. */
  top: number;
  start: (top: number) => void;
  stop: () => void;
};

/**
 * Общее состояние жеста «потянуть, чтобы обновить».
 *
 * Значок живёт не внутри списка, а поверх всего приложения: системный
 * RefreshControl не умеет показывать свою картинку, поэтому его вид мы гасим,
 * а рисуем поверх свой. Так экраны не пришлось переписывать — они по-прежнему
 * отдают жесту только список запросов.
 */
export const useRefreshing = create<State>((set) => ({
  active: false,
  top: 0,
  start: (top) => set({ active: true, top }),
  stop: () => set({ active: false }),
}));
