import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addYears, format, subYears } from 'date-fns';
import { ResponsiveContainer, Treemap } from 'recharts';
import { areasApi } from '../api/areas';
import { transactionsApi } from '../api/transactions';
import { useWorkspaceStore } from '../store/workspaceSlice';
import { getCategoryMeta } from '../components/transactions/categoryMeta';
import { useCurrency } from '../hooks/useCurrency';

const DEFAULT_COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444',
  '#ec4899', '#6366f1', '#14b8a6', '#84cc16', '#f97316',
];

function YearlyTreemapCell(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  value?: number;
  depth?: number;
  payload?: {
    name?: string;
    size?: number;
    fill?: string;
  };
  root?: {
    children?: Array<{ value?: number }>;
  };
}) {
  const { x, y, width, height, name, value, depth, payload } = props;
  if (x == null || y == null || width == null || height == null || width <= 0 || height <= 0) {
    return null;
  }

  if (depth != null && depth < 1) {
    return null;
  }

  const label = name || payload?.name || 'Uncategorized';
  const amount = value ?? payload?.size ?? 0;
  const fill = payload?.fill || '#10b981';
  const fontSize = width > 140 && height > 90 ? 15 : 12;
  const amountFontSize = width > 140 && height > 90 ? 13 : 11;
  const showAmount = width > 90 && height > 54;
  const showLabel = width > 70 && height > 34;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={12}
        ry={12}
        fill={fill}
        fillOpacity={0.98}
        stroke="#ffffff"
        strokeWidth={3}
      />
      <rect
        x={x}
        y={y}
        width={width}
        height={Math.max(height * 0.34, 18)}
        rx={12}
        ry={12}
        fill="rgba(255,255,255,0.12)"
      />
      {showLabel && (
        <text x={x + 12} y={y + 24} fill="#ffffff" fontSize={fontSize} fontWeight={800}>
          {label}
        </text>
      )}
      {showAmount && (
        <text x={x + 12} y={y + 44} fill="rgba(255,255,255,0.92)" fontSize={amountFontSize} fontWeight={600}>
          ${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </text>
      )}
    </g>
  );
}

export function InsightsPage() {
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const selectedMonth = useWorkspaceStore((state) => state.selectedMonth);
  const setSelectedMonth = useWorkspaceStore((state) => state.setSelectedMonth);
  const currentDate = new Date(selectedMonth);
  const year = format(currentDate, 'yyyy');
  const { formatAmount } = useCurrency();

  const [expandedAreas, setExpandedAreas] = useState<Set<number | null>>(new Set());

  const toggleAreaExpanded = (areaId: number | null) => {
    setExpandedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(areaId)) {
        next.delete(areaId);
      } else {
        next.add(areaId);
      }
      return next;
    });
  };

  // Fetch yearly transaction summary for totals
  const { data: yearlySummaryData, isLoading: isYearlySummaryLoading } = useQuery({
    queryKey: ['yearly-summary', currentWorkspace?.id, year],
    queryFn: () => transactionsApi.getYearlySummary(currentWorkspace!.id, year),
    enabled: !!currentWorkspace?.id,
  });

  // Fetch yearly area summary for treemap and records
  const { data: yearlyAreaData, isLoading: isAreaLoading } = useQuery({
    queryKey: ['yearly-area-summary', currentWorkspace?.id, year],
    queryFn: () => areasApi.getYearlySummary(currentWorkspace!.id, year),
    enabled: !!currentWorkspace?.id,
  });

  const yearlySummary = yearlySummaryData?.summary;
  const yearlyAreas = yearlyAreaData?.areas || [];

  const handlePrevYear = () => setSelectedMonth(subYears(currentDate, 1));
  const handleNextYear = () => setSelectedMonth(addYears(currentDate, 1));

  // Treemap data using areas
  const yearlyTreemapData = useMemo(
    () =>
      yearlyAreas
        .filter((area) => area.amount > 0)
        .map((area, index) => ({
          name: area.area_name || 'Uncategorized',
          size: area.amount,
          fill: area.area_id === null ? '#9ca3af' : (area.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]),
        }))
        .sort((a, b) => b.size - a.size),
    [yearlyAreas]
  );

  // Area comparison data with "vs last month" calculation
  const yearlyAreaComparison = useMemo(
    () =>
      yearlyAreas.map((area, areaIndex) => {
        // Calculate average excluding months with 0 spending
        const nonZeroMonths = area.monthly.filter((m) => m.amount > 0);
        const average = nonZeroMonths.length > 0
          ? nonZeroMonths.reduce((sum, entry) => sum + entry.amount, 0) / nonZeroMonths.length
          : 0;

        const areaColor = area.area_id === null ? '#9ca3af' : (area.color || DEFAULT_COLORS[areaIndex % DEFAULT_COLORS.length]);
        const areaIcon = area.area_id === null ? 'help_outline' : (area.icon || 'category');

        return {
          ...area,
          color: areaColor,
          icon: areaIcon,
          average,
          monthly: area.monthly.map((entry, monthIndex) => {
            // Use last month comparison instead of average
            const lastMonthAmount = monthIndex > 0
              ? area.monthly[monthIndex - 1].amount
              : 0; // For January, we'd need previous year's December (simplified to 0 for now)

            const percentFromLastMonth = lastMonthAmount > 0
              ? ((entry.amount - lastMonthAmount) / lastMonthAmount) * 100
              : null;

            let tone: 'positive' | 'negative' | 'neutral' = 'neutral';
            if (percentFromLastMonth !== null && Math.abs(percentFromLastMonth) > 10) {
              tone = percentFromLastMonth < 0 ? 'positive' : 'negative';
            }

            return {
              ...entry,
              lastMonthAmount,
              tone,
              percentFromLastMonth,
            };
          }),
        };
      }).sort((a, b) => b.amount - a.amount),
    [yearlyAreas]
  );

  const isLoading = isYearlySummaryLoading || isAreaLoading;

  if (!currentWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <span className="material-symbols-outlined text-6xl text-on-surface-variant opacity-30 mb-4">workspaces</span>
        <h2 className="text-xl font-headline font-bold text-on-surface-variant">No Workspace Selected</h2>
        <p className="text-on-surface-variant mt-2">Create or select a workspace to get started</p>
      </div>
    );
  }

  return (
    <div>
      <header className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-4xl font-headline font-extrabold tracking-tight text-on-surface">Insights</h1>
          <p className="text-on-surface-variant mt-2 font-medium opacity-60">
            Yearly overview and month-over-month signals for {year}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-surface-container-low rounded-full px-2">
            <button
              onClick={handlePrevYear}
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container transition-colors"
            >
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            <span className="font-headline font-bold px-4">{year}</span>
            <button
              onClick={handleNextYear}
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container transition-colors"
            >
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-container"></div>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="bg-surface-container-lowest p-8 rounded-xl">
              <p className="text-sm font-semibold uppercase tracking-widest text-on-surface-variant opacity-50">Yearly Spending</p>
              <p className="mt-4 text-4xl font-headline font-extrabold">
                {formatAmount(yearlySummary?.total_spending || 0)}
              </p>
            </div>
            <div className="bg-surface-container-lowest p-8 rounded-xl">
              <p className="text-sm font-semibold uppercase tracking-widest text-on-surface-variant opacity-50">Yearly Income</p>
              <p className="mt-4 text-4xl font-headline font-extrabold text-primary">
                {formatAmount(yearlySummary?.total_income || 0)}
              </p>
            </div>
            <div className="bg-surface-container-lowest p-8 rounded-xl">
              <p className="text-sm font-semibold uppercase tracking-widest text-on-surface-variant opacity-50">Net</p>
              <p className={`mt-4 text-4xl font-headline font-extrabold ${(yearlySummary?.net || 0) >= 0 ? 'text-primary' : 'text-error'}`}>
                {formatAmount(Math.abs(yearlySummary?.net || 0))}
              </p>
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-8 mb-12">
            <div className="bg-surface-container-lowest p-8 rounded-xl">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-xl font-headline font-bold">Yearly Area Treemap</h3>
                  <p className="text-sm text-on-surface-variant mt-1">Area share across the full year</p>
                </div>
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-low text-on-surface">
                  <span className="material-symbols-outlined">account_tree</span>
                </span>
              </div>

              {yearlyTreemapData.length > 0 ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <Treemap
                      data={yearlyTreemapData}
                      dataKey="size"
                      nameKey="name"
                      aspectRatio={4 / 3}
                      stroke="#f8fafc"
                      fill="#10b981"
                      content={<YearlyTreemapCell />}
                    />
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-80 flex items-center justify-center text-on-surface-variant">
                  No yearly area data available
                </div>
              )}
            </div>

            <div className="bg-surface-container-lowest p-8 rounded-xl">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-xl font-headline font-bold">Average Benchmarks</h3>
                  <p className="text-sm text-on-surface-variant mt-1">Average monthly spend for each area (excluding $0 months).</p>
                </div>
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <span className="material-symbols-outlined">rule</span>
                </span>
              </div>

              <div className="space-y-4">
                {yearlyAreaComparison.slice(0, 6).map((area) => (
                  <div key={area.area_id ?? 'uncategorized'} className="rounded-2xl bg-surface-container-low p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
                          style={{ backgroundColor: area.color }}
                        >
                          <span className="material-symbols-outlined text-lg">{area.icon}</span>
                        </span>
                        <span className="font-semibold truncate">{area.area_name}</span>
                      </div>
                      <span className="text-sm font-semibold text-on-surface-variant">
                        Avg ${area.average.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="bg-surface-container-lowest p-8 rounded-xl">
            <div className="flex items-start justify-between gap-4 mb-8">
              <div>
                <h3 className="text-xl font-headline font-bold">Yearly Records by Area</h3>
                <p className="text-sm text-on-surface-variant mt-1">
                  Green is lower than last month, red is higher than last month, and gray stays within 10%.
                </p>
              </div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-low text-on-surface">
                <span className="material-symbols-outlined">table_chart</span>
              </span>
            </div>

            {yearlyAreaComparison.length > 0 ? (
              <div className="overflow-x-auto">
                <div className="min-w-[980px] space-y-4">
                  <div className="grid grid-cols-[240px_repeat(12,minmax(0,1fr))] gap-3 px-1">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-on-surface-variant opacity-60">Area</div>
                    {Array.from({ length: 12 }, (_, index) => (
                      <div key={index} className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-on-surface-variant opacity-60">
                        {format(new Date(Number(year), index, 1), 'MMM')}
                      </div>
                    ))}
                  </div>

                  {yearlyAreaComparison.map((area) => {
                    const isExpanded = expandedAreas.has(area.area_id);
                    const hasCategories = area.categories && area.categories.length > 0;

                    return (
                      <div key={area.area_id ?? 'uncategorized'}>
                        {/* Area Row */}
                        <div className="grid grid-cols-[240px_repeat(12,minmax(0,1fr))] gap-3 items-stretch">
                          <button
                            onClick={() => hasCategories && toggleAreaExpanded(area.area_id)}
                            className={`rounded-2xl bg-surface-container-low p-4 text-left ${
                              hasCategories ? 'hover:bg-surface-container cursor-pointer' : 'cursor-default'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span
                                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
                                style={{ backgroundColor: area.color }}
                              >
                                <span className="material-symbols-outlined text-lg">{area.icon}</span>
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold truncate">{area.area_name}</p>
                                  {hasCategories && (
                                    <span className="material-symbols-outlined text-on-surface-variant text-sm">
                                      {isExpanded ? 'expand_less' : 'expand_more'}
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-on-surface-variant">
                                  Avg ${area.average.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                </p>
                              </div>
                            </div>
                          </button>

                          {area.monthly.map((entry) => {
                            const toneClassName =
                              entry.tone === 'positive'
                                ? 'bg-emerald-50 text-emerald-700'
                                : entry.tone === 'negative'
                                  ? 'bg-rose-50 text-rose-700'
                                  : 'bg-surface-container text-on-surface-variant';

                            return (
                              <div key={`${area.area_id}-${entry.month}`} className={`rounded-2xl p-3 text-center ${toneClassName}`}>
                                <p className="text-sm font-semibold">
                                  ${entry.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                </p>
                                {entry.percentFromLastMonth !== null && (
                                  <p className="mt-2 text-xs font-semibold">
                                    {entry.percentFromLastMonth > 0 ? '+' : ''}{entry.percentFromLastMonth.toFixed(0)}%
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Expanded Categories */}
                        {isExpanded && hasCategories && (
                          <div className="mt-2 ml-8 space-y-2">
                            {area.categories
                              .sort((a, b) => b.amount - a.amount)
                              .map((cat) => {
                                const catMeta = getCategoryMeta(cat.category_name);

                                return (
                                  <div key={cat.category_id || cat.category_name} className="grid grid-cols-[232px_1fr] gap-3 items-center">
                                    <div className="rounded-xl bg-surface-container-low/50 p-3 flex items-center gap-3">
                                      <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${catMeta.badgeClassName}`}>
                                        <span className="material-symbols-outlined text-base">{catMeta.icon}</span>
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <p className="font-medium text-sm truncate">{cat.category_name}</p>
                                        <p className="text-xs text-on-surface-variant">
                                          ${cat.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })} total
                                        </p>
                                      </div>
                                    </div>
                                    <div className="text-xs text-on-surface-variant">
                                      {cat.count} transaction{cat.count !== 1 ? 's' : ''}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-on-surface-variant text-center py-8">No yearly comparison data available</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
