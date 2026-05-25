import { Fragment, useEffect, useMemo, useState, type Dispatch, type FormEvent, type ReactElement, type SetStateAction } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Area, Category } from '../../types';
import {
  isPredefinedCategory,
  normalizeCategory,
  PREDEFINED_CATEGORIES,
} from './categoryMeta';

export interface TransactionFormData {
  date: string;
  description: string;
  amount: string;
  type: 'debit' | 'credit';
  category: string;
  owner: string;
}

export interface CategoryDisplay {
  icon: string;
  color: string | null;
  badgeClassName: string;
  useCustomColor: boolean;
}

interface TransactionFormModalProps {
  isOpen: boolean;
  editingId: number | null;
  formData: TransactionFormData;
  setFormData: Dispatch<SetStateAction<TransactionFormData>>;
  categories: Category[];
  areas: Area[];
  categoryMap: Map<string, Category>;
  getCategoryDisplay: (categoryName: string) => CategoryDisplay;
  /** Returns true while create/update request is running */
  isSubmitting: boolean;
  onClose: () => void;
  onSubmitCreate: (
    data: TransactionFormData,
    options: { createAnother: boolean }
  ) => Promise<void>;
  onSubmitUpdate: (id: number, data: TransactionFormData) => Promise<void>;
}

/** Category name matches optional search phrase (normalized) */
function nameMatchesNormalized(name: string, normalizedPhrase: string): boolean {
  if (!normalizedPhrase) {
    return true;
  }
  return normalizeCategory(name).includes(normalizedPhrase);
}

export function TransactionFormModal(props: TransactionFormModalProps): ReactElement | null {
  const {
    isOpen,
    editingId,
    formData,
    setFormData,
    categories,
    areas,
    categoryMap,
    getCategoryDisplay,
    isSubmitting,
    onClose,
    onSubmitCreate,
    onSubmitUpdate,
  } = props;

  const [showDateModal, setShowDateModal] = useState(false);
  const [pendingDateStr, setPendingDateStr] = useState('');
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const [createAnotherAfterSave, setCreateAnotherAfterSave] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setShowDateModal(false);
      setPendingDateStr('');
      setShowCategorySuggestions(false);
      setCreateAnotherAfterSave(false);
    }
  }, [isOpen]);

  const dbCategorySet = useMemo(() => {
    const set = new Set<string>();
    categories.forEach((c) => {
      if (c.name?.trim()) set.add(normalizeCategory(c.name));
    });
    return set;
  }, [categories]);

  const predefinedNotInDb = useMemo(
    () =>
      PREDEFINED_CATEGORIES.filter(
        (c) => c && c.trim() && !dbCategorySet.has(normalizeCategory(c))
      ),
    [dbCategorySet]
  );

  const normalizedCategoryInput = normalizeCategory(formData.category);

  /** Group DB categories under each workspace area (+ uncategorized bucket) */
  const groupedAreas = useMemo(() => {
    const uncategorizedCats = categories
      .filter((c) => c.area_id == null && c.name?.trim())
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));

    const byAreaId = areas.map((area) => ({
      kind: 'area' as const,
      area,
      categories: categories
        .filter((c) => c.area_id === area.id && c.name?.trim())
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));

    return { byAreaId, uncategorizedCats };
  }, [areas, categories]);

  const selectedCategoryIsPreset =
    isPredefinedCategory(formData.category) ||
    categoryMap.has(normalizeCategory(formData.category));

  /** Filter categories by search; hides whole area blocks when search active and empty */
  const filterCatList = <T extends { name: string }>(list: readonly T[]): T[] => {
    if (!normalizedCategoryInput) {
      return [...list];
    }
    return list.filter((c) => nameMatchesNormalized(c.name, normalizedCategoryInput));
  };

  const suggestionNamesShown = useMemo(() => {
    if (!normalizedCategoryInput) {
      return predefinedNotInDb;
    }
    return predefinedNotInDb.filter((name) =>
      nameMatchesNormalized(name, normalizedCategoryInput)
    );
  }, [predefinedNotInDb, normalizedCategoryInput]);

  const displayDateParsed = (): Date => {
    try {
      const d = parseISO(formData.date);
      return isValid(d) ? d : new Date();
    } catch {
      return new Date();
    }
  };

  const openDateModal = (): void => {
    setPendingDateStr(formData.date);
    setShowDateModal(true);
  };

  const applyDateModal = (): void => {
    setFormData((prev) => ({ ...prev, date: pendingDateStr || prev.date }));
    setShowDateModal(false);
  };

  const cancelDateModal = (): void => {
    setShowDateModal(false);
  };

  const renderCategoryPickRow = (
    categoryName: string,
    subtitle?: string,
    subtitleClassName?: string
  ): ReactElement => {
    const display = getCategoryDisplay(categoryName);
    const isSelected = normalizeCategory(categoryName) === normalizedCategoryInput;

    return (
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={() => {
          setFormData((prev) => ({ ...prev, category: categoryName }));
          setShowCategorySuggestions(false);
        }}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
          isSelected ? 'bg-surface-container-low' : 'hover:bg-surface-container-low'
        }`}
      >
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${display.useCustomColor ? 'text-white ring-white/20' : display.badgeClassName}`}
          style={display.useCustomColor ? { backgroundColor: display.color! } : undefined}
        >
          <span className="material-symbols-outlined text-lg">{display.icon}</span>
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{categoryName}</span>
          {subtitle !== undefined ? (
            <span className={`truncate text-xs text-on-surface-variant ${subtitleClassName ?? ''}`}>
              {subtitle}
            </span>
          ) : null}
        </span>
      </button>
    );
  };

  const renderAreaSection = (
    headerLabel: string,
    areaCats: Category[],
    areaIcon: string,
    areaColor: string | null
  ): ReactElement | null => {
    const filtered = normalizedCategoryInput ? filterCatList(areaCats) : areaCats;
    const searching = normalizedCategoryInput.length > 0;

    if (searching && filtered.length === 0) {
      return null;
    }

    const showSection = !searching || filtered.length > 0;

    if (!showSection) {
      return null;
    }

    return (
      <div key={headerLabel} className="rounded-lg border border-surface-container bg-surface-container-lowest/40 p-1">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-white/20 text-white"
            style={areaColor ? { backgroundColor: areaColor } : { backgroundColor: '#6b7280' }}
          >
            <span className="material-symbols-outlined text-base">{areaIcon}</span>
          </span>
          <span className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">{headerLabel}</span>
          {!searching && filtered.length === 0 ? (
            <span className="text-xs italic text-on-surface-variant opacity-75">Sin categorías</span>
          ) : null}
        </div>
        <div className="space-y-0.5 pl-1 pb-1">
          {filtered.map((cat) => {
            const isFromDb = categoryMap.has(normalizeCategory(cat.name));
            const subtitle =
              isFromDb
                ? 'Categoría existente'
                : isPredefinedCategory(cat.name)
                  ? 'Categoría sugerida'
                  : undefined;

            return (
              <div key={`cat-${cat.id}`}>{renderCategoryPickRow(cat.name, subtitle)}</div>
            );
          })}
        </div>
      </div>
    );
  };

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();

    try {
      if (editingId != null) {
        await onSubmitUpdate(editingId, formData);
      } else {
        await onSubmitCreate(formData, { createAnother: createAnotherAfterSave });
      }
    } catch {
      // Mutations expose errors elsewhere; modal stays open
    }
  };

  if (!isOpen) {
    return null;
  }

  const anyDbCategoryMatchesSearch =
    normalizedCategoryInput !== '' &&
    (groupedAreas.byAreaId.some((grp) => filterCatList(grp.categories).length > 0) ||
      filterCatList(groupedAreas.uncategorizedCats).length > 0);

  const typedNewCategoryFallback =
    normalizedCategoryInput !== '' &&
    formData.category.trim() !== '' &&
    !anyDbCategoryMatchesSearch &&
    suggestionNamesShown.length === 0;

  return (
    <>
      {/* Transaction modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-8">
          <h2 className="mb-6 text-xl font-headline font-bold">
            {editingId ? 'Editar transacción' : 'Nueva transacción'}
          </h2>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            {/* Date picker trigger */}
            <div>
              <label className="mb-1 block text-sm font-medium text-on-surface-variant">Fecha</label>
              <button
                type="button"
                onClick={openDateModal}
                className="flex w-full items-center justify-between rounded-xl bg-surface-container-low px-4 py-3 text-left transition-colors hover:bg-surface-container"
              >
                <span className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-on-surface-variant">calendar_month</span>
                  <span className="font-medium text-on-surface">
                    {format(displayDateParsed(), "d 'de' MMMM yyyy", { locale: es })}
                  </span>
                </span>
                <span className="material-symbols-outlined text-on-surface-variant">edit_calendar</span>
              </button>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-on-surface-variant">Descripción</label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full rounded-lg border-none bg-surface-container-low px-4 py-3"
                placeholder="¿En qué se gastó?"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-on-surface-variant">Monto</label>
              <input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className="w-full rounded-lg border-none bg-surface-container-low px-4 py-3"
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-on-surface-variant">Tipo</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    value: 'debit' as const,
                    label: 'Débito',
                    description: 'Egreso',
                    icon: 'south_west',
                    activeClassName: 'border-rose-200 bg-rose-50 text-rose-700 ring-rose-200',
                  },
                  {
                    value: 'credit' as const,
                    label: 'Crédito',
                    description: 'Ingreso',
                    icon: 'north_east',
                    activeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700 ring-emerald-200',
                  },
                ].map((option) => {
                  const isActive = formData.type === option.value;

                  return (
                    <label
                      key={option.value}
                      className={`relative flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 ring-1 ring-inset transition-colors ${
                        isActive
                          ? option.activeClassName
                          : 'border-surface-container bg-surface-container-low text-on-surface-variant ring-transparent hover:bg-surface-container'
                      }`}
                    >
                      <input
                        type="radio"
                        name="type"
                        value={option.value}
                        checked={isActive}
                        onChange={(e) =>
                          setFormData({ ...formData, type: e.target.value as 'debit' | 'credit' })
                        }
                        className="sr-only"
                      />
                      <span className="material-symbols-outlined">{option.icon}</span>
                      <span className="flex flex-col">
                        <span className="font-semibold">{option.label}</span>
                        <span className="text-xs opacity-70">{option.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-on-surface-variant">Categoría</label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                  <span className="material-symbols-outlined text-on-surface-variant">
                    {getCategoryDisplay(formData.category).icon}
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
                  placeholder="Buscar o crear categoría"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onClick={() => setShowCategorySuggestions((current) => !current)}
                  className="absolute inset-y-0 right-0 flex items-center px-4 text-on-surface-variant"
                  aria-label="Opciones de categoría"
                >
                  <span className="material-symbols-outlined">
                    {showCategorySuggestions ? 'expand_less' : 'expand_more'}
                  </span>
                </button>
                {showCategorySuggestions ? (
                  <div className="absolute z-[55] mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-surface-container bg-surface-container-lowest p-2 shadow-xl">
                    <div className="space-y-2">
                      {/* All areas — each lists its categories */}
                      {groupedAreas.byAreaId.map(({ area, categories: areaCats }) => {
                        const section = renderAreaSection(
                          area.name,
                          areaCats,
                          area.icon || 'category',
                          area.color || null
                        );
                        return section !== null ? <Fragment key={`area-${area.id}`}>{section}</Fragment> : null;
                      })}

                      {renderAreaSection(
                        'Sin área',
                        groupedAreas.uncategorizedCats,
                        'help_outline',
                        '#9ca3af'
                      )}

                      {/* Predefined suggestions not in DB */}
                      {suggestionNamesShown.length > 0 ? (
                        <div className="rounded-lg border border-surface-container bg-surface-container-lowest/40 p-1">
                          <div className="px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                            Sugeridas
                          </div>
                          <div className="space-y-0.5 pb-1 pl-1">
                            {suggestionNamesShown.map((name) => (
                              <div key={`sug-${normalizeCategory(name)}`}>
                                {renderCategoryPickRow(name, 'Categoría sugerida')}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {typedNewCategoryFallback ? (
                        <div className="px-3 py-3 text-sm text-on-surface-variant">
                          Sin coincidencias. Al guardar se creará "{formData.category}".
                        </div>
                      ) : null}

                      {normalizedCategoryInput &&
                      !typedNewCategoryFallback &&
                      !anyDbCategoryMatchesSearch &&
                      suggestionNamesShown.length === 0 ? (
                        <div className="px-3 py-3 text-sm text-on-surface-variant">
                          No hay categorías que coincidan. Seguí escribiendo para crear una nueva.
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-on-surface-variant">
                {selectedCategoryIsPreset
                  ? 'Categoría existente elegida. Podés seguir escribiendo para cambiar o crear una nueva.'
                  : 'Filtrá por nombre o guardá para crear una categoría nueva con el texto ingresado.'}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-on-surface-variant">Titular</label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                  <span className="material-symbols-outlined text-on-surface-variant">person</span>
                </div>
                <input
                  type="text"
                  value={formData.owner}
                  onChange={(e) => setFormData({ ...formData, owner: e.target.value })}
                  className="w-full rounded-lg border-none bg-surface-container-low py-3 pl-14 pr-4"
                  placeholder="¿Quién realizó este movimiento?"
                />
              </div>
              <p className="mt-2 text-xs text-on-surface-variant">
                Nombre de la persona responsable del movimiento.
              </p>
            </div>

            {!editingId ? (
              <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-surface-container-low px-3 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-surface-container"
                  checked={createAnotherAfterSave}
                  onChange={(e) => setCreateAnotherAfterSave(e.target.checked)}
                />
                <span className="text-sm font-medium text-on-surface">
                  Crear otra transacción (mantener fecha y titular)
                </span>
              </label>
            ) : null}

            <div className="flex gap-4 pt-4">
              <button
                type="button"
                onClick={() => {
                  setCreateAnotherAfterSave(false);
                  onClose();
                }}
                className="flex-1 rounded-xl border border-surface-container py-3 font-medium hover:bg-surface-container-low"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 rounded-xl bg-primary-container py-3 font-bold text-white hover:opacity-90 disabled:opacity-50"
              >
                {editingId ? 'Guardar cambios' : 'Crear'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Date submodal */}
      {showDateModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-2xl bg-surface-container-lowest p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-headline font-bold">Elegir fecha</h3>
            <input
              type="date"
              value={pendingDateStr || formData.date}
              onChange={(e) => setPendingDateStr(e.target.value)}
              className="mb-6 w-full rounded-xl bg-surface-container-low px-4 py-3"
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={cancelDateModal}
                className="flex-1 rounded-xl border border-surface-container py-3 font-medium hover:bg-surface-container-low"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={applyDateModal}
                className="flex-1 rounded-xl bg-primary-container py-3 font-bold text-white hover:opacity-90"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
