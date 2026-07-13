import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format, subMonths, addMonths } from 'date-fns';
import { exchangeRatesApi } from '../api/exchangeRates';
import { useWorkspaceStore } from '../store/workspaceSlice';
import { useCurrency } from '../hooks/useCurrency';

interface ExchangeRateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExchangeRateModal({ isOpen, onClose }: ExchangeRateModalProps) {
  const queryClient = useQueryClient();
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const { exchangeRates } = useCurrency();

  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), 'yyyy-MM'));
  const [rate, setRate] = useState('');

  // Get existing rate for selected month
  const existingRate = exchangeRates.find((r) => r.month === selectedMonth);

  useEffect(() => {
    if (existingRate) {
      setRate(existingRate.rate.toString());
    } else {
      setRate('');
    }
  }, [existingRate, selectedMonth]);

  const upsertMutation = useMutation({
    mutationFn: (data: { month: string; rate: number }) =>
      exchangeRatesApi.upsert(currentWorkspace!.id, data.month, data.rate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (month: string) => exchangeRatesApi.delete(currentWorkspace!.id, month),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
      setRate('');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rateValue = parseFloat(rate);
    if (isNaN(rateValue) || rateValue <= 0) return;

    upsertMutation.mutate({ month: selectedMonth, rate: rateValue });
  };

  const handleDelete = () => {
    if (existingRate) {
      deleteMutation.mutate(selectedMonth);
    }
  };

  const handlePrevMonth = () => {
    const date = new Date(selectedMonth + '-01');
    setSelectedMonth(format(subMonths(date, 1), 'yyyy-MM'));
  };

  const handleNextMonth = () => {
    const date = new Date(selectedMonth + '-01');
    setSelectedMonth(format(addMonths(date, 1), 'yyyy-MM'));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface-container-lowest rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-headline font-bold">Exchange Rates</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-center gap-4 mb-4">
            <button
              onClick={handlePrevMonth}
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container transition-colors"
            >
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            <span className="font-headline font-bold text-lg min-w-[120px] text-center">
              {format(new Date(selectedMonth + '-01'), 'MMM yyyy')}
            </span>
            <button
              onClick={handleNextMonth}
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container transition-colors"
            >
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-on-surface-variant mb-2">
                ARS per USD
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="e.g., 1200.50"
                className="w-full px-4 py-3 rounded-xl border border-surface-container bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-on-surface-variant mt-1">
                Enter the exchange rate for {format(new Date(selectedMonth + '-01'), 'MMMM yyyy')}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={!rate || upsertMutation.isPending}
                className="flex-1 px-4 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {upsertMutation.isPending ? 'Saving...' : existingRate ? 'Update Rate' : 'Set Rate'}
              </button>
              {existingRate && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="px-4 py-3 rounded-xl border border-error text-error font-semibold hover:bg-error/10 disabled:opacity-50 transition-colors"
                >
                  <span className="material-symbols-outlined text-lg">delete</span>
                </button>
              )}
            </div>
          </form>
        </div>

        {/* List of existing rates */}
        <div className="border-t border-surface-container pt-4">
          <h3 className="text-sm font-semibold text-on-surface-variant mb-3">Saved Rates</h3>
          {exchangeRates.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {exchangeRates.map((r) => (
                <button
                  key={r.month}
                  onClick={() => setSelectedMonth(r.month)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
                    r.month === selectedMonth
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-surface-container'
                  }`}
                >
                  <span className="font-medium">
                    {format(new Date(r.month + '-01'), 'MMM yyyy')}
                  </span>
                  <span className="text-sm">
                    ${r.rate.toLocaleString('en-US', { minimumFractionDigits: 2 })} / USD
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant opacity-60 text-center py-4">
              No exchange rates set yet
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
