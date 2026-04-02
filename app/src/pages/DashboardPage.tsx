import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, addMonths, subMonths } from 'date-fns';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { transactionsApi } from '../api/transactions';
import { useWorkspaceStore } from '../store/workspaceSlice';

const COLORS = ['#10b981', '#2b6954', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export function DashboardPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const month = format(currentDate, 'yyyy-MM');

  const { data: summaryData, isLoading } = useQuery({
    queryKey: ['summary', currentWorkspace?.id, month],
    queryFn: () => transactionsApi.getSummary(currentWorkspace!.id, month),
    enabled: !!currentWorkspace?.id,
  });

  const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));

  const summary = summaryData?.summary;
  const categoryData = summary?.by_category?.map((cat, i) => ({
    name: cat.category || 'Uncategorized',
    value: cat.amount,
    fill: COLORS[i % COLORS.length],
  })) || [];

  // Create weekly data from transactions
  const weeklyData = [
    { week: 'Week 1', amount: 0 },
    { week: 'Week 2', amount: 0 },
    { week: 'Week 3', amount: 0 },
    { week: 'Week 4', amount: 0 },
  ];

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
      {/* Header */}
      <header className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-4xl font-headline font-extrabold tracking-tight text-on-surface">Spending Insights</h1>
          <p className="text-on-surface-variant mt-2 font-medium opacity-60">
            Financial metrics for {format(currentDate, 'MMMM yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Month Navigator */}
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

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-container"></div>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
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

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
            {/* Spending by Category Pie Chart */}
            <section className="bg-surface-container-lowest p-8 rounded-xl">
              <h3 className="text-xl font-headline font-bold mb-8">Spending by Category</h3>
              {categoryData.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {categoryData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) =>
                          `$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                        }
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-400">
                  No category data available
                </div>
              )}
              {/* Legend */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                {categoryData.map((cat, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.fill }}></div>
                    <span className="truncate">{cat.name}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Weekly Trend Bar Chart */}
            <section className="bg-surface-container-lowest p-8 rounded-xl">
              <h3 className="text-xl font-headline font-bold mb-8">Weekly Spending Trend</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyData}>
                    <XAxis dataKey="week" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      formatter={(value: number) =>
                        `$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                      }
                    />
                    <Bar dataKey="amount" fill="#10b981" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          {/* Category Progress Bars */}
          <section className="bg-surface-container-lowest p-8 rounded-xl">
            <h3 className="text-xl font-headline font-bold mb-8">Category Breakdown</h3>
            <div className="space-y-6">
              {summary?.by_category?.map((cat, i) => (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="font-semibold">{cat.category || 'Uncategorized'}</span>
                    <span className="text-on-surface-variant font-medium">
                      ${cat.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ({cat.percentage.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-surface-container-low rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(cat.percentage, 100)}%`,
                        backgroundColor: COLORS[i % COLORS.length],
                      }}
                    ></div>
                  </div>
                </div>
              ))}
              {(!summary?.by_category || summary.by_category.length === 0) && (
                <p className="text-gray-400 text-center py-8">No transactions this month</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
