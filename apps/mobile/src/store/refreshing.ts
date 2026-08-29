import { create } from 'zustand';

type State = {
  /** Кто прямо сейчас обновляется: экран → откуда рисовать значок. */
  running: Record<string, number>;
  start: (id: string, top: number) => void;
  stop: (id: string) => void;
};

/**
 * Общее состояние жеста «потянуть, чтобы обновить».
 *
 * Значок живёт не внутри списка, а поверх всего приложения: системный
 * RefreshControl не умеет показывать свою картинку, поэтому его вид мы гасим,
 * а рисуем поверх свой.
 *
 * Держим не флаг, а перечень обновляющихся экранов. Флаг был общим на всех, и
 * стоило одному экрану не сообщить об окончании — пицца крутилась вечно, потому
 * что выключить её было некому. С перечнем каждый экран отвечает только за свою
 * запись и убирает её сам, в том числе когда его закрыли.
 */
export const useRefreshing = create<State>((set) => ({
  running: {},

  start: (id, top) => set((state) => ({ running: { ...state.running, [id]: top } })),

  stop: (id) =>
    set((state) => {
      if (!(id in state.running)) return state;

      const running = { ...state.running };
      delete running[id];
      return { running };
    }),
}));

/** Показывать ли значок и на какой высоте: берём самый нижний из активных. */
export function refreshingTop(running: Record<string, number>): number | null {
  const values = Object.values(running);
  return values.length > 0 ? Math.max(...values) : null;
}
