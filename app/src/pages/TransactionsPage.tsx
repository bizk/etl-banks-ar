import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, addMonths, subMonths } from 'date-fns';
import { transactionsApi } from '../api/transactions';
import { useWorkspaceStore } from '../store/workspaceSlice';
import { getString, getNumber, Transaction } from '../types';
import { UploadPreviewModal } from '../components/transactions/UploadPreviewModal';
import {
  getCategoryMeta,
  isPredefinedCategory,
  normalizeCategory,
  PREDEFINED_CATEGORIES,
} from '../components/transactions/categoryMeta';

interface TransactionFormData {
  date: string;
  description: string;
  amount: string;
  type: 'debit' | 'credit';
  category: string;
}

export function TransactionsPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [categoryFilter, setCategoryFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<TransactionFormData>({
    date: format(new Date(), 'yyyy-MM-dd'),
    description: '',
    amount: '',
    type: 'debit',
    category: '',
  });

  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const month = format(currentDate, 'yyyy-MM');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', currentWorkspace?.id, month, categoryFilter, typeFilter, page],
    queryFn: () =>
      transactionsApi.list(currentWorkspace!.id, {
        month,
        category: categoryFilter || undefined,
        type: typeFilter || undefined,
        page,
        per_page: 20,
      }),
    enabled: !!currentWorkspace?.id,
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['categories', currentWorkspace?.id],
    queryFn: () => transactionsApi.getCategories(currentWorkspace!.id),
    enabled: !!currentWorkspace?.id,
  });

  const createMutation = useMutation({
    mutationFn: (data: TransactionFormData) =>
      transactionsApi.create(currentWorkspace!.id, {
        date: data.date,
        description: data.description,
        amount: parseFloat(data.amount),
        type: data.type,
        category: data.category,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: TransactionFormData }) =>
      transactionsApi.update(currentWorkspace!.id, id, {
        date: data.date,
        description: data.description,
        amount: parseFloat(data.amount),
        type: data.type,
        category: data.category,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => transactionsApi.delete(currentWorkspace!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
  });

  const handlePrevMonth = () => {
    setCurrentDate(subMonths(currentDate, 1));
    setPage(1);
  };

  const handleNextMonth = () => {
    setCurrentDate(addMonths(currentDate, 1));
    setPage(1);
  };

  const openCreateModal = () => {
    setEditingId(null);
    setFormData({
      date: format(new Date(), 'yyyy-MM-dd'),
      description: '',
      amount: '',
      type: 'debit',
      category: '',
    });
    setShowCategorySuggestions(false);
    setShowModal(true);
  };

  const openEditModal = (transaction: Transaction) => {
    setEditingId(transaction.id);
    setFormData({
      date: format(new Date(transaction.date), 'yyyy-MM-dd'),
      description: getString(transaction.description),
      amount: getNumber(transaction.amount).toString(),
      type: getString(transaction.type) as 'debit' | 'credit',
      category: getString(transaction.category),
    });
    setShowCategorySuggestions(false);
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
    if (confirm('Are you sure you want to delete this transaction?')) {
      deleteMutation.mutate(id);
    }
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

  const transactions = data?.transactions || [];
  const pagination = data?.pagination;
  const summary = data?.summary;
  const categories = categoriesData?.categories || [];
  const selectedCategoryIsPreset = isPredefinedCategory(formData.category);
  const normalizedCategoryInput = normalizeCategory(formData.category);
  const categoryOptions = Array.from(
    new Map(
      [...PREDEFINED_CATEGORIES, ...categories]
        .filter((category) => category && category.trim())
        .map((category) => [normalizeCategory(category), category.trim()])
    ).values()
  );
  const filteredCategoryOptions = categoryOptions
    .filter((category) => {
      if (!normalizedCategoryInput) {
        return true;
      }

      return normalizeCategory(category).includes(normalizedCategoryInput);
    })
    .slice(0, 8);

  return (
    <div>
      {/* Header */}
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-headline font-extrabold tracking-tight text-on-surface">Transactions</h1>
          <p className="text-on-surface-variant mt-2 font-medium opacity-60">
            Records for {format(currentDate, 'MMMM yyyy')}
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
          <button
            onClick={() => setShowUploadModal(true)}
            className="bg-surface-container-low text-on-surface font-headline font-bold py-3 px-6 rounded-xl flex items-center gap-2 hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined">upload_file</span>
            Upload PDF
          </button>
          <button
            onClick={openCreateModal}
            className="bg-primary-container text-white font-headline font-bold py-3 px-6 rounded-xl flex items-center gap-2 hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined">add</span>
            Add Transaction
          </button>
        </div>
      </header>

      {/* Summary Bar */}
      {summary && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-surface-container-lowest p-4 rounded-xl">
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Debits</p>
            <p className="text-xl font-bold text-error">
              -${summary.debit_total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-surface-container-lowest p-4 rounded-xl">
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Credits</p>
            <p className="text-xl font-bold text-primary">
              +${summary.credit_total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-surface-container-lowest p-4 rounded-xl">
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Total</p>
            <p className="text-xl font-bold">
              ${summary.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2 rounded-lg bg-surface-container-low border-none text-sm"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat || 'Uncategorized'}
            </option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2 rounded-lg bg-surface-container-low border-none text-sm"
        >
          <option value="">All Types</option>
          <option value="debit">Debits</option>
          <option value="credit">Credits</option>
        </select>
      </div>

      {/* Transactions Table */}
      <div className="bg-surface-container-lowest rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-container"></div>
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <span className="material-symbols-outlined text-5xl mb-4">receipt_long</span>
            <p>No transactions found</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-surface-container-low">
              <tr>
                <th className="text-left px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Date
                </th>
                <th className="text-left px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Description
                </th>
                <th className="text-left px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Category
                </th>
                <th className="text-right px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Amount
                </th>
                <th className="text-right px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {transactions.map((t) => {
                const type = getString(t.type);
                const amount = getNumber(t.amount);
                const category = getString(t.category);
                const categoryMeta = getCategoryMeta(category);
                return (
                  <tr key={t.id} className="hover:bg-surface-container-low/50">
                    <td className="px-6 py-4 text-sm">{format(new Date(t.date), 'MMM dd, yyyy')}</td>
                    <td className="px-6 py-4 text-sm font-medium">{getString(t.description)}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${categoryMeta.badgeClassName}`}
                      >
                        <span className="material-symbols-outlined text-sm">{categoryMeta.icon}</span>
                        {category || 'Uncategorized'}
                      </span>
                    </td>
                    <td className={`px-6 py-4 text-sm font-bold text-right ${type === 'credit' ? 'text-primary' : 'text-error'}`}>
                      {type === 'credit' ? '+' : '-'}${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => openEditModal(t)}
                        className="text-gray-400 hover:text-primary p-1"
                      >
                        <span className="material-symbols-outlined text-xl">edit</span>
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="text-gray-400 hover:text-error p-1 ml-2"
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
      </div>

      {/* Pagination */}
      {pagination && pagination.total_pages > 1 && (
        <div className="flex justify-center items-center gap-4 mt-6">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-4 py-2 rounded-lg bg-surface-container-low disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {pagination.total_pages}
          </span>
          <button
            onClick={() => setPage(Math.min(pagination.total_pages, page + 1))}
            disabled={page === pagination.total_pages}
            className="px-4 py-2 rounded-lg bg-surface-container-low disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md">
            <h2 className="text-xl font-headline font-bold mb-6">
              {editingId ? 'Edit Transaction' : 'New Transaction'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Date</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-low border-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-low border-none"
                  placeholder="What was this for?"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Amount</label>
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
                <label className="block text-sm font-medium text-gray-600 mb-1">Type</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="type"
                      value="debit"
                      checked={formData.type === 'debit'}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value as 'debit' | 'credit' })}
                    />
                    <span>Debit (Expense)</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="type"
                      value="credit"
                      checked={formData.type === 'credit'}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value as 'debit' | 'credit' })}
                    />
                    <span>Credit (Income)</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Category</label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <span className="material-symbols-outlined text-gray-500">
                      {getCategoryMeta(formData.category).icon}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={formData.category}
                    onChange={(e) => {
                      setFormData({ ...formData, category: e.target.value });
                      setShowCategorySuggestions(true);
                    }}
                    onFocus={() => setShowCategorySuggestions(true)}
                    onBlur={() => {
                      setTimeout(() => setShowCategorySuggestions(false), 120);
                    }}
                    className="w-full rounded-lg border-none bg-surface-container-low py-3 pl-14 pr-12"
                    placeholder="Search or create a category"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setShowCategorySuggestions((current) => !current)}
                    className="absolute inset-y-0 right-0 flex items-center px-4 text-gray-500"
                    aria-label="Toggle category options"
                  >
                    <span className="material-symbols-outlined">
                      {showCategorySuggestions ? 'expand_less' : 'expand_more'}
                    </span>
                  </button>
                  {showCategorySuggestions && (
                    <div className="absolute z-10 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
                      {filteredCategoryOptions.length > 0 ? (
                        filteredCategoryOptions.map((category) => {
                          const categoryMeta = getCategoryMeta(category);
                          const isSelected = normalizeCategory(category) === normalizedCategoryInput;

                          return (
                            <button
                              key={normalizeCategory(category)}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setFormData({ ...formData, category });
                                setShowCategorySuggestions(false);
                              }}
                              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                                isSelected ? 'bg-surface-container-low' : 'hover:bg-surface-container-low'
                              }`}
                            >
                              <span
                                className={`inline-flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-inset ${categoryMeta.badgeClassName}`}
                              >
                                <span className="material-symbols-outlined text-lg">{categoryMeta.icon}</span>
                              </span>
                              <span className="text-sm font-medium">{category}</span>
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-3 py-3 text-sm text-gray-500">
                          No matching category. Press save to create "{formData.category}".
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {selectedCategoryIsPreset
                    ? 'Existing category selected. You can keep typing to switch or create a new one.'
                    : 'Type to filter existing categories or leave your custom value to create a new category.'}
                </p>
              </div>
              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-3 rounded-xl border border-gray-200 font-medium hover:bg-gray-50"
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

      {/* Upload Modal */}
      <UploadPreviewModal
        workspaceId={currentWorkspace.id}
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
      />
    </div>
  );
}
