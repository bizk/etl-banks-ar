import { db, type LocalArea, type LocalCategory } from '../local/db';
import { areaView, byLid, newRow, ofWorkspace, queue, touched, write } from '../local/store';
import { areaMonthlySummary, areaYearlySummary } from '../local/summaries';
import { ensureLocalCopy } from '../sync/engine';
import type { Area, YearlyAreaSummary } from '../types';
import { transactionsInMonth, transactionsInYear } from './transactions';

interface CreateAreaRequest {
  name: string;
  color?: string;
  icon?: string;
}

interface UpdateAreaRequest {
  name?: string;
  color?: string;
  icon?: string;
}

export interface AreaCategorySummary {
  category_id: number;
  category_name: string;
  amount: number;
  count: number;
}

export interface AreaSummaryItem {
  area_id: number | null;
  area_name: string;
  color: string;
  icon: string;
  amount: number;
  count: number;
  percentage: number;
  categories: AreaCategorySummary[];
}

export interface AreaSummaryResponse {
  month: string;
  total_spent: number;
  areas: AreaSummaryItem[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

// Backed by the local database; see src/local and src/sync.
export const areasApi = {
  list: async (workspaceId: number): Promise<{ areas: Area[] }> => {
    await ensureLocalCopy(workspaceId);
    const areas = await ofWorkspace<LocalArea>('area', workspaceId);
    return { areas: areas.sort(byName).map(areaView) };
  },

  get: async (workspaceId: number, areaId: number): Promise<{ area: Area }> => {
    await ensureLocalCopy(workspaceId);
    return { area: areaView(await byLid<LocalArea>('area', workspaceId, areaId)) };
  },

  create: async (workspaceId: number, data: CreateAreaRequest): Promise<{ area: Area }> => {
    const row: LocalArea = { ...newRow(workspaceId), name: data.name, color: data.color ?? '', icon: data.icon ?? '' };
    await write(async () => {
      await db.areas.add(row);
      await queue(workspaceId, 'area', 'upsert', row.client_id);
    });
    return { area: areaView(row) };
  },

  update: async (workspaceId: number, areaId: number, data: UpdateAreaRequest): Promise<{ area: Area }> => {
    const row = await write(async () => {
      const area = await byLid<LocalArea>('area', workspaceId, areaId);
      Object.assign(area, {
        name: data.name ?? area.name, color: data.color ?? area.color, icon: data.icon ?? area.icon, ...touched(),
      });
      await db.areas.put(area);
      await queue(workspaceId, 'area', 'upsert', area.client_id);
      return area;
    });
    return { area: areaView(row) };
  },

  delete: async (workspaceId: number, areaId: number): Promise<void> => {
    await write(async () => {
      const area = await byLid<LocalArea>('area', workspaceId, areaId);
      await db.areas.delete(area.client_id);
      // The server unassigns whatever pointed at the area; mirror that locally.
      const pointsHere = (r: { area_client_id: string | null }) => r.area_client_id === area.client_id;
      await db.categories.where('workspace_id').equals(workspaceId).and(pointsHere).modify({ area_client_id: null });
      await db.transactions.where('workspace_id').equals(workspaceId).and(pointsHere).modify({ area_client_id: null });
      await queue(workspaceId, 'area', 'delete', area.client_id);
    });
  },

  getSummary: async (workspaceId: number, month: string): Promise<AreaSummaryResponse> => {
    const transactions = await transactionsInMonth(workspaceId, month);
    return areaMonthlySummary(
      month, transactions,
      await ofWorkspace<LocalCategory>('category', workspaceId), await ofWorkspace<LocalArea>('area', workspaceId),
    );
  },

  getYearlySummary: async (workspaceId: number, year: string): Promise<YearlyAreaSummary> => {
    const transactions = await transactionsInYear(workspaceId, year);
    return areaYearlySummary(
      year, transactions,
      await ofWorkspace<LocalCategory>('category', workspaceId), await ofWorkspace<LocalArea>('area', workspaceId),
    );
  },
};
