import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { transactionsApi } from '../../api/transactions';
import type { PreviewTransaction, UploadPreview } from '../../types';

interface UploadPreviewModalProps {
  workspaceId: number;
  isOpen: boolean;
  onClose: () => void;
}

type UploadStep = 'idle' | 'uploading' | 'processing' | 'preview';

export function UploadPreviewModal({ workspaceId, isOpen, onClose }: UploadPreviewModalProps) {
  const [step, setStep] = useState<UploadStep>('idle');
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [transactions, setTransactions] = useState<PreviewTransaction[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: (file: File) => transactionsApi.uploadPDF(workspaceId, file),
    onSuccess: (data) => {
      setPreview(data.preview);
      setTransactions(data.preview.transactions);
      setSelectedIds(new Set(data.preview.transactions.map((t) => t.temp_id)));
      setStep('preview');
    },
    onError: (err: Error) => {
      setError(err.message || 'Upload failed');
      setStep('idle');
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (txns: Omit<PreviewTransaction, 'temp_id' | 'balance_after'>[]) =>
      transactionsApi.confirmUpload(workspaceId, txns),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      handleClose();
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to save transactions');
    },
  });

  const handleClose = () => {
    setStep('idle');
    setPreview(null);
    setTransactions([]);
    setSelectedIds(new Set());
    setError(null);
    onClose();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setStep('uploading');
    setTimeout(() => setStep('processing'), 500);
    uploadMutation.mutate(file);
  };

  const handleTriggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const toggleSelection = (tempId: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(tempId)) {
      newSelected.delete(tempId);
    } else {
      newSelected.add(tempId);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === transactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(transactions.map((t) => t.temp_id)));
    }
  };

  const updateTransaction = (tempId: number, field: keyof PreviewTransaction, value: string | number) => {
    setTransactions((prev) =>
      prev.map((t) => (t.temp_id === tempId ? { ...t, [field]: value } : t))
    );
  };

  const handleConfirm = () => {
    const selectedTxns = transactions
      .filter((t) => selectedIds.has(t.temp_id))
      .map(({ date, description, amount, type, category }) => ({
        date,
        description,
        amount,
        type,
        category,
      }));

    if (selectedTxns.length === 0) {
      setError('Please select at least one transaction');
      return;
    }

    confirmMutation.mutate(selectedTxns);
  };

  const selectedTransactions = transactions.filter((t) => selectedIds.has(t.temp_id));
  const selectedDebit = selectedTransactions.reduce(
    (sum, t) => (t.amount < 0 ? sum + t.amount : sum),
    0
  );
  const selectedCredit = selectedTransactions.reduce(
    (sum, t) => (t.amount > 0 ? sum + t.amount : sum),
    0
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface-container-lowest rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b flex justify-between items-center">
          <h2 className="text-xl font-headline font-bold">
            {step === 'idle' && 'Upload Bank Statement'}
            {step === 'uploading' && 'Uploading...'}
            {step === 'processing' && 'Processing PDF...'}
            {step === 'preview' && 'Review Transactions'}
          </h2>
          <button onClick={handleClose} className="text-on-surface-variant hover:text-on-surface-variant">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {error && (
            <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-lg">{error}</div>
          )}

          {/* Idle State - File Upload */}
          {step === 'idle' && (
            <div className="flex flex-col items-center justify-center py-16">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".pdf"
                className="hidden"
              />
              <span className="material-symbols-outlined text-6xl text-on-surface-variant opacity-30 mb-4">
                upload_file
              </span>
              <p className="text-on-surface-variant mb-6">Select a PDF bank statement to upload</p>
              <button
                onClick={handleTriggerFileInput}
                className="bg-primary-container text-white font-bold py-3 px-8 rounded-xl hover:opacity-90"
              >
                Choose PDF File
              </button>
            </div>
          )}

          {/* Loading States */}
          {(step === 'uploading' || step === 'processing') && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary-container mb-6"></div>
              <p className="text-on-surface-variant">
                {step === 'uploading' ? 'Uploading file...' : 'Processing and categorizing transactions...'}
              </p>
              <p className="text-on-surface-variant text-sm mt-2">This may take a moment</p>
            </div>
          )}

          {/* Preview State - Editable Table */}
          {step === 'preview' && preview && (
            <>
              {/* Summary Bar */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-surface-container-lowest p-4 rounded-xl">
                  <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">Selected</p>
                  <p className="text-xl font-bold">{selectedIds.size} / {transactions.length}</p>
                </div>
                <div className="bg-surface-container-lowest p-4 rounded-xl">
                  <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">Debits</p>
                  <p className="text-xl font-bold text-error">
                    ${Math.abs(selectedDebit).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="bg-surface-container-lowest p-4 rounded-xl">
                  <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">Credits</p>
                  <p className="text-xl font-bold text-primary">
                    +${selectedCredit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {/* Transactions Table */}
              <div className="bg-surface-container-lowest rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead className="bg-surface-container-low">
                    <tr>
                      <th className="px-4 py-3 text-left">
                        <input
                          type="checkbox"
                          checked={selectedIds.size === transactions.length}
                          onChange={toggleSelectAll}
                          className="rounded"
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                        Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                        Description
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                        Amount
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                        Type
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                        Category
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container-low">
                    {transactions.map((t) => (
                      <tr
                        key={t.temp_id}
                        className={`${
                          selectedIds.has(t.temp_id) ? '' : 'opacity-40'
                        } hover:bg-surface-container-low/50`}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(t.temp_id)}
                            onChange={() => toggleSelection(t.temp_id)}
                            className="rounded"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="date"
                            value={t.date}
                            onChange={(e) => updateTransaction(t.temp_id, 'date', e.target.value)}
                            className="w-full px-2 py-1 rounded bg-surface-container-lowest border border-surface-container text-sm"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={t.description}
                            onChange={(e) => updateTransaction(t.temp_id, 'description', e.target.value)}
                            className="w-full px-2 py-1 rounded bg-surface-container-lowest border border-surface-container text-sm"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number"
                            step="0.01"
                            value={t.amount}
                            onChange={(e) => updateTransaction(t.temp_id, 'amount', parseFloat(e.target.value) || 0)}
                            className={`w-24 px-2 py-1 rounded bg-surface-container-lowest border border-surface-container text-sm text-right ${
                              t.type === 'credit' ? 'text-primary' : 'text-error'
                            }`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={t.type}
                            onChange={(e) => updateTransaction(t.temp_id, 'type', e.target.value)}
                            className="px-2 py-1 rounded bg-surface-container-lowest border border-surface-container text-sm"
                          >
                            <option value="debit">Debit</option>
                            <option value="credit">Credit</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={t.category}
                            onChange={(e) => updateTransaction(t.temp_id, 'category', e.target.value)}
                            className="px-2 py-1 rounded bg-surface-container-lowest border border-surface-container text-sm min-w-[140px]"
                          >
                            <option value="">Uncategorized</option>
                            {preview.allowed_categories.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {step === 'preview' && (
          <div className="p-6 border-t flex justify-between items-center">
            <p className="text-sm text-on-surface-variant">
              {selectedIds.size} transaction{selectedIds.size !== 1 ? 's' : ''} selected
            </p>
            <div className="flex gap-4">
              <button
                onClick={handleClose}
                className="py-3 px-6 rounded-xl border border-surface-container font-medium hover:bg-surface-container-low"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirmMutation.isPending || selectedIds.size === 0}
                className="py-3 px-8 rounded-xl bg-primary-container text-white font-bold hover:opacity-90 disabled:opacity-50"
              >
                {confirmMutation.isPending ? 'Saving...' : `Confirm ${selectedIds.size} Transactions`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
