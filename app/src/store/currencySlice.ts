import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Currency = 'ARS' | 'USD';

interface CurrencyState {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  toggleCurrency: () => void;
}

export const useCurrencyStore = create<CurrencyState>()(
  persist(
    (set) => ({
      currency: 'ARS',
      setCurrency: (currency) => set({ currency }),
      toggleCurrency: () =>
        set((state) => ({
          currency: state.currency === 'ARS' ? 'USD' : 'ARS',
        })),
    }),
    {
      name: 'currency-storage',
    }
  )
);
