import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { exchangeRatesApi } from '../api/exchangeRates';
import { useCurrencyStore } from '../store/currencySlice';
import { useWorkspaceStore } from '../store/workspaceSlice';

export function useCurrency() {
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const currency = useCurrencyStore((state) => state.currency);
  const toggleCurrency = useCurrencyStore((state) => state.toggleCurrency);

  // Fetch all exchange rates for the workspace
  const { data: exchangeRatesData } = useQuery({
    queryKey: ['exchange-rates', currentWorkspace?.id],
    queryFn: () => exchangeRatesApi.list(currentWorkspace!.id),
    enabled: !!currentWorkspace?.id,
  });

  const exchangeRates = exchangeRatesData?.exchange_rates || [];

  // Create a map of month -> rate for quick lookup
  const ratesByMonth = exchangeRates.reduce((acc, rate) => {
    acc[rate.month] = rate.rate;
    return acc;
  }, {} as Record<string, number>);

  // Format amount based on current currency and optional month for conversion
  const formatAmount = useCallback(
    (amount: number, month?: string): string => {
      if (currency === 'ARS') {
        return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }

      // Convert to USD if we have a rate for the month
      const rate = month ? ratesByMonth[month] : null;
      if (rate && rate > 0) {
        const usdAmount = amount / rate;
        return `US$${usdAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }

      // No rate available, show ARS with indicator
      return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`;
    },
    [currency, ratesByMonth]
  );

  // Convert amount to USD if applicable
  const convertAmount = useCallback(
    (amount: number, month?: string): number => {
      if (currency === 'ARS') {
        return amount;
      }

      const rate = month ? ratesByMonth[month] : null;
      if (rate && rate > 0) {
        return amount / rate;
      }

      return amount;
    },
    [currency, ratesByMonth]
  );

  // Get the rate for a specific month
  const getRateForMonth = useCallback(
    (month: string): number | null => {
      return ratesByMonth[month] || null;
    },
    [ratesByMonth]
  );

  // Check if we have a rate for the given month
  const hasRateForMonth = useCallback(
    (month: string): boolean => {
      return month in ratesByMonth;
    },
    [ratesByMonth]
  );

  return {
    currency,
    toggleCurrency,
    formatAmount,
    convertAmount,
    getRateForMonth,
    hasRateForMonth,
    exchangeRates,
    isUSD: currency === 'USD',
  };
}
