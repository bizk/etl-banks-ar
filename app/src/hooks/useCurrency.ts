import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { exchangeRatesApi } from '../api/exchangeRates';
import { useCurrencyStore } from '../store/currencySlice';
import { useWorkspaceStore } from '../store/workspaceSlice';

export function useCurrency() {
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const currency = useCurrencyStore((state) => state.currency);
  const toggleCurrency = useCurrencyStore((state) => state.toggleCurrency);
  const { data: exchangeRatesData } = useQuery({
    queryKey: ['exchange-rates', currentWorkspace?.id],
    queryFn: () => exchangeRatesApi.list(currentWorkspace!.id),
    enabled: !!currentWorkspace?.id,
  });
  const ratesByMonth = useMemo(() => Object.fromEntries(
    (exchangeRatesData?.exchange_rates || []).map(({ month, rate }) => [month, rate])
  ) as Record<string, number>, [exchangeRatesData]);
  const getRateForMonth = useCallback((month: string): number | null => {
    if (ratesByMonth[month] > 0) return ratesByMonth[month];
    const earlierMonths = Object.keys(ratesByMonth).filter((key) => key < month).sort();
    const previous = earlierMonths[earlierMonths.length - 1];
    return previous ? ratesByMonth[previous] : null;
  }, [ratesByMonth]);
  const formatAmount = useCallback((amount: number, month?: string): string => {
    const rate = currency === 'USD' && month ? getRateForMonth(month) : null;
    const value = rate ? amount / rate : amount;
    const symbol = rate ? 'US$' : '$';
    return `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency === 'USD' && !rate ? '*' : ''}`;
  }, [currency, getRateForMonth]);
  const convertAmount = useCallback((amount: number, month?: string): number => {
    const rate = currency === 'USD' && month ? getRateForMonth(month) : null;
    return rate ? amount / rate : amount;
  }, [currency, getRateForMonth]);
  return {
    currency, toggleCurrency, formatAmount, convertAmount, getRateForMonth,
    hasRateForMonth: (month: string) => getRateForMonth(month) !== null,
    exchangeRates: exchangeRatesData?.exchange_rates || [], isUSD: currency === 'USD',
  };
}
