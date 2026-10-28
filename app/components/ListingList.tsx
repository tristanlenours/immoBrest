import ListingCard from './ListingCard';
import { EmptyState } from './Ui';
import { pricePerM2, type Listing } from '@/lib/listings';

export type Filters = {
  q?: string;
  type?: string;
  quartier?: string;
  minScore?: string;
  maxPrice?: string;
  sort?: string;
};

const SORTS: Record<string, { label: string; value: (l: Listing) => number }> = {
  score: { label: 'Score', value: l => Number(l.score ?? 0) },
  price: { label: 'Prix', value: l => l.price ?? Infinity },
  m2: { label: 'Prix au m²', value: l => pricePerM2(l) ?? Infinity },
  surface: { label: 'Surface', value: l => Number(l.surface ?? 0) },
  date: { label: 'Date de sortie', value: l => (l.last_seen_at ? new Date(l.last_seen_at).getTime() : 0) }
};

const ASCENDING = new Set(['price', 'm2']);

export function applyFilters(listings: Listing[], f: Filters): Listing[] {
  const q = f.q?.trim().toLowerCase();
  const minScore = f.minScore ? Number(f.minScore) : 0;
  const maxPrice = f.maxPrice ? Number(f.maxPrice) : Infinity;
  const sortKey = f.sort && SORTS[f.sort] ? f.sort : 'score';
  const { value } = SORTS[sortKey];

  return listings
    .filter(l => !f.type || (l.type || '').toLowerCase() === f.type.toLowerCase())
    .filter(l => !f.quartier || l.quartier === f.quartier)
    .filter(l => Number(l.score ?? 0) >= minScore)
    .filter(l => !l.price || l.price <= maxPrice)
    .filter(l => !q || `${l.title} ${l.description ?? ''} ${l.location ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => (ASCENDING.has(sortKey) ? value(a) - value(b) : value(b) - value(a)));
}

export function FilterBar({ filters, quartiers, action }: { filters: Filters; quartiers: string[]; action: string }) {
  return (
    <form action={action} method="get" className="card grid grid-cols-2 gap-3 p-4 sm:grid-cols-6">
      <input name="q" defaultValue={filters.q} placeholder="Rechercher…" className="input col-span-2 sm:col-span-6" aria-label="Rechercher" />
      <select name="type" defaultValue={filters.type ?? ''} className="input" aria-label="Type de bien">
        <option value="">Tous types</option>
        <option value="Appartement">Appartement</option>
        <option value="Maison">Maison</option>
      </select>
      <select name="quartier" defaultValue={filters.quartier ?? ''} className="input" aria-label="Quartier">
        <option value="">Tous quartiers</option>
        {quartiers.map(q => (
          <option key={q} value={q}>
            {q}
          </option>
        ))}
      </select>
      <select name="minScore" defaultValue={filters.minScore ?? ''} className="input" aria-label="Score minimum">
        <option value="">Score min.</option>
        {[3, 4, 5, 6, 7].map(s => (
          <option key={s} value={s}>
            ≥ {s}
          </option>
        ))}
      </select>
      <input name="maxPrice" type="number" step="10000" min="0" defaultValue={filters.maxPrice} placeholder="Prix max €" className="input" aria-label="Prix maximum" />
      <select name="sort" defaultValue={filters.sort ?? 'score'} className="input" aria-label="Tri">
        {Object.entries(SORTS).map(([key, s]) => (
          <option key={key} value={key}>
            Tri : {s.label}
          </option>
        ))}
      </select>
      <button type="submit" className="btn bg-brand-600 text-white hover:bg-brand-700">
        Filtrer
      </button>
    </form>
  );
}

export function ListingList({
  listings,
  changes,
  emptyTitle,
  actions = 'none'
}: {
  listings: Listing[];
  changes: Map<string, { first: number; last: number }>;
  emptyTitle: string;
  actions?: 'none' | 'trash';
}) {
  if (listings.length === 0) return <EmptyState title={emptyTitle} hint="Essaie d'élargir les filtres." />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {listings.map(l => (
        <ListingCard key={l.id} listing={l} change={changes.get(l.id)} actions={actions} />
      ))}
    </div>
  );
}
