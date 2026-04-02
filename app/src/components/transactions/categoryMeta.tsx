const DEFAULT_CATEGORY_META = {
  icon: 'category',
  badgeClassName: 'bg-slate-100 text-slate-700 ring-slate-200',
  tileClassName: 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300',
};

const CATEGORY_META = {
  comida: {
    icon: 'restaurant',
    badgeClassName: 'bg-orange-100 text-orange-700 ring-orange-200',
    tileClassName: 'bg-orange-50 text-orange-700 border-orange-200 hover:border-orange-300',
  },
  inversiones: {
    icon: 'trending_up',
    badgeClassName: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    tileClassName: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:border-emerald-300',
  },
  internet: {
    icon: 'wifi',
    badgeClassName: 'bg-sky-100 text-sky-700 ring-sky-200',
    tileClassName: 'bg-sky-50 text-sky-700 border-sky-200 hover:border-sky-300',
  },
  taxi: {
    icon: 'local_taxi',
    badgeClassName: 'bg-amber-100 text-amber-800 ring-amber-200',
    tileClassName: 'bg-amber-50 text-amber-800 border-amber-200 hover:border-amber-300',
  },
  subscripciones: {
    icon: 'subscriptions',
    badgeClassName: 'bg-violet-100 text-violet-700 ring-violet-200',
    tileClassName: 'bg-violet-50 text-violet-700 border-violet-200 hover:border-violet-300',
  },
  banco: {
    icon: 'account_balance',
    badgeClassName: 'bg-blue-100 text-blue-700 ring-blue-200',
    tileClassName: 'bg-blue-50 text-blue-700 border-blue-200 hover:border-blue-300',
  },
  'restaurante, comida rapida': {
    icon: 'lunch_dining',
    badgeClassName: 'bg-rose-100 text-rose-700 ring-rose-200',
    tileClassName: 'bg-rose-50 text-rose-700 border-rose-200 hover:border-rose-300',
  },
  'gastos financieros': {
    icon: 'payments',
    badgeClassName: 'bg-indigo-100 text-indigo-700 ring-indigo-200',
    tileClassName: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:border-indigo-300',
  },
  otro: {
    icon: 'category',
    badgeClassName: 'bg-stone-100 text-stone-700 ring-stone-200',
    tileClassName: 'bg-stone-50 text-stone-700 border-stone-200 hover:border-stone-300',
  },
  'deporte, fitness': {
    icon: 'fitness_center',
    badgeClassName: 'bg-red-100 text-red-700 ring-red-200',
    tileClassName: 'bg-red-50 text-red-700 border-red-200 hover:border-red-300',
  },
  supermercados: {
    icon: 'shopping_cart',
    badgeClassName: 'bg-lime-100 text-lime-800 ring-lime-200',
    tileClassName: 'bg-lime-50 text-lime-800 border-lime-200 hover:border-lime-300',
  },
  'mascotas, animales': {
    icon: 'pets',
    badgeClassName: 'bg-pink-100 text-pink-700 ring-pink-200',
    tileClassName: 'bg-pink-50 text-pink-700 border-pink-200 hover:border-pink-300',
  },
  'bar, cafe': {
    icon: 'local_cafe',
    badgeClassName: 'bg-yellow-100 text-yellow-800 ring-yellow-200',
    tileClassName: 'bg-yellow-50 text-yellow-800 border-yellow-200 hover:border-yellow-300',
  },
  falta: {
    icon: 'error',
    badgeClassName: 'bg-red-100 text-red-800 ring-red-200',
    tileClassName: 'bg-red-50 text-red-800 border-red-200 hover:border-red-300',
  },
  ro: {
    icon: 'receipt_long',
    badgeClassName: 'bg-cyan-100 text-cyan-700 ring-cyan-200',
    tileClassName: 'bg-cyan-50 text-cyan-700 border-cyan-200 hover:border-cyan-300',
  },
  'tiempo libre': {
    icon: 'sports_esports',
    badgeClassName: 'bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-200',
    tileClassName: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 hover:border-fuchsia-300',
  },
  servicios: {
    icon: 'home_repair_service',
    badgeClassName: 'bg-teal-100 text-teal-700 ring-teal-200',
    tileClassName: 'bg-teal-50 text-teal-700 border-teal-200 hover:border-teal-300',
  },
  transporte: {
    icon: 'directions_bus',
    badgeClassName: 'bg-cyan-100 text-cyan-800 ring-cyan-200',
    tileClassName: 'bg-cyan-50 text-cyan-800 border-cyan-200 hover:border-cyan-300',
  },
  'casa y jardin': {
    icon: 'yard',
    badgeClassName: 'bg-green-100 text-green-700 ring-green-200',
    tileClassName: 'bg-green-50 text-green-700 border-green-200 hover:border-green-300',
  },
  'farmacia y drogueria': {
    icon: 'local_pharmacy',
    badgeClassName: 'bg-purple-100 text-purple-700 ring-purple-200',
    tileClassName: 'bg-purple-50 text-purple-700 border-purple-200 hover:border-purple-300',
  },
} as const;

export const PREDEFINED_CATEGORIES = [
  'comida',
  'inversiones',
  'internet',
  'taxi',
  'subscripciones',
  'Banco',
  'Restaurante, comida rapida',
  'Gastos financieros',
  'Otro',
  'Deporte, Fitness',
  'Supermercados',
  'Mascotas, Animales',
  'Bar, Cafe',
  'Falta',
  'Ro',
  'Tiempo libre',
  'Servicios',
  'Transporte',
  'Casa y Jardin',
  'Farmacia y Drogueria',
] as const;

export function normalizeCategory(category: string | null | undefined): string {
  return (category || '').trim().toLowerCase();
}

export function getCategoryMeta(category: string | null | undefined) {
  const normalized = normalizeCategory(category) as keyof typeof CATEGORY_META;
  return CATEGORY_META[normalized] || DEFAULT_CATEGORY_META;
}

export function isPredefinedCategory(category: string | null | undefined): boolean {
  return normalizeCategory(category) in CATEGORY_META;
}
