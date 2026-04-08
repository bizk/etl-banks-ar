import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, addMonths, eachWeekOfInterval, endOfMonth, isSameMonth, parseISO, startOfMonth, subMonths } from 'date-fns';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { transactionsApi } from '../api/transactions';
import { areasApi } from '../api/areas';
import { useWorkspaceStore } from '../store/workspaceSlice';
import { getCategoryMeta } from '../components/transactions/categoryMeta';
import { getNumber, getString } from '../types';

const DEFAULT_COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444',
  '#ec4899', '#6366f1', '#14b8a6', '#84cc16', '#f97316',
];

export function DashboardPage() {
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const selectedMonth = useWorkspaceStore((state) => state.selectedMonth);
  const setSelectedMonth = useWorkspaceStore((state) => state.setSelectedMonth);
  const currentDate = new Date(selectedMonth);
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

  const { data: areaSummaryData, isLoading: isAreaSummaryLoading } = useQuery({
    queryKey: ['areaSummary', currentWorkspace?.id, month],
    queryFn: () => areasApi.getSummary(currentWorkspace!.id, month),
    enabled: !!currentWorkspace?.id,
  });

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

  const handlePrevMonth = () => setSelectedMonth(subMonths(currentDate, 1));
  const handleNextMonth = () => setSelectedMonth(addMonths(currentDate, 1));

  const summary = summaryData?.summary;
  const transactions = transactionData?.transactions || [];
  const areas = areaSummaryData?.areas || [];

  // Prepare pie chart data from areas
  const pieChartData = useMemo(() => {
    return areas
      .filter((a) => a.amount > 0)
      .map((area, index) => ({
        name: area.area_name || 'Uncategorized',
        value: area.amount,
        color: area.area_id === null ? '#9ca3af' : (area.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]),
        icon: area.area_id === null ? 'help_outline' : (area.icon || 'category'),
        percentage: area.percentage,
        areaId: area.area_id,
      }))
      .sort((a, b) => b.value - a.value);
  }, [areas]);

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
        <span className="material-symbols-outlined text-6xl text-on-surface-variant opacity-30 mb-4">workspaces</span>
        <h2 className="text-xl font-headline font-bold text-on-surface-variant">No Workspace Selected</h2>
        <p className="text-on-surface-variant opacity-60 mt-2">Create or select a workspace to get started</p>
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

      {isLoading || isTransactionsLoading || isAreaSummaryLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-container"></div>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="bg-surface-container-lowest p-8 rounded-xl flex flex-col justify-between min-h-[160px]">
              <div className="flex justify-between items-start">
                <span className="text-sm font-semibold uppercase tracking-widest text-on-surface-variant opacity-50">
                  Gastos Mensuales
                </span>
                <span className="text-primary bg-primary/10 px-2 py-1 rounded-lg text-xs font-bold">
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
                  Ingresos
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
              <h3 className="text-xl font-headline font-bold mb-8">Spending by Area</h3>
              {pieChartData.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                        nameKey="name"
                      >
                        {pieChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
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
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-on-surface-variant opacity-60">No area data available</div>
              )}

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {pieChartData.map((area) => (
                  <div key={area.name} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full"
                        style={{ backgroundColor: area.color }}
                      >
                        <span className="material-symbols-outlined text-base text-white">{area.icon}</span>
                      </span>
                      <span className="truncate font-medium">{area.name}</span>
                    </div>
                    <span className="text-on-surface-variant whitespace-nowrap">{area.percentage.toFixed(1)}%</span>
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

          <section className="bg-surface-container-lowest p-8 rounded-xl">
            <h3 className="text-xl font-headline font-bold mb-8">Spending by Area</h3>
            <div className="space-y-4">
              {areas.map((area, areaIndex) => {
                const areaColor = area.area_id === null ? '#9ca3af' : (area.color || DEFAULT_COLORS[areaIndex % DEFAULT_COLORS.length]);
                const areaIcon = area.area_id === null ? 'help_outline' : (area.icon || 'category');
                const isExpanded = expandedAreas.has(area.area_id);
                const hasCategories = area.categories && area.categories.length > 0;

                return (
                  <div key={area.area_id ?? 'uncategorized'} className="border border-surface-container rounded-xl overflow-hidden">
                    {/* Area Header */}
                    <button
                      onClick={() => hasCategories && toggleAreaExpanded(area.area_id)}
                      className={`w-full p-4 flex items-center justify-between gap-4 transition-colors ${
                        hasCategories ? 'hover:bg-surface-container-low cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
                          style={{ backgroundColor: areaColor }}
                        >
                          <span className="material-symbols-outlined text-lg">{areaIcon}</span>
                        </span>
                        <div className="text-left min-w-0">
                          <span className="font-semibold truncate block">{area.area_name || 'Uncategorized'}</span>
                          <span className="text-xs text-on-surface-variant">
                            {area.count} transaction{area.count !== 1 ? 's' : ''}
                            {hasCategories && ` · ${area.categories.length} categor${area.categories.length !== 1 ? 'ies' : 'y'}`}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="font-bold text-on-surface block">
                            ${area.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                          <span className="text-xs text-on-surface-variant">{area.percentage.toFixed(1)}%</span>
                        </div>
                        {hasCategories && (
                          <span className="material-symbols-outlined text-on-surface-variant">
                            {isExpanded ? 'expand_less' : 'expand_more'}
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Progress Bar */}
                    <div className="px-4 pb-4">
                      <div className="w-full h-2 bg-surface-container-low rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(area.percentage, 100)}%`,
                            backgroundColor: areaColor,
                          }}
                        />
                      </div>
                    </div>

                    {/* Categories (Expandable) */}
                    {isExpanded && hasCategories && (
                      <div className="border-t border-surface-container bg-surface-container-low/30">
                        {area.categories
                          .sort((a, b) => b.amount - a.amount)
                          .map((cat) => {
                            const catMeta = getCategoryMeta(cat.category_name);
                            const catPercentage = area.amount > 0 ? (cat.amount / area.amount) * 100 : 0;

                            return (
                              <div
                                key={cat.category_id || cat.category_name}
                                className="px-4 py-3 flex items-center justify-between gap-4 border-b border-surface-container last:border-b-0"
                              >
                                <div className="flex items-center gap-3 min-w-0 pl-6">
                                  <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${catMeta.badgeClassName}`}>
                                    <span className="material-symbols-outlined text-base">{catMeta.icon}</span>
                                  </span>
                                  <div className="min-w-0">
                                    <span className="font-medium truncate block text-sm">{cat.category_name}</span>
                                    <span className="text-xs text-on-surface-variant">{cat.count} transaction{cat.count !== 1 ? 's' : ''}</span>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <span className="font-medium text-sm block">
                                    ${cat.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                  </span>
                                  <span className="text-xs text-on-surface-variant">{catPercentage.toFixed(1)}% of area</span>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                );
              })}
              {areas.length === 0 && (
                <p className="text-on-surface-variant opacity-60 text-center py-8">No transactions this month</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
