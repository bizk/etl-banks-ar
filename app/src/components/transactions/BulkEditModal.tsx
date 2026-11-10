import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { transactionsApi } from '../../api/transactions';
import { getNumber, getString, type Area, type Category, type Transaction } from '../../types';
import { parseCalendarDate } from '../../utils/date';
import { normalizeCategory } from './categoryMeta';

export interface BulkEditFilters {
  month: string;
  category?: string[];
  type?: string;
  date_from?: string;
  date_to?: string;
}

interface BulkEditModalProps {
  workspaceId: number;
  isOpen: boolean;
  onClose: () => void;
  filters: BulkEditFilters;
  categories: Category[];
  areas: Area[];
}

interface EditableRow {
  id: number;
  date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  category: string;
  owner: string;
}

type EditableField = Exclude<keyof EditableRow, 'id'>;
const FIELDS: EditableField[] = ['date', 'description', 'amount', 'type', 'category', 'owner'];
const PAGE_SIZE = 500;
const MAX_ROWS = 2000;

function toRow(t: Transaction): EditableRow {
  const type = getString(t.type) === 'credit' ? 'credit' : 'debit';
  return {
    id: t.id,
    date: format(parseCalendarDate(t.date), 'yyyy-MM-dd'),
    description: getString(t.description),
    amount: getNumber(t.amount),
    type,
    category: getString(t.category),
    owner: getString(t.owner ?? ''),
  };
}

async function fetchAllTransactions(workspaceId: number, filters: BulkEditFilters): Promise<Transaction[]> {
  const all: Transaction[] = [];
  for (let page = 1; all.length < MAX_ROWS; page++) {
    const res = await transactionsApi.list(workspaceId, {
      ...filters,
      sort: 'date',
      order: 'desc',
      page,
      per_page: PAGE_SIZE,
    });
    all.push(...res.transactions);
    if (page >= res.pagination.total_pages || res.transactions.length === 0) break;
  }
  return all;
}

export function BulkEditModal({ workspaceId, isOpen, onClose, filters, categories, areas }: BulkEditModalProps) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [original, setOriginal] = useState<Map<number, EditableRow>>(new Map());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkType, setBulkType] = useState('');
  const [bulkOwner, setBulkOwner] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['bulkEditTransactions', workspaceId, filters],
    queryFn: () => fetchAllTransactions(workspaceId, filters),
    enabled: isOpen,
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (!data) return;
    const loaded = data.map(toRow);
    setRows(loaded);
    setOriginal(new Map(loaded.map((row) => [row.id, row])));
    setSelectedIds(new Set());
  }, [data]);

  useEffect(() => {
    if (!isOpen) {
      setRows([]);
      setOriginal(new Map());
      setSelectedIds(new Set());
      setSearch('');
      setBulkCategory('');
      setBulkType('');
      setBulkOwner('');
      setError(null);
    }
  }, [isOpen]);

  const changedFields = (row: EditableRow): EditableField[] => {
    const before = original.get(row.id);
    if (!before) return [];
    return FIELDS.filter((field) => row[field] !== before[field]);
  };

  const dirtyRows = rows.filter((row) => changedFields(row).length > 0);

  // Category options grouped by area (alphabetical), plus any category only present on transactions.
  const categoryGroups = useMemo(() => {
    const byName = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });
    const areaIds = new Set(areas.map((a) => a.id));
    const groups = [...areas]
      .sort((a, b) => byName(a.name, b.name))
      .map((area) => ({
        label: area.name,
        names: categories.filter((c) => c.area_id === area.id).map((c) => c.name).sort(byName),
      }));
    const known = new Set(categories.map((c) => normalizeCategory(c.name)));
    const extra = Array.from(
      new Set(rows.map((r) => r.category).filter((c) => c && !known.has(normalizeCategory(c))))
    );
    groups.push({
      label: 'Without area',
      names: [
        ...categories.filter((c) => c.area_id == null || !areaIds.has(c.area_id)).map((c) => c.name),
        ...extra,
      ].sort(byName),
    });
    return groups.filter((g) => g.names.length > 0);
  }, [areas, categories, rows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.description.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.owner.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = dirtyRows.map((row) => {
        const patch: Record<string, string | number> & { id: number } = { id: row.id };
        for (const field of changedFields(row)) {
          patch[field] = row[field];
        }
        return patch;
      });
      return transactionsApi.bulkUpdate(workspaceId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['categoriesList'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      onClose();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err as Error)?.message ||
        'Failed to save changes';
      setError(message);
    },
  });

  const updateRow = <K extends EditableField>(id: number, field: K, value: EditableRow[K]) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const toggleSelection = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selectedIds.has(r.id));
  const toggleSelectVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      visibleRows.forEach((r) => (allVisibleSelected ? next.delete(r.id) : next.add(r.id)));
      return next;
    });
  };

  const applyToSelected = () => {
    if (selectedIds.size === 0) return;
    setRows((prev) =>
      prev.map((r) => {
        if (!selectedIds.has(r.id)) return r;
        const next = { ...r };
        if (bulkCategory) next.category = bulkCategory === '__none__' ? '' : bulkCategory;
        if (bulkType === 'debit' || bulkType === 'credit') {
          if (bulkType !== next.type) {
            next.type = bulkType;
            next.amount = bulkType === 'debit' ? -Math.abs(next.amount) : Math.abs(next.amount);
          }
        }
        if (bulkOwner.trim()) next.owner = bulkOwner.trim();
        return next;
      })
    );
    setBulkCategory('');
    setBulkType('');
    setBulkOwner('');
  };

  const resetRow = (id: number) => {
    const before = original.get(id);
    if (before) setRows((prev) => prev.map((r) => (r.id === id ? before : r)));
  };

  const handleClose = () => {
    if (dirtyRows.length > 0 && !confirm(`Discard ${dirtyRows.length} unsaved change(s)?`)) return;
    onClose();
  };

  if (!isOpen) return null;

  const hasBulkValue = Boolean(bulkCategory || bulkType || bulkOwner.trim());
  const inputClass =
    'w-full px-2 py-1.5 rounded-lg bg-surface-container-low border border-transparent text-sm text-on-surface focus:border-primary-container outline-none dark:[color-scheme:dark]';

  const categorySelect = (value: string, onChange: (v: string) => void, extraClass = '', placeholder?: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} ${extraClass}`}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : <option value="">Uncategorized</option>}
      {placeholder !== undefined && <option value="__none__">Uncategorized</option>}
      {categoryGroups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-container-lowest rounded-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b flex justify-between items-start gap-4">
          <div>
            <h2 className="text-xl font-headline font-bold">Bulk Edit Transactions</h2>
            <p className="text-sm text-on-surface-variant mt-1">
              {format(parseCalendarDate(`${filters.month}-01`), 'MMMM yyyy')} · current filters applied ·{' '}
              {rows.length} transaction{rows.length === 1 ? '' : 's'}
              {rows.length >= MAX_ROWS ? ` (first ${MAX_ROWS})` : ''}
            </p>
          </div>
          <button onClick={handleClose} className="text-on-surface-variant hover:text-on-surface" aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-4 border-b flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-on-surface-variant">
                <span className="material-symbols-outlined text-base">search</span>
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find by description, category or owner"
                className="w-full rounded-xl bg-surface-container-low py-2.5 pl-10 pr-4 text-sm outline-none border border-transparent focus:border-primary-container"
              />
            </div>
            <button
              onClick={toggleSelectVisible}
              disabled={visibleRows.length === 0}
              className="rounded-xl bg-surface-container-low px-4 py-2.5 text-sm font-semibold hover:bg-surface-container disabled:opacity-50"
            >
              {allVisibleSelected ? 'Unselect' : 'Select'} {search ? `${visibleRows.length} matching` : 'all'}
            </button>
            {selectedIds.size > 0 && (
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-sm font-semibold text-on-surface-variant hover:text-on-surface"
              >
                Clear selection
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-container-low p-3">
            <span className="text-sm font-semibold text-on-surface">
              Apply to {selectedIds.size} selected:
            </span>
            <div className="min-w-[200px]">{categorySelect(bulkCategory, setBulkCategory, 'bg-surface-container-lowest', 'Category…')}</div>
            <select
              value={bulkType}
              onChange={(e) => setBulkType(e.target.value)}
              className={`${inputClass} bg-surface-container-lowest !w-auto`}
            >
              <option value="">Type…</option>
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>
            <input
              type="text"
              value={bulkOwner}
              onChange={(e) => setBulkOwner(e.target.value)}
              placeholder="Owner…"
              className={`${inputClass} bg-surface-container-lowest !w-40`}
            />
            <button
              onClick={applyToSelected}
              disabled={selectedIds.size === 0 || !hasBulkValue}
              className="rounded-xl bg-primary-container px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {error && <div className="m-4 p-4 rounded-lg bg-error/10 text-error text-sm">{error}</div>}
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-container"></div>
            </div>
          ) : isError ? (
            <div className="py-16 text-center text-on-surface-variant">Could not load transactions.</div>
          ) : visibleRows.length === 0 ? (
            <div className="py-16 text-center text-on-surface-variant">No transactions to show.</div>
          ) : (
            <table className="w-full min-w-[900px]">
              <thead className="bg-surface-container-low sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectVisible}
                      className="w-5 h-5 rounded cursor-pointer accent-primary-container"
                      aria-label="Select all visible"
                    />
                  </th>
                  {['Date', 'Description', 'Amount', 'Type', 'Category', 'Owner', ''].map((h) => (
                    <th
                      key={h}
                      className={`px-2 py-3 text-xs font-semibold uppercase tracking-wider text-on-surface-variant ${
                        h === 'Amount' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {visibleRows.map((r) => {
                  const changed = changedFields(r);
                  const isDirty = changed.length > 0;
                  const mark = (field: EditableField) => (changed.includes(field) ? 'ring-1 ring-amber-500/70' : '');
                  return (
                    <tr
                      key={r.id}
                      className={`${isDirty ? 'bg-amber-500/5' : ''} ${
                        selectedIds.has(r.id) ? 'bg-primary-container/10' : ''
                      } hover:bg-surface-container-low/50`}
                    >
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleSelection(r.id)}
                          className="w-5 h-5 rounded cursor-pointer accent-primary-container"
                        />
                      </td>
                      <td className="px-2 py-2 w-40">
                        <input
                          type="date"
                          value={r.date}
                          onChange={(e) => updateRow(r.id, 'date', e.target.value)}
                          className={`${inputClass} ${mark('date')}`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          value={r.description}
                          onChange={(e) => updateRow(r.id, 'description', e.target.value)}
                          className={`${inputClass} ${mark('description')}`}
                        />
                      </td>
                      <td className="px-2 py-2 w-32">
                        <input
                          type="number"
                          step="0.01"
                          value={r.amount}
                          onChange={(e) => updateRow(r.id, 'amount', parseFloat(e.target.value) || 0)}
                          className={`${inputClass} text-right ${r.type === 'credit' ? 'text-primary' : 'text-error'} ${mark('amount')}`}
                        />
                      </td>
                      <td className="px-2 py-2 w-28">
                        <select
                          value={r.type}
                          onChange={(e) => updateRow(r.id, 'type', e.target.value as 'debit' | 'credit')}
                          className={`${inputClass} ${mark('type')}`}
                        >
                          <option value="debit">Debit</option>
                          <option value="credit">Credit</option>
                        </select>
                      </td>
                      <td className="px-2 py-2 w-52">
                        {categorySelect(r.category, (v) => updateRow(r.id, 'category', v), mark('category'))}
                      </td>
                      <td className="px-2 py-2 w-32">
                        <input
                          type="text"
                          value={r.owner}
                          onChange={(e) => updateRow(r.id, 'owner', e.target.value)}
                          className={`${inputClass} ${mark('owner')}`}
                        />
                      </td>
                      <td className="px-2 py-2 w-10">
                        {isDirty && (
                          <button
                            onClick={() => resetRow(r.id)}
                            title="Undo changes on this row"
                            className="p-1 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                          >
                            <span className="material-symbols-outlined text-lg">undo</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t flex flex-wrap justify-between items-center gap-4">
          <p className="text-sm text-on-surface-variant">
            {dirtyRows.length === 0
              ? 'No changes yet'
              : `${dirtyRows.length} transaction${dirtyRows.length === 1 ? '' : 's'} changed`}
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="py-3 px-6 rounded-xl border border-surface-container font-medium hover:bg-surface-container-low"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setError(null);
                saveMutation.mutate();
              }}
              disabled={saveMutation.isPending || dirtyRows.length === 0}
              className="py-3 px-8 rounded-xl bg-primary-container text-white font-bold hover:opacity-90 disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving...' : `Save ${dirtyRows.length} change${dirtyRows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
