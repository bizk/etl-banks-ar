import { format } from 'date-fns';
import {
  db, newClientId, newLocalId, paymentKey,
  type LocalArea, type LocalCategory, type LocalPayment, type LocalRecurringExpense, type LocalTransaction,
} from '../local/db';
import { byLid, currentUserName, newRow, ofWorkspace, queue, touched, transactionView, write } from '../local/store';
import { dueDate, recurringSummary } from '../local/summaries';
import { ensureLocalCopy } from '../sync/engine';
import type { RecurringExpense, RecurringExpenseSummary, Transaction } from '../types';

interface CreateRecurringExpenseRequest {
  name: string;
  amount: number;
  category_id?: number | null;
  owner?: string;
  due_day: number;
}

interface UpdateRecurringExpenseRequest {
  name?: string;
  amount?: number;
  category_id?: number | null;
  owner?: string;
  due_day?: number;
}

const currentMonth = () => format(new Date(), 'yyyy-MM');

function validate(expense: LocalRecurringExpense): void {
  if (expense.due_day < 1 || expense.due_day > 31) throw new Error('due_day must be between 1 and 31');
  if (expense.amount <= 0) throw new Error('amount must be positive');
}

async function categoryClientId(workspaceId: number, categoryId: number | null | undefined): Promise<string | null> {
  if (categoryId == null) return null;
  return (await byLid<LocalCategory>('category', workspaceId, categoryId)).client_id;
}

/** Loads what is needed to present expenses for a month: their category, area and payment. */
async function viewer(workspaceId: number, month: string) {
  const categories = new Map((await ofWorkspace<LocalCategory>('category', workspaceId)).map((c) => [c.client_id, c]));
  const areas = new Map((await ofWorkspace<LocalArea>('area', workspaceId)).map((a) => [a.client_id, a]));
  const payments = new Map(
    (await db.payments.where('workspace_id').equals(workspaceId).and((p) => p.month === month).toArray())
      .map((p) => [p.recurring_expense_client_id, p]),
  );
  const view = (e: LocalRecurringExpense): RecurringExpense => {
    const category = e.category_client_id ? categories.get(e.category_client_id) : undefined;
    const area = category?.area_client_id ? areas.get(category.area_client_id) : undefined;
    const payment = payments.get(e.client_id);
    return {
      id: e.lid, workspace_id: e.workspace_id, name: e.name, amount: e.amount,
      category_id: category?.lid ?? null, category_name: category?.name,
      area_id: area?.lid, area_name: area?.name, owner: e.owner, due_day: e.due_day,
      last_paid_date: payment?.paid_at ?? null, is_paid_this_month: payment !== undefined,
      created_at: e.created_at, updated_at: e.updated_at,
    };
  };
  return { view, payments };
}

// Backed by the local database; see src/local and src/sync.
export const recurringExpensesApi = {
  list: async (workspaceId: number, month: string = currentMonth()): Promise<{ recurring_expenses: RecurringExpense[] }> => {
    await ensureLocalCopy(workspaceId);
    const expenses = await ofWorkspace<LocalRecurringExpense>('recurring_expense', workspaceId);
    const { view } = await viewer(workspaceId, month);
    return { recurring_expenses: expenses.sort((a, b) => a.due_day - b.due_day).map(view) };
  },

  getSummary: async (workspaceId: number, month: string = currentMonth()): Promise<RecurringExpenseSummary> => {
    await ensureLocalCopy(workspaceId);
    const expenses = await ofWorkspace<LocalRecurringExpense>('recurring_expense', workspaceId);
    const { payments } = await viewer(workspaceId, month);
    return recurringSummary(month, expenses, new Set(payments.keys()));
  },

  get: async (workspaceId: number, id: number): Promise<{ recurring_expense: RecurringExpense }> => {
    await ensureLocalCopy(workspaceId);
    const expense = await byLid<LocalRecurringExpense>('recurring_expense', workspaceId, id);
    return { recurring_expense: (await viewer(workspaceId, currentMonth())).view(expense) };
  },

  create: async (workspaceId: number, data: CreateRecurringExpenseRequest): Promise<{ recurring_expense: RecurringExpense }> => {
    const row = await write(async () => {
      const expense: LocalRecurringExpense = {
        ...newRow(workspaceId), name: data.name, amount: data.amount, owner: data.owner ?? '', due_day: data.due_day,
        category_client_id: await categoryClientId(workspaceId, data.category_id),
      };
      validate(expense);
      await db.recurringExpenses.add(expense);
      await queue(workspaceId, 'recurring_expense', 'upsert', expense.client_id);
      return expense;
    });
    return { recurring_expense: (await viewer(workspaceId, currentMonth())).view(row) };
  },

  update: async (workspaceId: number, id: number, data: UpdateRecurringExpenseRequest): Promise<{ recurring_expense: RecurringExpense }> => {
    const row = await write(async () => {
      const expense = await byLid<LocalRecurringExpense>('recurring_expense', workspaceId, id);
      if (data.name !== undefined) expense.name = data.name;
      if (data.amount !== undefined) expense.amount = data.amount;
      if (data.owner !== undefined) expense.owner = data.owner;
      if (data.due_day !== undefined) expense.due_day = data.due_day;
      // As on the server, a null category leaves the current one in place.
      if (data.category_id != null) expense.category_client_id = await categoryClientId(workspaceId, data.category_id);
      validate(expense);
      Object.assign(expense, touched());
      await db.recurringExpenses.put(expense);
      await queue(workspaceId, 'recurring_expense', 'upsert', expense.client_id);
      return expense;
    });
    return { recurring_expense: (await viewer(workspaceId, currentMonth())).view(row) };
  },

  delete: async (workspaceId: number, id: number): Promise<void> => {
    await write(async () => {
      const expense = await byLid<LocalRecurringExpense>('recurring_expense', workspaceId, id);
      await db.recurringExpenses.delete(expense.client_id);
      await db.payments.where('recurring_expense_client_id').equals(expense.client_id).delete();
      await queue(workspaceId, 'recurring_expense', 'delete', expense.client_id);
    });
  },

  /**
   * Records the month's payment and the transaction it generates. The transaction is created
   * here under a client_id the server will reuse, so it shows up immediately, even offline.
   */
  markPaid: async (workspaceId: number, id: number, month: string = currentMonth()): Promise<{ recurring_expense: RecurringExpense; transaction?: Transaction }> => {
    const result = await write(async () => {
      const expense = await byLid<LocalRecurringExpense>('recurring_expense', workspaceId, id);
      const key = paymentKey(workspaceId, expense.client_id, month);
      if (await db.payments.get(key)) return { expense, transaction: undefined };

      const category = expense.category_client_id ? await db.categories.get(expense.category_client_id) : undefined;
      const now = new Date().toISOString();
      const transaction: LocalTransaction = {
        client_id: newClientId(), workspace_id: workspaceId, lid: newLocalId(), server_id: null, server_updated_at: null,
        created_at: now, updated_at: now, date: dueDate(month, expense.due_day), description: expense.name,
        amount: expense.amount, balance_after: null, type: 'debit', category: category?.name ?? '',
        owner: expense.owner || currentUserName(), area_client_id: null, user_confirmed: false,
      };
      const payment: LocalPayment = {
        key, workspace_id: workspaceId, recurring_expense_client_id: expense.client_id, month,
        paid_at: transaction.date, transaction_client_id: transaction.client_id,
      };
      await db.transactions.add(transaction);
      await db.payments.add(payment);
      await queue(workspaceId, 'recurring_expense', 'mark_paid', expense.client_id, {
        month, transaction_client_id: transaction.client_id,
      });
      return { expense, transaction };
    });
    return {
      recurring_expense: (await viewer(workspaceId, month)).view(result.expense),
      transaction: result.transaction && transactionView(result.transaction),
    };
  },
};
