import { create } from 'zustand';

import type { AddressSuggestion } from '@/api/client';

type DraftState = {
  /** Что выбрали на карте — форма адреса заберёт это, когда вернётся в фокус. */
  picked: AddressSuggestion | null;
  pick: (value: AddressSuggestion) => void;
  clear: () => void;
};

export const useAddressDraft = create<DraftState>((set) => ({
  picked: null,
  pick: (value) => set({ picked: value }),
  clear: () => set({ picked: null }),
}));
