import { useEffect, useMemo, useState } from 'react';
import { useIsOffline } from '../store/syncSlice';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, addMonths, subMonths } from 'date-fns';
import { transactionsApi } from '../api/transactions';
import { categoriesApi } from '../api/categories';
import { areasApi } from '../api/areas';
import { useWorkspaceStore } from '../store/workspaceSlice';
import { useAuthStore } from '../store/authSlice';
import { useCurrency } from '../hooks/useCurrency';
import { getString, getNumber, Transaction, Category } from '../types';
import { parseCalendarDate } from '../utils/date';
import { UploadPreviewModal } from '../components/transactions/UploadPreviewModal';
import { BulkEditModal } from '../components/transactions/BulkEditModal';
import {
  TransactionFormModal,
  type TransactionFormData,
} from '../components/transactions/TransactionFormModal';
import {
  getCategoryMeta,
  normalizeCategory,
} from '../components/transactions/categoryMeta';

/** Marks a record that exists only on this device until the next sync. */
function PendingMark() {
  return (
    <span className="material-symbols-outlined shrink-0 text-sm text-on-surface-variant" title="Not synced yet">
      cloud_upload
    </span>
  );
}

export function TransactionsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedMonth = useWorkspaceStore((state) => state.selectedMonth);
  const setSelectedMonth = useWorkspaceStore((state) => state.setSelectedMonth);
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const currentUser = useAuthStore((state) => state.user);
  const { formatAmount } = useCurrency();
  const isOffline = useIsOffline();
  const currentDate = new Date(selectedMonth);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(() => location.pathname === '/transactions/new');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [showCategoryFilterMenu, setShowCategoryFilterMenu] = useState(false);
  // Phone only: the filters stay folded away until asked for.
  const [showFilters, setShowFilters] = useState(false);
  const [categoryFilterSearch, setCategoryFilterSearch] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<TransactionFormData>({
    date: format(new Date(), 'yyyy-MM-dd'),
    description: '',
    amount: '',
    type: 'debit',
    category: '',
    owner: '',
  });

  useEffect(() => {
    const isNewTransactionRoute = location.pathname === '/transactions/new';
    setShowModal(isNewTransactionRoute);

    if (isNewTransactionRoute) {
      setEditingId(null);
      setFormData({
        date: format(new Date(), 'yyyy-MM-dd'),
        description: '',
        amount: '',
        type: 'debit',
        category: '',
        owner: currentUser?.name || '',
      });
    }
  }, [location.pathname, currentUser?.name]);

  const month = format(currentDate, 'yyyy-MM');
  const queryClient = useQueryClient();
  const hasActiveFilters = Boolean(
    categoryFilter.length > 0 || typeFilter || sortOrder !== 'desc' || dateFrom || dateTo
  );
  const monthStart = format(currentDate, 'yyyy-MM-01');
  const monthEnd = format(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0), 'yyyy-MM-dd');

  // Date range is scoped to the visible month; drop it when the month changes.
  useEffect(() => {
    setDateFrom('');
    setDateTo('');
  }, [month]);

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', currentWorkspace?.id, month, categoryFilter, typeFilter, dateFrom, dateTo, sortOrder, page],
    queryFn: () =>
      transactionsApi.list(currentWorkspace!.id, {
        month,
        category: categoryFilter.length > 0 ? categoryFilter : undefined,
        type: typeFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        sort: 'date',
        order: sortOrder,
        page,
        per_page: 50,
      }),
    enabled: !!currentWorkspace?.id,
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['categoriesList', currentWorkspace?.id],
    queryFn: () => categoriesApi.list(currentWorkspace!.id),
    enabled: !!currentWorkspace?.id,
  });

  const { data: areasData } = useQuery({
    queryKey: ['areas', currentWorkspace?.id],
    queryFn: () => areasApi.list(currentWorkspace!.id),
    enabled: !!currentWorkspace?.id,
  });

  // Create a map for quick category lookup by name
  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>();
    categoriesData?.categories?.forEach((cat) => {
      map.set(normalizeCategory(cat.name), cat);
    });
    return map;
  }, [categoriesData]);

  // Helper to get category display info (icon, color) from Category object or fallback
  const getCategoryDisplay = (categoryName: string) => {
    const normalized = normalizeCategory(categoryName);
    const dbCategory = categoryMap.get(normalized);
    if (dbCategory && (dbCategory.icon || dbCategory.color)) {
      return {
        icon: dbCategory.icon || getCategoryMeta(categoryName).icon,
        color: dbCategory.color || null,
        badgeClassName: dbCategory.color
          ? ''
          : getCategoryMeta(categoryName).badgeClassName,
        useCustomColor: !!dbCategory.color,
      };
    }
    const meta = getCategoryMeta(categoryName);
    return {
      icon: meta.icon,
      color: null,
      badgeClassName: meta.badgeClassName,
      useCustomColor: false,
    };
  };

  const createMutation = useMutation({
    mutationFn: (data: TransactionFormData) =>
      transactionsApi.create(currentWorkspace!.id, {
        date: data.date,
        description: data.description,
        amount: parseFloat(data.amount),
        type: data.type,
        category: data.category,
        owner: data.owner || undefined,
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: TransactionFormData }) =>
      transactionsApi.update(currentWorkspace!.id, id, {
        date: data.date,
        description: data.description,
        amount: parseFloat(data.amount),
        type: data.type,
        category: data.category,
        owner: data.owner || undefined,
      }),
  });

  const invalidateTransactionRelated = () => {
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['categoriesList'] });
    queryClient.invalidateQueries({ queryKey: ['categories'] });
    queryClient.invalidateQueries({ queryKey: ['areas'] });
    queryClient.invalidateQueries({ queryKey: ['summary'] });
  };

  const handleSubmitCreate = async (
    data: TransactionFormData,
    { createAnother }: { createAnother: boolean }
  ): Promise<void> => {
    await createMutation.mutateAsync(data);
    invalidateTransactionRelated();

    // Keep tipo, fecha y titular cuando se cargan varias similares seguidas
    if (createAnother) {
      setFormData({
        date: data.date,
        owner: data.owner,
        type: data.type,
        description: '',
        amount: '',
        category: '',
      });
    } else {
      closeModal();
    }
  };

  const handleSubmitUpdate = async (id: number, data: TransactionFormData): Promise<void> => {
    await updateMutation.mutateAsync({ id, data });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['summary'] });
    closeModal();
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => transactionsApi.delete(currentWorkspace!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
  });

  const handlePrevMonth = () => {
    setSelectedMonth(subMonths(currentDate, 1));
    setPage(1);
  };

  const handleNextMonth = () => {
    setSelectedMonth(addMonths(currentDate, 1));
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
      owner: currentUser?.name || '',
    });
    setShowModal(true);
  };

  const openEditModal = (transaction: Transaction) => {
    setEditingId(transaction.id);
    setFormData({
      date: format(parseCalendarDate(transaction.date), 'yyyy-MM-dd'),
      description: getString(transaction.description),
      amount: getNumber(transaction.amount).toString(),
      type: getString(transaction.type) as 'debit' | 'credit',
      category: getString(transaction.category),
      owner: getString(transaction.owner),
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    if (location.pathname === '/transactions/new') {
      navigate('/transactions', { replace: true });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm('Are you sure you want to delete this transaction?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleSortToggle = () => {
    setSortOrder((current) => (current === 'desc' ? 'asc' : 'desc'));
    setPage(1);
  };

  const clearFilters = () => {
    setCategoryFilter([]);
    setCategoryFilterSearch('');
    setShowCategoryFilterMenu(false);
    setTypeFilter('');
    setDateFrom('');
    setDateTo('');
    setSortOrder('desc');
    setPage(1);
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

  const transactions = data?.transactions || [];
  const pagination = data?.pagination;
  const summary = data?.summary;
  const categories = categoriesData?.categories || [];
  const areas = areasData?.areas || [];
  const categoryNames = categories.map((c) => c.name);
  const filterCategoryOptions = Array.from(
    new Map(
      categoryNames
        .filter((category) => category && category.trim())
        .map((category) => [normalizeCategory(category), category.trim() || 'Uncategorized'])
    ).values()
  );
  const categorySearch = normalizeCategory(categoryFilterSearch);
  const byName = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });
  const areaById = new Map(areas.map((area) => [area.id, area]));
  const categoryAreaId = (name: string) => {
    const areaId = categoryMap.get(normalizeCategory(name))?.area_id;
    return areaId != null && areaById.has(areaId) ? areaId : null;
  };
  // Categories grouped under their area (areas and categories alphabetical); a search
  // matching the area name keeps all of that area's categories.
  const groupedCategoryFilterOptions = [
    ...[...areas]
      .sort((a, b) => byName(a.name, b.name))
      .map((area) => ({ key: `area-${area.id}`, name: area.name, color: area.color, icon: area.icon, areaId: area.id as number | null })),
    { key: 'area-none', name: 'Without area', color: '#9ca3af', icon: 'label_off', areaId: null as number | null },
  ]
    .map((group) => {
      const areaMatches = group.areaId !== null && normalizeCategory(group.name).includes(categorySearch);
      const items = filterCategoryOptions
        .filter((category) => categoryAreaId(category) === group.areaId)
        .filter((category) => areaMatches || normalizeCategory(category).includes(categorySearch))
        .sort(byName);
      return { ...group, items };
    })
    .filter((group) => group.items.length > 0);
  const toggleAreaFilter = (items: string[]) => {
    const selected = new Set(categoryFilter.map(normalizeCategory));
    const allSelected = items.every((item) => selected.has(normalizeCategory(item)));
    const itemKeys = new Set(items.map(normalizeCategory));
    setCategoryFilter((current) =>
      allSelected
        ? current.filter((c) => !itemKeys.has(normalizeCategory(c)))
        : [...current, ...items.filter((item) => !selected.has(normalizeCategory(item)))]
    );
    setPage(1);
  };
  const toggleCategoryFilter = (category: string) => {
    const normalized = normalizeCategory(category);
    const isSelected = categoryFilter.some((selected) => normalizeCategory(selected) === normalized);

    setCategoryFilter((current) =>
      isSelected
        ? current.filter((selected) => normalizeCategory(selected) !== normalized)
        : [...current, category]
    );
    setPage(1);
  };

  const isFormSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      {/* Header */}
      {/* Phone: title and month on one row, actions centred below. Desktop: one row. */}
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 mb-6 md:gap-4 md:px-0 md:mb-8">
        <h1 className="text-2xl md:text-4xl font-headline font-extrabold tracking-tight text-on-surface">Transactions</h1>
        {/* Month Navigator */}
        <div className="flex items-center gap-1 bg-surface-container-low rounded-full px-2 md:ml-auto md:gap-2">
          <button
            onClick={handlePrevMonth}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
          <span className="font-headline font-bold px-2 md:px-4">{format(currentDate, 'MMM yyyy')}</span>
          <button
            onClick={handleNextMonth}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
        <div className="flex w-full flex-wrap items-center justify-center gap-3 md:w-auto">
          <button
            onClick={() => setShowBulkEditModal(true)}
            className="bg-surface-container-low text-on-surface font-headline font-bold py-3 px-6 rounded-xl hidden md:flex items-center gap-2 hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined">edit_note</span>
            Bulk Edit
          </button>
          <button
            onClick={() => setShowUploadModal(true)}
            disabled={isOffline}
            title={isOffline ? 'Importing a statement needs a connection to the server' : undefined}
            className="bg-surface-container-low text-on-surface font-headline font-bold py-3 px-6 rounded-xl flex items-center gap-2 hover:bg-surface-container transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined">upload_file</span>
            Upload PDF
          </button>
          <button
            onClick={openCreateModal}
            className="bg-primary-container text-white font-headline font-bold py-3 px-6 rounded-xl hidden md:flex items-center gap-2 hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined">add</span>
            Add Transaction
          </button>
        </div>
      </header>

      {/* Summary Bar */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-8">
          <div className="bg-surface-container-lowest p-4 rounded-xl">
            <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">Debits</p>
            <p className="text-xl font-bold text-error">
              -{formatAmount(summary.debit_total, month)}
            </p>
          </div>
          <div className="bg-surface-container-lowest p-4 rounded-xl">
            <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">Credits</p>
            <p className="text-xl font-bold text-primary">
              +{formatAmount(summary.credit_total, month)}
            </p>
          </div>
          <div className="bg-surface-container-lowest p-4 rounded-xl">
            <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">Total</p>
            <p className="text-xl font-bold">
              {formatAmount(summary.total_amount, month)}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <button
        type="button"
        onClick={() => setShowFilters((open) => !open)}
        aria-expanded={showFilters}
        className="mx-4 mb-4 flex w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-xl border border-primary-container bg-primary/10 px-4 py-3 text-sm font-bold text-primary md:hidden"
      >
        <span className="material-symbols-outlined text-base">tune</span>
        Filters
        {hasActiveFilters && <span className="h-2 w-2 rounded-full bg-primary-container" aria-label="Filters applied" />}
        <span className="material-symbols-outlined text-base">{showFilters ? 'expand_less' : 'expand_more'}</span>
      </button>
      <section className={`bg-surface-container-lowest rounded-2xl p-5 mb-6 ${showFilters ? '' : 'hidden md:block'}`}>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-lg font-headline font-bold text-on-surface">Refine Records</h2>
              <p className="text-sm text-on-surface-variant mt-1">Filter by date, category or type, and change chronological order.</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSortToggle}
                className="inline-flex items-center gap-2 rounded-full bg-surface-container-low px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container"
              >
                <span className="material-symbols-outlined text-base">
                  {sortOrder === 'desc' ? 'south' : 'north'}
                </span>
                Date: {sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}
              </button>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
                >
                  <span className="material-symbols-outlined text-base">restart_alt</span>
                  Reset
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-on-surface-variant opacity-60 mb-3">
                Categories
              </p>
              <div className="relative">
                <button
                  onClick={() => setShowCategoryFilterMenu((current) => !current)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl bg-surface-container-low px-4 py-3 text-left transition-colors hover:bg-surface-container"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-on-surface">
                      {categoryFilter.length === 0
                        ? 'All Categories'
                        : `${categoryFilter.length} categor${categoryFilter.length === 1 ? 'y' : 'ies'} selected`}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {categoryFilter.length === 0 ? (
                        <span className="text-xs text-on-surface-variant">Search and choose one or more categories</span>
                      ) : (
                        categoryFilter.map((category) => {
                          const display = getCategoryDisplay(category);

                          return (
                            <span
                              key={normalizeCategory(category)}
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${display.useCustomColor ? 'text-white ring-white/20' : display.badgeClassName}`}
                              style={display.useCustomColor ? { backgroundColor: display.color! } : undefined}
                            >
                              <span className="material-symbols-outlined text-sm">{display.icon}</span>
                              {category}
                            </span>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-on-surface-variant">
                    {showCategoryFilterMenu ? 'expand_less' : 'expand_more'}
                  </span>
                </button>

                {showCategoryFilterMenu && (
                  <div className="absolute z-20 mt-2 w-full rounded-2xl border border-surface-container bg-surface-container-lowest p-3 shadow-xl">
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-on-surface-variant">
                        <span className="material-symbols-outlined text-base">search</span>
                      </span>
                      <input
                        type="text"
                        value={categoryFilterSearch}
                        onChange={(e) => setCategoryFilterSearch(e.target.value)}
                        placeholder="Search categories"
                        className="w-full rounded-xl border border-surface-container bg-surface-container-low py-3 pl-11 pr-4 text-sm outline-none transition-colors focus:border-primary-container"
                      />
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <button
                        onClick={() => {
                          setCategoryFilter([]);
                          setPage(1);
                        }}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                          categoryFilter.length === 0
                            ? 'bg-primary-container text-white'
                            : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
                        }`}
                      >
                        All Categories
                      </button>
                      {categoryFilter.length > 0 && (
                        <button
                          onClick={() => {
                            setCategoryFilter([]);
                            setPage(1);
                          }}
                          className="text-xs font-semibold text-on-surface-variant hover:text-on-surface"
                        >
                          Clear selection
                        </button>
                      )}
                    </div>

                    <div className="mt-3 max-h-80 overflow-y-auto">
                      {groupedCategoryFilterOptions.length > 0 ? (
                        groupedCategoryFilterOptions.map((group) => {
                          const selectedInGroup = group.items.filter((item) =>
                            categoryFilter.some((selected) => normalizeCategory(selected) === normalizeCategory(item))
                          ).length;
                          const allSelected = selectedInGroup === group.items.length;

                          return (
                            <div key={group.key} className="mb-2 last:mb-0">
                              <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-surface-container-lowest px-2 py-2">
                                <span className="flex min-w-0 items-center gap-2">
                                  <span
                                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                                    style={{ backgroundColor: group.color || '#9ca3af' }}
                                  >
                                    <span className="material-symbols-outlined text-sm text-white">{group.icon || 'category'}</span>
                                  </span>
                                  <span className="truncate text-xs font-bold uppercase tracking-[0.15em] text-on-surface-variant">
                                    {group.name}
                                  </span>
                                  <span className="text-xs text-on-surface-variant opacity-60">{group.items.length}</span>
                                </span>
                                <button
                                  onClick={() => toggleAreaFilter(group.items)}
                                  className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
                                >
                                  {allSelected ? 'Unselect all' : 'Select all'}
                                </button>
                              </div>
                              <div className="ml-3 space-y-1 border-l-2 pl-2" style={{ borderColor: group.color || '#9ca3af' }}>
                                {group.items.map((category) => {
                                  const display = getCategoryDisplay(category);
                                  const isSelected = categoryFilter.some(
                                    (selected) => normalizeCategory(selected) === normalizeCategory(category)
                                  );

                                  return (
                                    <button
                                      key={normalizeCategory(category)}
                                      onClick={() => toggleCategoryFilter(category)}
                                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                                        isSelected ? 'bg-surface-container-low' : 'hover:bg-surface-container-low'
                                      }`}
                                    >
                                      <span className="flex min-w-0 items-center gap-3">
                                        <span
                                          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${display.useCustomColor ? 'text-white ring-white/20' : display.badgeClassName}`}
                                          style={display.useCustomColor ? { backgroundColor: display.color! } : undefined}
                                        >
                                          <span className="material-symbols-outlined text-base">{display.icon}</span>
                                        </span>
                                        <span className="truncate text-sm font-medium">{category}</span>
                                      </span>
                                      <span className={`material-symbols-outlined ${isSelected ? 'text-primary' : 'text-on-surface-variant'}`}>
                                        {isSelected ? 'check_circle' : 'add_circle'}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="px-3 py-4 text-sm text-on-surface-variant">No categories match your search.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-on-surface-variant opacity-60 mb-3">
                Types
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { value: '', label: 'All Types', icon: 'tune', className: 'bg-surface-container text-on-surface' },
                  { value: 'debit', label: 'Debits', icon: 'south_west', className: 'bg-rose-100 text-rose-700' },
                  { value: 'credit', label: 'Credits', icon: 'north_east', className: 'bg-emerald-100 text-emerald-700' },
                ].map((option) => {
                  const isActive = typeFilter === option.value;

                  return (
                    <button
                      key={option.label}
                      onClick={() => {
                        setTypeFilter(option.value);
                        setPage(1);
                      }}
                      className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-all ${
                        isActive
                          ? `${option.className} ring-2 ring-inset ring-current`
                          : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                      }`}
                    >
                      <span className="material-symbols-outlined text-base">{option.icon}</span>
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-on-surface-variant opacity-60 mb-3">
              Dates
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
                From
                <input
                  type="date"
                  value={dateFrom}
                  min={monthStart}
                  max={dateTo || monthEnd}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-xl bg-surface-container-low px-4 py-2.5 text-sm font-medium text-on-surface outline-none ring-1 ring-inset ring-transparent focus:ring-primary-container dark:[color-scheme:dark]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
                To
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || monthStart}
                  max={monthEnd}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-xl bg-surface-container-low px-4 py-2.5 text-sm font-medium text-on-surface outline-none ring-1 ring-inset ring-transparent focus:ring-primary-container dark:[color-scheme:dark]"
                />
              </label>
              {[
                { label: 'Today', from: format(new Date(), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') },
                { label: '1-15', from: monthStart, to: format(currentDate, 'yyyy-MM-15') },
                { label: '16-end', from: format(currentDate, 'yyyy-MM-16'), to: monthEnd },
              ]
                .filter((preset) => preset.from >= monthStart && preset.to <= monthEnd)
                .map((preset) => {
                  const isActive = dateFrom === preset.from && dateTo === preset.to;
                  return (
                    <button
                      key={preset.label}
                      onClick={() => {
                        setDateFrom(isActive ? '' : preset.from);
                        setDateTo(isActive ? '' : preset.to);
                        setPage(1);
                      }}
                      className={`rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
                        isActive
                          ? 'bg-primary-container text-white'
                          : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                    setPage(1);
                  }}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-2.5 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                  Whole month
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Transactions Table */}
      <div className="bg-surface-container-lowest rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-container"></div>
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
            <span className="material-symbols-outlined text-5xl mb-4">receipt_long</span>
            <p>No transactions found</p>
          </div>
        ) : (
          <>
          {/* Phone: one card per record */}
          <ul className="divide-y divide-surface-container-low md:hidden">
            {transactions.map((t) => {
              const type = getString(t.type);
              const category = getString(t.category);
              const display = getCategoryDisplay(category);
              return (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${display.useCustomColor ? 'text-white' : display.badgeClassName}`}
                    style={display.useCustomColor ? { backgroundColor: display.color! } : undefined}
                  >
                    <span className="material-symbols-outlined text-xl">{display.icon}</span>
                  </span>
                  <button type="button" onClick={() => openEditModal(t)} className="min-w-0 flex-1 text-left">
                    <p className="flex items-center gap-1 truncate text-sm font-medium">
                      <span className="truncate">{getString(t.description) || category || 'Uncategorized'}</span>
                      {t.pending && <PendingMark />}
                    </p>
                    <p className="truncate text-xs text-on-surface-variant">
                      {format(parseCalendarDate(t.date), 'MMM dd')} · {category || 'Uncategorized'}
                      {getString(t.owner) && ` · ${getString(t.owner)}`}
                    </p>
                  </button>
                  <span className={`shrink-0 text-sm font-bold ${type === 'credit' ? 'text-primary' : 'text-error'}`}>
                    {type === 'credit' ? '+' : '-'}{formatAmount(getNumber(t.amount), format(parseCalendarDate(t.date), 'yyyy-MM'))}
                  </span>
                  <button type="button" onClick={() => handleDelete(t.id)} className="shrink-0 p-1 text-on-surface-variant" aria-label="Delete">
                    <span className="material-symbols-outlined text-xl">delete</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <table className="hidden w-full md:table">
            <thead className="bg-surface-container-low">
              <tr>
                <th className="text-left px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  <button
                    onClick={handleSortToggle}
                    className="inline-flex items-center gap-1 transition-colors hover:text-on-surface"
                  >
                    Date
                    <span className="material-symbols-outlined text-sm">
                      {sortOrder === 'desc' ? 'south' : 'north'}
                    </span>
                  </button>
                </th>
                <th className="text-left px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Description
                </th>
                <th className="text-left px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Category
                </th>
                <th className="text-right px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Amount
                </th>
                <th className="text-left px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Owner
                </th>
                <th className="text-right px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {transactions.map((t) => {
                const type = getString(t.type);
                const amount = getNumber(t.amount);
                const category = getString(t.category);
                const display = getCategoryDisplay(category);
                return (
                  <tr key={t.id} className="hover:bg-surface-container-low/50">
                    <td className="px-6 py-4 text-sm">{format(parseCalendarDate(t.date), 'MMM dd, yyyy')}</td>
                    <td className="px-6 py-4 text-sm font-medium">
                      <span className="inline-flex items-center gap-1">{getString(t.description)}{t.pending && <PendingMark />}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${display.useCustomColor ? 'text-white ring-white/20' : display.badgeClassName}`}
                        style={display.useCustomColor ? { backgroundColor: display.color! } : undefined}
                      >
                        <span className="material-symbols-outlined text-sm">{display.icon}</span>
                        {category || 'Uncategorized'}
                      </span>
                    </td>
                    <td className={`px-6 py-4 text-sm font-bold text-right ${type === 'credit' ? 'text-primary' : 'text-error'}`}>
                      {type === 'credit' ? '+' : '-'}{formatAmount(amount, format(parseCalendarDate(typeof t.date === 'string' ? t.date : ''), 'yyyy-MM'))}
                    </td>
                    <td className="px-6 py-4">
                      {getString(t.owner) && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
                          <span className="material-symbols-outlined text-sm">person</span>
                          {getString(t.owner)}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => openEditModal(t)}
                        className="text-on-surface-variant hover:text-primary p-1"
                      >
                        <span className="material-symbols-outlined text-xl">edit</span>
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
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
          </>
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
          <span className="text-sm text-on-surface-variant">
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

      <TransactionFormModal
        isOpen={showModal}
        editingId={editingId}
        formData={formData}
        setFormData={setFormData}
        categories={categories}
        areas={areas}
        categoryMap={categoryMap}
        getCategoryDisplay={getCategoryDisplay}
        isSubmitting={isFormSubmitting}
        onClose={closeModal}
        onSubmitCreate={handleSubmitCreate}
        onSubmitUpdate={handleSubmitUpdate}
      />

      {/* Upload Modal */}
      <UploadPreviewModal
        workspaceId={currentWorkspace.id}
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
      />

      {/* Bulk Edit Modal */}
      <BulkEditModal
        workspaceId={currentWorkspace.id}
        isOpen={showBulkEditModal}
        onClose={() => setShowBulkEditModal(false)}
        filters={{
          month,
          category: categoryFilter.length > 0 ? categoryFilter : undefined,
          type: typeFilter || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
        }}
        categories={categories}
        areas={areas}
      />
    </div>
  );
}
