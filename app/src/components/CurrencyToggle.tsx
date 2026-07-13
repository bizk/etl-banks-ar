import { useCurrency } from '../hooks/useCurrency';

export function CurrencyToggle() {
  const { currency, toggleCurrency } = useCurrency();

  return (
    <button
      onClick={toggleCurrency}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-low hover:bg-surface-container transition-colors text-sm font-semibold"
      title={`Switch to ${currency === 'ARS' ? 'USD' : 'ARS'}`}
    >
      <span className="material-symbols-outlined text-base">currency_exchange</span>
      <span>{currency}</span>
    </button>
  );
}
