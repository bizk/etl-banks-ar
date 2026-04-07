import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { areasApi } from '../api/areas';
import { categoriesApi } from '../api/categories';
import { useWorkspaceStore } from '../store/workspaceSlice';
import type { Area, Category } from '../types';

const COLORS = [
  { value: '#10b981', label: 'Emerald' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#8b5cf6', label: 'Violet' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#ef4444', label: 'Red' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#6366f1', label: 'Indigo' },
  { value: '#14b8a6', label: 'Teal' },
];

const ICONS = [
  'restaurant', 'local_grocery_store', 'directions_car', 'home', 'flight',
  'shopping_bag', 'sports_esports', 'health_and_safety', 'school', 'work',
  'savings', 'credit_card', 'subscriptions', 'fitness_center', 'pets',
  'local_cafe', 'local_bar', 'movie', 'music_note', 'spa',
];

interface AreaFormData {
  name: string;
  color: string;
  icon: string;
}

interface CategoryFormData {
  name: string;
  area_id: number | null;
  color: string;
  icon: string;
}

export function AreasPage() {
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const queryClient = useQueryClient();

  // Modal states
  const [showAreaModal, setShowAreaModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingArea, setEditingArea] = useState<Area | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  // Form states
  const [areaForm, setAreaForm] = useState<AreaFormData>({
    name: '',
    color: COLORS[0].value,
    icon: ICONS[0],
  });
  const [categoryForm, setCategoryForm] = useState<CategoryFormData>({
    name: '',
    area_id: null,
    color: COLORS[0].value,
    icon: ICONS[0],
  });

  // Queries
  const { data: areasData, isLoading: areasLoading } = useQuery({
    queryKey: ['areas', currentWorkspace?.id],
    queryFn: () => areasApi.list(currentWorkspace!.id),
    enabled: !!currentWorkspace?.id,
  });

  const { data: categoriesData, isLoading: categoriesLoading } = useQuery({
    queryKey: ['categoriesList', currentWorkspace?.id],
    queryFn: () => categoriesApi.list(currentWorkspace!.id),
    enabled: !!currentWorkspace?.id,
  });

  // Area mutations
  const createAreaMutation = useMutation({
    mutationFn: (data: AreaFormData) => areasApi.create(currentWorkspace!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] });
      closeAreaModal();
    },
  });

  const updateAreaMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: AreaFormData }) =>
      areasApi.update(currentWorkspace!.id, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] });
      queryClient.invalidateQueries({ queryKey: ['categoriesList'] });
      closeAreaModal();
    },
  });

  const deleteAreaMutation = useMutation({
    mutationFn: (id: number) => areasApi.delete(currentWorkspace!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] });
      queryClient.invalidateQueries({ queryKey: ['categoriesList'] });
    },
  });

  // Category mutations
  const createCategoryMutation = useMutation({
    mutationFn: (data: CategoryFormData) => categoriesApi.create(currentWorkspace!.id, {
      ...data,
      area_id: data.area_id || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categoriesList'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      closeCategoryModal();
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CategoryFormData> }) =>
      categoriesApi.update(currentWorkspace!.id, id, {
        ...data,
        area_id: data.area_id === null ? null : data.area_id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categoriesList'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      closeCategoryModal();
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: number) => categoriesApi.delete(currentWorkspace!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categoriesList'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });

  // Handlers
  const openCreateAreaModal = () => {
    setEditingArea(null);
    setAreaForm({ name: '', color: COLORS[0].value, icon: ICONS[0] });
    setShowAreaModal(true);
  };

  const openEditAreaModal = (area: Area) => {
    setEditingArea(area);
    setAreaForm({ name: area.name, color: area.color || COLORS[0].value, icon: area.icon || ICONS[0] });
    setShowAreaModal(true);
  };

  const closeAreaModal = () => {
    setShowAreaModal(false);
    setEditingArea(null);
  };

  const openCreateCategoryModal = () => {
    setEditingCategory(null);
    setCategoryForm({ name: '', area_id: null, color: COLORS[0].value, icon: ICONS[0] });
    setShowCategoryModal(true);
  };

  const openEditCategoryModal = (category: Category) => {
    setEditingCategory(category);
    setCategoryForm({
      name: category.name,
      area_id: category.area_id,
      color: category.color || COLORS[0].value,
      icon: category.icon || ICONS[0],
    });
    setShowCategoryModal(true);
  };

  const closeCategoryModal = () => {
    setShowCategoryModal(false);
    setEditingCategory(null);
  };

  const handleAreaSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingArea) {
      updateAreaMutation.mutate({ id: editingArea.id, data: areaForm });
    } else {
      createAreaMutation.mutate(areaForm);
    }
  };

  const handleCategorySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingCategory) {
      updateCategoryMutation.mutate({ id: editingCategory.id, data: categoryForm });
    } else {
      createCategoryMutation.mutate(categoryForm);
    }
  };

  const handleDeleteArea = (area: Area) => {
    if (confirm(`Are you sure you want to delete "${area.name}"? Categories assigned to this area will become unassigned.`)) {
      deleteAreaMutation.mutate(area.id);
    }
  };

  const handleDeleteCategory = (category: Category) => {
    if (confirm(`Are you sure you want to delete "${category.name}"?`)) {
      deleteCategoryMutation.mutate(category.id);
    }
  };

  const handleCategoryAreaChange = (categoryId: number, areaId: number | null) => {
    updateCategoryMutation.mutate({ id: categoryId, data: { area_id: areaId } });
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

  const areas = areasData?.areas || [];
  const categories = categoriesData?.categories || [];
  const isLoading = areasLoading || categoriesLoading;

  // Group categories by area for display
  const getCategoriesForArea = (areaId: number) =>
    categories.filter((c) => c.area_id === areaId);

  return (
    <div>
      {/* Header */}
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-headline font-extrabold tracking-tight text-on-surface">
            Areas & Categories
          </h1>
          <p className="text-on-surface-variant mt-2 font-medium opacity-60">
            Organize your transactions with areas and categories
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-container"></div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Areas Section */}
          <section className="bg-surface-container-lowest rounded-2xl p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-lg font-headline font-bold text-on-surface">Areas</h2>
                <p className="text-sm text-on-surface-variant mt-1">
                  Areas group related categories together
                </p>
              </div>
              <button
                onClick={openCreateAreaModal}
                className="bg-primary-container text-white font-headline font-bold py-2 px-4 rounded-xl flex items-center gap-2 hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined">add</span>
                New Area
              </button>
            </div>

            {areas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant">
                <span className="material-symbols-outlined text-5xl mb-4">category</span>
                <p>No areas created yet</p>
                <p className="text-sm mt-1">Create an area to group your categories</p>
              </div>
            ) : (
              <div className="space-y-3">
                {areas.map((area) => {
                  const areaCategories = getCategoriesForArea(area.id);
                  return (
                    <div
                      key={area.id}
                      className="flex items-center justify-between p-4 rounded-xl bg-surface-container-low hover:bg-surface-container transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: area.color || COLORS[0].value }}
                        >
                          <span className="material-symbols-outlined text-white">
                            {area.icon || 'category'}
                          </span>
                        </div>
                        <div>
                          <h3 className="font-semibold text-on-surface">{area.name}</h3>
                          <p className="text-sm text-on-surface-variant">
                            {areaCategories.length === 0
                              ? 'No categories assigned'
                              : areaCategories.map((c) => c.name).join(', ')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditAreaModal(area)}
                          className="p-2 rounded-lg hover:bg-surface-container-high transition-colors text-on-surface-variant hover:text-primary"
                        >
                          <span className="material-symbols-outlined">edit</span>
                        </button>
                        <button
                          onClick={() => handleDeleteArea(area)}
                          className="p-2 rounded-lg hover:bg-surface-container-high transition-colors text-on-surface-variant hover:text-error"
                        >
                          <span className="material-symbols-outlined">delete</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Categories Section */}
          <section className="bg-surface-container-lowest rounded-2xl p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-lg font-headline font-bold text-on-surface">Categories</h2>
                <p className="text-sm text-on-surface-variant mt-1">
                  Assign categories to areas using the dropdown
                </p>
              </div>
              <button
                onClick={openCreateCategoryModal}
                className="bg-primary-container text-white font-headline font-bold py-2 px-4 rounded-xl flex items-center gap-2 hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined">add</span>
                New Category
              </button>
            </div>

            {categories.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant">
                <span className="material-symbols-outlined text-5xl mb-4">label</span>
                <p>No categories created yet</p>
                <p className="text-sm mt-1">Categories are created automatically from transactions</p>
              </div>
            ) : (
              <div className="space-y-2">
                {categories.map((category) => (
                  <div
                    key={category.id}
                    className="flex items-center justify-between p-4 rounded-xl bg-surface-container-low hover:bg-surface-container transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: category.color || COLORS[0].value }}
                      >
                        <span className="material-symbols-outlined text-white text-lg">
                          {category.icon || 'label'}
                        </span>
                      </div>
                      <span className="font-medium text-on-surface">{category.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-on-surface-variant">Area:</span>
                        <select
                          value={category.area_id || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            handleCategoryAreaChange(category.id, val ? Number(val) : null);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-surface-container border-none text-sm font-medium min-w-[140px]"
                        >
                          <option value="">None</option>
                          {areas.map((area) => (
                            <option key={area.id} value={area.id}>
                              {area.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        onClick={() => openEditCategoryModal(category)}
                        className="p-2 rounded-lg hover:bg-surface-container-high transition-colors text-on-surface-variant hover:text-primary"
                      >
                        <span className="material-symbols-outlined">edit</span>
                      </button>
                      <button
                        onClick={() => handleDeleteCategory(category)}
                        className="p-2 rounded-lg hover:bg-surface-container-high transition-colors text-on-surface-variant hover:text-error"
                      >
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Area Modal */}
      {showAreaModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-container-lowest rounded-2xl p-8 w-full max-w-md">
            <h2 className="text-xl font-headline font-bold mb-6">
              {editingArea ? 'Edit Area' : 'New Area'}
            </h2>
            <form onSubmit={handleAreaSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Name</label>
                <input
                  type="text"
                  value={areaForm.name}
                  onChange={(e) => setAreaForm({ ...areaForm, name: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-low border-none"
                  placeholder="e.g., Food & Dining"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-2">Color</label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => setAreaForm({ ...areaForm, color: color.value })}
                      className={`w-10 h-10 rounded-full transition-all ${
                        areaForm.color === color.value ? 'ring-2 ring-offset-2 ring-on-surface-variant' : ''
                      }`}
                      style={{ backgroundColor: color.value }}
                      title={color.label}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-2">Icon</label>
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 bg-surface-container-low rounded-lg">
                  {ICONS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => setAreaForm({ ...areaForm, icon })}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
                        areaForm.icon === icon
                          ? 'bg-primary-container text-white'
                          : 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant'
                      }`}
                    >
                      <span className="material-symbols-outlined">{icon}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={closeAreaModal}
                  className="flex-1 py-3 rounded-xl border border-surface-container font-medium hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createAreaMutation.isPending || updateAreaMutation.isPending}
                  className="flex-1 py-3 rounded-xl bg-primary-container text-white font-bold hover:opacity-90 disabled:opacity-50"
                >
                  {editingArea ? 'Save Changes' : 'Create Area'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Category Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-container-lowest rounded-2xl p-8 w-full max-w-md">
            <h2 className="text-xl font-headline font-bold mb-6">
              {editingCategory ? 'Edit Category' : 'New Category'}
            </h2>
            <form onSubmit={handleCategorySubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Name</label>
                <input
                  type="text"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-low border-none"
                  placeholder="e.g., groceries"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Area</label>
                <select
                  value={categoryForm.area_id || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCategoryForm({ ...categoryForm, area_id: val ? Number(val) : null });
                  }}
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-low border-none"
                >
                  <option value="">None</option>
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-2">Color</label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => setCategoryForm({ ...categoryForm, color: color.value })}
                      className={`w-10 h-10 rounded-full transition-all ${
                        categoryForm.color === color.value ? 'ring-2 ring-offset-2 ring-on-surface-variant' : ''
                      }`}
                      style={{ backgroundColor: color.value }}
                      title={color.label}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-2">Icon</label>
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 bg-surface-container-low rounded-lg">
                  {ICONS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => setCategoryForm({ ...categoryForm, icon })}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
                        categoryForm.icon === icon
                          ? 'bg-primary-container text-white'
                          : 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant'
                      }`}
                    >
                      <span className="material-symbols-outlined">{icon}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={closeCategoryModal}
                  className="flex-1 py-3 rounded-xl border border-surface-container font-medium hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createCategoryMutation.isPending || updateCategoryMutation.isPending}
                  className="flex-1 py-3 rounded-xl bg-primary-container text-white font-bold hover:opacity-90 disabled:opacity-50"
                >
                  {editingCategory ? 'Save Changes' : 'Create Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
