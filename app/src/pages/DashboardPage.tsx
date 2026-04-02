import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, addMonths, eachWeekOfInterval, endOfMonth, isSameMonth, parseISO, startOfMonth, subMonths } from 'date-fns';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { transactionsApi } from '../api/transactions';
import { useWorkspaceStore } from '../store/workspaceSlice';
import { getCategoryMeta } from '../components/transactions/categoryMeta';
import { getNumber, getString } from '../types';

export function DashboardPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const month = format(currentDate, 'yyyy-MM');

  const { data: summaryData, isLoading } = useQuery({
    queryKey: ['summary', currentWorkspace?.id, month],
    queryFn: () => transactionsApi.getSummary(currentWorkspace!.id, month),
    enabled: !!currentWorkspace?.id,
  });

  const { data: transactionData, isLoading: isTransactionsLoading } = useQuery({
    queryKey: ['transactions', currentWorkspace?.id, month, 'dashboard'],
    queryFn: () =>
      transactionsApi.list(currentWorkspace!.id, {
        month,
        page: 1,
        per_page: 500,
        sort: 'date',
        order: 'desc',
      }),
    enabled: !!currentWorkspace?.id,
  });

  const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));

  const summary = summaryData?.summary;
  const transactions = transactionData?.transactions || [];

  const categoryData = useMemo(
    () =>
      summary?.by_category?.map((cat) => {
        const name = cat.category || 'Uncategorized';
        const meta = getCategoryMeta(name);

        return {
          name,
          value: cat.amount,
          fill: meta.chartColor,
          icon: meta.icon,
          badgeClassName: meta.badgeClassName,
          percentage: cat.percentage,
        };
      }) || [],
    [summary?.by_category]
  );

  const weeklyData = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const weekStarts = eachWeekOfInterval({ start: monthStart, end: monthEnd }, { weekStartsOn: 1 });

    return weekStarts.map((weekStart, index) => {
      const amount = transactions.reduce((total, transaction) => {
        const type = getString(transaction.type);
        if (type !== 'debit') {
          return total;
        }

        const transactionDate = parseISO(transaction.date);
        if (!isSameMonth(transactionDate, currentDate)) {
          return total;
        }

        const transactionWeekStart = eachWeekOfInterval({ start: transactionDate, end: transactionDate }, { weekStartsOn: 1 })[0];
        if (transactionWeekStart.getTime() !== weekStart.getTime()) {
          return total;
        }

        return total + getNumber(transaction.amount);
      }, 0);

      return {
        week: `Week ${index + 1}`,
        amount,
      };
    });
  }, [currentDate, transactions]);

  const recentTransactions = transactions.slice(0, 6);

  const renderWeeklyValueLabel = (props: {
    x?: number;
    y?: number;
    value?: number;
  }) => {
    if (props.x == null || props.y == null || props.value == null) {
      return null;
    }

    return (
      <text
        x={props.x}
        y={props.y - 14}
        textAnchor="middle"
        className="fill-on-surface-variant"
        style={{ fontSize: 11, fontWeight: 700 }}
      >
        ${props.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}
      </text>
    );
  };

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
          <h1 className="text-4xl font-headline font-extrabold tracking-tight text-on-surface">Overview</h1>
          <p className="text-on-surface-variant mt-2 font-medium opacity-60">
            Monthly spending and overall view for {format(currentDate, 'MMMM yyyy')}
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
            <span className="font-headline font-bold px-4">{format(currentDate, 'MMM yyyy')}</span>
            <button
              onClick={handleNextMonth}
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container transition-colors"
            >
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        </div>
      </header>

      {isLoading || isTransactionsLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-container"></div>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="bg-surface-container-lowest p-8 rounded-xl flex flex-col justify-between min-h-[160px]">
              <div className="flex justify-between items-start">
                <span className="text-sm font-semibold uppercase tracking-widest text-on-surface-variant opacity-50">
                  Total Monthly Spending
                </span>
                <span className="text-emerald-500 bg-emerald-50 px-2 py-1 rounded-lg text-xs font-bold">
                  <span className="material-symbols-outlined text-sm align-middle">trending_down</span>
                </span>
              </div>
              <div className="mt-4">
                <p className="text-4xl font-headline font-extrabold">
                  ${summary?.total_spending?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
                </p>
                <p className="text-sm text-on-surface-variant mt-2">Debits this month</p>
              </div>
            </div>

            <div className="bg-surface-container-lowest p-8 rounded-xl flex flex-col justify-between min-h-[160px]">
              <div className="flex justify-between items-start">
                <span className="text-sm font-semibold uppercase tracking-widest text-on-surface-variant opacity-50">
                  Total Income
                </span>
                <div className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center">
                  <span className="material-symbols-outlined text-sm">trending_up</span>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-4xl font-headline font-extrabold">
                  ${summary?.total_income?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
                </p>
                <p className="text-sm text-on-surface-variant mt-2">Credits this month</p>
              </div>
            </div>

            <div className={`p-8 rounded-xl flex flex-col justify-between min-h-[160px] ${
              (summary?.net || 0) >= 0 ? 'bg-primary-container text-white' : 'bg-error text-white'
            }`}>
              <div className="flex justify-between items-start">
                <span className="text-sm font-semibold uppercase tracking-widest opacity-80">Net Balance</span>
                <span className="material-symbols-outlined">
                  {(summary?.net || 0) >= 0 ? 'trending_up' : 'trending_down'}
                </span>
              </div>
              <div className="mt-4">
                <p className="text-4xl font-headline font-extrabold">
                  ${Math.abs(summary?.net || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
                <p className="text-sm opacity-80 mt-2">
                  {(summary?.net || 0) >= 0 ? 'You saved this month' : 'Over budget this month'}
                </p>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
            <section className="bg-surface-container-lowest p-8 rounded-xl">
              <h3 className="text-xl font-headline font-bold mb-8">Spending by Category</h3>
              {categoryData.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={categoryData} cx="50%" cy="50%" outerRadius="72%">
                      <PolarGrid stroke="#d9f99d" />
                      <PolarAngleAxis dataKey="name" tick={{ fill: '#475569', fontSize: 12, fontWeight: 600 }} />
                      <PolarRadiusAxis tick={false} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          border: 'none',
                          borderRadius: '16px',
                          backgroundColor: '#ffffff',
                          boxShadow: '0 18px 45px rgba(15, 23, 42, 0.08)',
                        }}
                        labelStyle={{ color: '#0f172a', fontWeight: 700 }}
                        formatter={(value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                      />
                      <Radar
                        name="Spending"
                        dataKey="value"
                        stroke="#10b981"
                        fill="#10b981"
                        fillOpacity={0.2}
                        strokeWidth={2.5}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-400">No category data available</div>
              )}

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {categoryData.map((cat) => (
                  <div key={cat.name} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-inset ${cat.badgeClassName}`}>
                        <span className="material-symbols-outlined text-base">{cat.icon}</span>
                      </span>
                      <span className="truncate font-medium">{cat.name}</span>
                    </div>
                    <span className="text-on-surface-variant whitespace-nowrap">{cat.percentage.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-surface-container-lowest p-8 rounded-xl">
              <h3 className="text-xl font-headline font-bold mb-8">Weekly Spending Trend</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weeklyData} margin={{ top: 20, right: 20, left: 20, bottom: 4 }}>
                    <defs>
                      <linearGradient id="weeklyTrendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.32} />
                        <stop offset="65%" stopColor="#34d399" stopOpacity={0.12} />
                        <stop offset="100%" stopColor="#ecfdf5" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#d1fae5" strokeDasharray="4 4" />
                    <XAxis dataKey="week" axisLine={false} tickLine={false} tickMargin={10} padding={{ left: 12, right: 12 }} />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{
                        border: 'none',
                        borderRadius: '16px',
                        backgroundColor: '#ffffff',
                        boxShadow: '0 18px 45px rgba(16, 185, 129, 0.12)',
                      }}
                      labelStyle={{ color: '#0f172a', fontWeight: 700 }}
                      formatter={(value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="amount"
                      stroke="#10b981"
                      strokeWidth={3}
                      fill="url(#weeklyTrendFill)"
                      dot={{ r: 0 }}
                      activeDot={{ r: 6, strokeWidth: 3, fill: '#ffffff', stroke: '#10b981' }}
                      label={renderWeeklyValueLabel}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-8">
            <section className="bg-surface-container-lowest p-8 rounded-xl">
              <h3 className="text-xl font-headline font-bold mb-8">Category Breakdown</h3>
              <div className="space-y-5">
                {categoryData.map((cat) => (
                  <div key={cat.name}>
                    <div className="flex justify-between gap-4 text-sm mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${cat.badgeClassName}`}>
                          <span className="material-symbols-outlined text-lg">{cat.icon}</span>
                        </span>
                        <span className="font-semibold truncate">{cat.name}</span>
                      </div>
                      <span className="text-on-surface-variant font-medium text-right whitespace-nowrap">
                        ${cat.value.toLocaleString('en-US', { minimumFractionDigits: 2 })} ({cat.percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-surface-container-low rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(cat.percentage, 100)}%`,
                          backgroundColor: cat.fill,
                        }}
                      ></div>
                    </div>
                  </div>
                ))}
                {categoryData.length === 0 && (
                  <p className="text-gray-400 text-center py-8">No transactions this month</p>
                )}
              </div>
            </section>

            <section className="bg-surface-container-lowest p-8 rounded-xl">
              <div className="flex items-center justify-between gap-4 mb-8">
                <div>
                  <h3 className="text-xl font-headline font-bold">Recent Records</h3>
                  <p className="text-sm text-on-surface-variant mt-1">
                    Latest transactions in {format(currentDate, 'MMMM yyyy')}
                  </p>
                </div>
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-low text-on-surface">
                  <span className="material-symbols-outlined">history</span>
                </span>
              </div>

              <div className="space-y-4">
                {recentTransactions.map((transaction) => {
                  const category = getString(transaction.category) || 'Uncategorized';
                  const meta = getCategoryMeta(category);
                  const amount = getNumber(transaction.amount);
                  const type = getString(transaction.type);

                  return (
                    <div key={transaction.id} className="flex items-start justify-between gap-4 rounded-2xl bg-surface-container-low p-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${meta.badgeClassName}`}>
                          <span className="material-symbols-outlined text-lg">{meta.icon}</span>
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{getString(transaction.description) || 'Untitled transaction'}</p>
                          <div className="flex items-center gap-2 text-sm text-on-surface-variant mt-1 min-w-0">
                            <span className="truncate">{category}</span>
                            <span className="opacity-40">•</span>
                            <span>{format(parseISO(transaction.date), 'MMM dd')}</span>
                          </div>
                        </div>
                      </div>
                      <span className={`shrink-0 text-sm font-bold ${type === 'credit' ? 'text-primary' : 'text-error'}`}>
                        {type === 'credit' ? '+' : '-'}${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  );
                })}
                {recentTransactions.length === 0 && (
                  <p className="text-gray-400 text-center py-8">No recent records for this month</p>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
