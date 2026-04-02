import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, addMonths, subMonths } from 'date-fns';
import { ResponsiveContainer, Treemap } from 'recharts';
import { transactionsApi } from '../api/transactions';
import { useWorkspaceStore } from '../store/workspaceSlice';
import { getCategoryMeta } from '../components/transactions/categoryMeta';

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
  const [currentDate, setCurrentDate] = useState(new Date());
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const year = format(currentDate, 'yyyy');

  const { data: yearlySummaryData, isLoading } = useQuery({
    queryKey: ['yearly-summary', currentWorkspace?.id, year],
    queryFn: () => transactionsApi.getYearlySummary(currentWorkspace!.id, year),
    enabled: !!currentWorkspace?.id,
  });

  const yearlySummary = yearlySummaryData?.summary;

  const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));

  const yearlyTreemapData = useMemo(
    () =>
      yearlySummary?.by_category.map((category) => {
        const meta = getCategoryMeta(category.category);

        return {
          name: category.category || 'Uncategorized',
          size: category.amount,
          fill: meta.chartColor,
        };
      }) || [],
    [yearlySummary?.by_category]
  );

  const yearlyCategoryComparison = useMemo(
    () =>
      yearlySummary?.by_category.map((category) => {
        const average = category.monthly.length > 0
          ? category.monthly.reduce((sum, entry) => sum + entry.amount, 0) / category.monthly.length
          : 0;

        return {
          ...category,
          average,
          monthly: category.monthly.map((entry) => {
            const ratio = average > 0 ? (entry.amount - average) / average : 0;

            let tone: 'positive' | 'negative' | 'neutral' = 'neutral';
            if (average > 0 && Math.abs(ratio) > 0.1) {
              tone = entry.amount < average ? 'positive' : 'negative';
            }

            return {
              ...entry,
              average,
              tone,
              percentFromAverage: average > 0 ? ratio * 100 : 0,
            };
          }),
        };
      }) || [],
    [yearlySummary?.by_category]
  );

  if (!currentWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <span className="material-symbols-outlined text-6xl text-gray-300 mb-4">workspaces</span>
        <h2 className="text-xl font-headline font-bold text-gray-600">No Workspace Selected</h2>
        <p className="text-gray-400 mt-2">Create or select a workspace to get started</p>
      </div>
    );
  }

  return (
    <div>
      <header className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-4xl font-headline font-extrabold tracking-tight text-on-surface">Insights</h1>
          <p className="text-on-surface-variant mt-2 font-medium opacity-60">
            Yearly overview and average-based monthly signals for {year}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-surface-container-low rounded-full px-2">
            <button
              onClick={handlePrevMonth}
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container transition-colors"
            >
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            <span className="font-headline font-bold px-4">{year}</span>
            <button
              onClick={handleNextMonth}
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
                ${yearlySummary?.total_spending?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
              </p>
            </div>
            <div className="bg-surface-container-lowest p-8 rounded-xl">
              <p className="text-sm font-semibold uppercase tracking-widest text-on-surface-variant opacity-50">Yearly Income</p>
              <p className="mt-4 text-4xl font-headline font-extrabold text-primary">
                ${yearlySummary?.total_income?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
              </p>
            </div>
            <div className="bg-surface-container-lowest p-8 rounded-xl">
              <p className="text-sm font-semibold uppercase tracking-widest text-on-surface-variant opacity-50">Net</p>
              <p className={`mt-4 text-4xl font-headline font-extrabold ${(yearlySummary?.net || 0) >= 0 ? 'text-primary' : 'text-error'}`}>
                ${Math.abs(yearlySummary?.net || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-8 mb-12">
            <div className="bg-surface-container-lowest p-8 rounded-xl">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-xl font-headline font-bold">Yearly Category Treemap</h3>
                  <p className="text-sm text-on-surface-variant mt-1">Category share across the full year</p>
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
                <div className="h-80 flex items-center justify-center text-gray-400">
                  No yearly category data available
                </div>
              )}
            </div>

            <div className="bg-surface-container-lowest p-8 rounded-xl">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-xl font-headline font-bold">Average Benchmarks</h3>
                  <p className="text-sm text-on-surface-variant mt-1">Average monthly spend for each category.</p>
                </div>
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <span className="material-symbols-outlined">rule</span>
                </span>
              </div>

              <div className="space-y-4">
                {yearlyCategoryComparison.slice(0, 6).map((category) => {
                  const meta = getCategoryMeta(category.category);
                  return (
                    <div key={category.category} className="rounded-2xl bg-surface-container-low p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${meta.badgeClassName}`}>
                            <span className="material-symbols-outlined text-lg">{meta.icon}</span>
                          </span>
                          <span className="font-semibold truncate">{category.category}</span>
                        </div>
                        <span className="text-sm font-semibold text-on-surface-variant">
                          Avg ${category.average.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="bg-surface-container-lowest p-8 rounded-xl">
            <div className="flex items-start justify-between gap-4 mb-8">
              <div>
                <h3 className="text-xl font-headline font-bold">Yearly Records by Category</h3>
                <p className="text-sm text-on-surface-variant mt-1">
                  Green is lower than average, red is higher than average, and gray stays within 10% of the average.
                </p>
              </div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-low text-on-surface">
                <span className="material-symbols-outlined">table_chart</span>
              </span>
            </div>

            {yearlyCategoryComparison.length > 0 ? (
              <div className="overflow-x-auto">
                <div className="min-w-[980px] space-y-4">
                  <div className="grid grid-cols-[240px_repeat(12,minmax(0,1fr))] gap-3 px-1">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-on-surface-variant opacity-60">Category</div>
                    {Array.from({ length: 12 }, (_, index) => (
                      <div key={index} className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-on-surface-variant opacity-60">
                        {format(new Date(Number(year), index, 1), 'MMM')}
                      </div>
                    ))}
                  </div>

                  {yearlyCategoryComparison.map((category) => {
                    const meta = getCategoryMeta(category.category);

                    return (
                      <div key={category.category} className="grid grid-cols-[240px_repeat(12,minmax(0,1fr))] gap-3 items-stretch">
                        <div className="rounded-2xl bg-surface-container-low p-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${meta.badgeClassName}`}>
                              <span className="material-symbols-outlined text-lg">{meta.icon}</span>
                            </span>
                            <div className="min-w-0">
                              <p className="font-semibold truncate">{category.category}</p>
                              <p className="text-sm text-on-surface-variant">
                                Avg ${category.average.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                              </p>
                            </div>
                          </div>
                        </div>

                        {category.monthly.map((entry) => {
                          const toneClassName =
                            entry.tone === 'positive'
                              ? 'bg-emerald-50 text-emerald-700'
                              : entry.tone === 'negative'
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-slate-100 text-slate-600';

                          return (
                            <div key={`${category.category}-${entry.month}`} className={`rounded-2xl p-3 text-center ${toneClassName}`}>
                              <p className="text-sm font-semibold">
                                ${entry.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                              </p>
                              <p className="mt-2 text-xs font-semibold">
                                {entry.percentFromAverage > 0 ? '+' : ''}
                                {entry.percentFromAverage.toFixed(0)}%
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-gray-400 text-center py-8">No yearly comparison data available</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
