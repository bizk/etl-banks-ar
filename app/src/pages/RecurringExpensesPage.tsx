import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { recurringExpensesApi } from '../api/recurringExpenses';
import { categoriesApi } from '../api/categories';
import { useWorkspaceStore } from '../store/workspaceSlice';
import type { RecurringExpense, Category } from '../types';
import { normalizeCategory } from '../components/transactions/categoryMeta';

interface RecurringExpenseFormData {
  name: string;
  amount: string;
  category_id: number | null;
  owner: string;
  due_day: string;
}

export function RecurringExpensesPage() {
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const queryClient = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [formData, setFormData] = useState<RecurringExpenseFormData>({
    name: '',
    amount: '',
    category_id: null,
    owner: '',
    due_day: '',
  });

  const { data: expensesData, isLoading } = useQuery({
    queryKey: ['recurringExpenses', currentWorkspace?.id],
    queryFn: () => recurringExpensesApi.list(currentWorkspace!.id),
    enabled: !!currentWorkspace?.id,
  });

  const { data: summaryData } = useQuery({
    queryKey: ['recurringExpensesSummary', currentWorkspace?.id],
    queryFn: () => recurringExpensesApi.getSummary(currentWorkspace!.id),
    enabled: !!currentWorkspace?.id,
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['categoriesList', currentWorkspace?.id],
    queryFn: () => categoriesApi.list(currentWorkspace!.id),
    enabled: !!currentWorkspace?.id,
  });

  const createMutation = useMutation({
    mutationFn: (data: RecurringExpenseFormData) =>
      recurringExpensesApi.create(currentWorkspace!.id, {
        name: data.name,
        amount: parseFloat(data.amount),
        category_id: data.category_id,
        owner: data.owner || undefined,
        due_day: parseInt(data.due_day),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringExpenses'] });
      queryClient.invalidateQueries({ queryKey: ['recurringExpensesSummary'] });
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: RecurringExpenseFormData }) =>
      recurringExpensesApi.update(currentWorkspace!.id, id, {
        name: data.name,
        amount: parseFloat(data.amount),
        category_id: data.category_id,
        owner: data.owner || undefined,
        due_day: parseInt(data.due_day),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringExpenses'] });
      queryClient.invalidateQueries({ queryKey: ['recurringExpensesSummary'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => recurringExpensesApi.delete(currentWorkspace!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringExpenses'] });
      queryClient.invalidateQueries({ queryKey: ['recurringExpensesSummary'] });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: (id: number) => recurringExpensesApi.markPaid(currentWorkspace!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringExpenses'] });
      queryClient.invalidateQueries({ queryKey: ['recurringExpensesSummary'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
  });

  const openCreateModal = () => {
    setEditingId(null);
    setFormData({ name: '', amount: '', category_id: null, owner: '', due_day: '' });
    setCategorySearch('');
    setShowModal(true);
  };

  const openEditModal = (expense: RecurringExpense) => {
    setEditingId(expense.id);
    setFormData({
      name: expense.name,
      amount: expense.amount.toString(),
      category_id: expense.category_id,
      owner: expense.owner,
      due_day: expense.due_day.toString(),
    });
    setCategorySearch(expense.category_name || '');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setShowCategorySuggestions(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id: number) => {
    if (confirm('Are you sure you want to delete this recurring expense?')) {
      deleteMutation.mutate(id);
    }
  };

  if (!currentWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <span className="material-symbols-outlined text-6xl text-on-surface-variant opacity-30 mb-4">workspaces</span>
        <h2 className="text-xl font-headline font-bold text-on-surface-variant">No Workspace Selected</h2>
        <p className="text-on-surface-variant mt-2">Create or select a workspace to get started</p>
      </div>
    );
  }

  const expenses = expensesData?.recurring_expenses || [];
  const summary = summaryData;
  const categories = categoriesData?.categories || [];

  // Create category lookup map
  const categoryMap = useMemo(() => {
    const map = new Map<number, Category>();
    categories.forEach((cat) => {
      map.set(cat.id, cat);
    });
    return map;
  }, [categories]);

  const filteredCategories = categories.filter((cat) =>
    normalizeCategory(cat.name).includes(normalizeCategory(categorySearch))
  );

  // Helper to get category display info
  const getCategoryDisplay = (categoryId: number | null, categoryName?: string) => {
    if (!categoryId || !categoryName) {
      return null;
    }
    const category = categoryMap.get(categoryId);
    if (!category) {
      return { icon: 'category', color: '#6B7280', name: categoryName };
    }
    // Use area color/icon if available, otherwise use category's own color/icon
    const color = category.area?.color || category.color || '#6B7280';
    const icon = category.area?.icon || category.icon || 'category';
    return { icon, color, name: categoryName };
  };

  // Get selected category for the input icon
  const selectedCategory = formData.category_id ? categoryMap.get(formData.category_id) : null;
  const selectedIcon = selectedCategory?.area?.icon || selectedCategory?.icon || 'category';

  return (
    <div>
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-4xl font-headline font-extrabold tracking-tight text-on-surface">Recurring Expenses</h1>
        <p className="text-on-surface-variant mt-2 font-medium opacity-60">
          Monthly expense templates for {format(new Date(), 'MMMM yyyy')}
        </p>
      </header>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-surface-container-lowest p-4 rounded-xl">
            <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">Total Monthly</p>
            <p className="text-xl font-bold">
              ${summary.total_monthly.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-surface-container-lowest p-4 rounded-xl">
            <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">Paid</p>
            <p className="text-xl font-bold text-primary">
              ${summary.paid_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-surface-container-lowest p-4 rounded-xl">
            <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">Pending</p>
            <p className="text-xl font-bold text-amber-500">
              ${summary.pending_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-surface-container-lowest p-4 rounded-xl">
            <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">vs Last Month</p>
            <p className={`text-xl font-bold ${summary.change_percentage > 0 ? 'text-error' : 'text-primary'}`}>
              {summary.change_percentage > 0 ? '+' : ''}{summary.change_percentage.toFixed(1)}%
            </p>
          </div>
        </div>
      )}

      {/* Expenses Table */}
      <div className="bg-surface-container-lowest rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-container"></div>
          </div>
        ) : expenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
            <span className="material-symbols-outlined text-5xl mb-4">event_repeat</span>
            <p>No recurring expenses yet</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-surface-container-low">
              <tr>
                <th className="text-left px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Name</th>
                <th className="text-right px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Amount</th>
                <th className="text-left px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Category</th>
                <th className="text-center px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Due Day</th>
                <th className="text-left px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Status</th>
                <th className="text-center px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Action</th>
                <th className="text-right px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {expenses.map((expense) => {
                const display = getCategoryDisplay(expense.category_id, expense.category_name);
                return (
                  <tr key={expense.id} className="hover:bg-surface-container-low/50">
                    <td className="px-6 py-4 text-sm font-medium">{expense.name}</td>
                    <td className="px-6 py-4 text-sm font-bold text-right">
                      ${expense.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4">
                      {display && (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset"
                          style={{
                            backgroundColor: `${display.color}20`,
                            color: display.color,
                            borderColor: `${display.color}40`
                          }}
                        >
                          <span className="material-symbols-outlined text-sm">{display.icon}</span>
                          {display.name}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-center text-on-surface-variant">{expense.due_day}</td>
                    <td className="px-6 py-4">
                      {expense.is_paid_this_month ? (
                        <span className="text-primary flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">check_circle</span>
                          Paid
                        </span>
                      ) : (
                        <span className="text-amber-500">Pending</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {expense.is_paid_this_month ? (
                        <span className="text-xs text-on-surface-variant">
                          {expense.last_paid_date && format(new Date(expense.last_paid_date), 'MMM d')}
                        </span>
                      ) : (
                        <button
                          onClick={() => markPaidMutation.mutate(expense.id)}
                          disabled={markPaidMutation.isPending}
                          className="bg-primary text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50"
                        >
                          Mark Paid
                        </button>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => openEditModal(expense)}
                        className="text-on-surface-variant hover:text-primary p-1"
                      >
                        <span className="material-symbols-outlined text-xl">edit</span>
                      </button>
                      <button
                        onClick={() => handleDelete(expense.id)}
                        className="text-on-surface-variant hover:text-error p-1 ml-2"
                      >
                        <span className="material-symbols-outlined text-xl">delete</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Add Button */}
        <div className="p-4 border-t border-surface-container-low">
          <button
            onClick={openCreateModal}
            className="w-full bg-primary-container text-white font-headline font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined">add</span>
            Add Expense
          </button>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-container-lowest rounded-2xl p-8 w-full max-w-md">
            <h2 className="text-xl font-headline font-bold mb-6">
              {editingId ? 'Edit Recurring Expense' : 'New Recurring Expense'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-low border-none"
                  placeholder="e.g., Netflix, Rent, Gym"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-low border-none"
                  placeholder="0.00"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Category</label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <span className="material-symbols-outlined text-on-surface-variant">
                      {selectedIcon}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={categorySearch}
                    onChange={(e) => {
                      setCategorySearch(e.target.value);
                      setFormData({ ...formData, category_id: null });
                      setShowCategorySuggestions(true);
                    }}
                    onFocus={() => setShowCategorySuggestions(true)}
                    onBlur={() => setTimeout(() => setShowCategorySuggestions(false), 120)}
                    className="w-full rounded-lg border-none bg-surface-container-low py-3 pl-12 pr-4"
                    placeholder="Search categories"
                  />
                  {showCategorySuggestions && filteredCategories.length > 0 && (
                    <div className="absolute z-10 mt-2 max-h-48 w-full overflow-y-auto rounded-xl border border-surface-container bg-surface-container-lowest p-2 shadow-xl">
                      {filteredCategories.map((category) => {
                        const color = category.area?.color || category.color || '#6B7280';
                        const icon = category.area?.icon || category.icon || 'category';
                        return (
                          <button
                            key={category.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setFormData({ ...formData, category_id: category.id });
                              setCategorySearch(category.name);
                              setShowCategorySuggestions(false);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-surface-container-low"
                          >
                            <span
                              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset"
                              style={{
                                backgroundColor: `${color}20`,
                                color: color,
                                borderColor: `${color}40`
                              }}
                            >
                              <span className="material-symbols-outlined text-sm">{icon}</span>
                              {category.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Due Day of Month</label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <span className="material-symbols-outlined text-on-surface-variant">calendar_today</span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={formData.due_day}
                    onChange={(e) => setFormData({ ...formData, due_day: e.target.value })}
                    className="w-full rounded-lg border-none bg-surface-container-low py-3 pl-12 pr-4"
                    placeholder="1-31"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Owner</label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <span className="material-symbols-outlined text-on-surface-variant">person</span>
                  </div>
                  <input
                    type="text"
                    value={formData.owner}
                    onChange={(e) => setFormData({ ...formData, owner: e.target.value })}
                    className="w-full rounded-lg border-none bg-surface-container-low py-3 pl-12 pr-4"
                    placeholder="Who is responsible?"
                  />
                </div>
              </div>
              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-3 rounded-xl border border-surface-container font-medium hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="flex-1 py-3 rounded-xl bg-primary-container text-white font-bold hover:opacity-90 disabled:opacity-50"
                >
                  {editingId ? 'Save Changes' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
