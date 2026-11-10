import { db, type LocalArea, type LocalCategory } from '../local/db';
import { areasByClientId, byLid, categoryView, newRow, ofWorkspace, queue, touched, write } from '../local/store';
import { ensureLocalCopy } from '../sync/engine';
import type { Category } from '../types';

interface CreateCategoryRequest {
  name: string;
  area_id?: number | null;
  color?: string;
  icon?: string;
}

interface UpdateCategoryRequest {
  name?: string;
  area_id?: number | null;
  color?: string;
  icon?: string;
}

async function areaClientId(workspaceId: number, areaId: number | null | undefined): Promise<string | null> {
  if (areaId == null) return null;
  return (await byLid<LocalArea>('area', workspaceId, areaId)).client_id;
}

/** Category names are unique per workspace; the server enforces the same rule. */
async function assertNameFree(workspaceId: number, name: string, except?: string): Promise<void> {
  const categories = await ofWorkspace<LocalCategory>('category', workspaceId);
  if (categories.some((c) => c.name === name && c.client_id !== except)) {
    throw new Error(`A category named "${name}" already exists`);
  }
}

// Backed by the local database; see src/local and src/sync.
export const categoriesApi = {
  list: async (workspaceId: number): Promise<{ categories: Category[] }> => {
    await ensureLocalCopy(workspaceId);
    const areas = await areasByClientId(workspaceId);
    const categories = await ofWorkspace<LocalCategory>('category', workspaceId);
    return {
      categories: categories.sort((a, b) => a.name.localeCompare(b.name)).map((c) => categoryView(c, areas)),
    };
  },

  get: async (workspaceId: number, categoryId: number): Promise<{ category: Category }> => {
    await ensureLocalCopy(workspaceId);
    const row = await byLid<LocalCategory>('category', workspaceId, categoryId);
    return { category: categoryView(row, await areasByClientId(workspaceId)) };
  },

  create: async (workspaceId: number, data: CreateCategoryRequest): Promise<{ category: Category }> => {
    const row = await write(async () => {
      await assertNameFree(workspaceId, data.name);
      const category: LocalCategory = {
        ...newRow(workspaceId), name: data.name, area_client_id: await areaClientId(workspaceId, data.area_id),
        color: data.color ?? '', icon: data.icon ?? '',
      };
      await db.categories.add(category);
      await queue(workspaceId, 'category', 'upsert', category.client_id);
      return category;
    });
    return { category: categoryView(row, await areasByClientId(workspaceId)) };
  },

  update: async (workspaceId: number, categoryId: number, data: UpdateCategoryRequest): Promise<{ category: Category }> => {
    const row = await write(async () => {
      const category = await byLid<LocalCategory>('category', workspaceId, categoryId);
      if (data.name !== undefined && data.name !== category.name) {
        await assertNameFree(workspaceId, data.name, category.client_id);
        category.name = data.name;
      }
      if (data.color !== undefined) category.color = data.color;
      if (data.icon !== undefined) category.icon = data.icon;
      // undefined leaves the area alone; null clears it.
      if (data.area_id !== undefined) category.area_client_id = await areaClientId(workspaceId, data.area_id);
      Object.assign(category, touched());
      await db.categories.put(category);
      await queue(workspaceId, 'category', 'upsert', category.client_id);
      return category;
    });
    return { category: categoryView(row, await areasByClientId(workspaceId)) };
  },

  delete: async (workspaceId: number, categoryId: number): Promise<void> => {
    await write(async () => {
      const category = await byLid<LocalCategory>('category', workspaceId, categoryId);
      await db.categories.delete(category.client_id);
      await db.recurringExpenses.where('workspace_id').equals(workspaceId)
        .and((e) => e.category_client_id === category.client_id).modify({ category_client_id: null });
      await queue(workspaceId, 'category', 'delete', category.client_id);
    });
  },
};
