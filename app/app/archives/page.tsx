import Nav from '@/components/Nav';
import { applyFilters, FilterBar, ListingList, type Filters } from '@/components/ListingList';
import { getListings, getPriceChanges, isOnline } from '@/lib/listings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Archives · ImmoBrest' };

export default async function ArchivesPage({ searchParams }: { searchParams: Filters }) {
  const [approved, changes] = await Promise.all([getListings('approved'), getPriceChanges()]);
  const archived = approved.filter(l => !isOnline(l));
  const quartiers = [...new Set(archived.map(l => l.quartier).filter((q): q is string => !!q))].sort();
  // Les plus récemment sorties du marché d'abord, sauf tri demandé.
  const filtered = applyFilters(archived, { sort: 'date', ...searchParams });

  return (
    <>
      <Nav current="/archives" />
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Archives &amp; vendus</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {filtered.length} bien{filtered.length > 1 ? 's' : ''} vendu{filtered.length > 1 ? 's' : ''} ou retiré{filtered.length > 1 ? 's' : ''} de la vente
          </p>
        </div>
        <FilterBar filters={{ sort: 'date', ...searchParams }} quartiers={quartiers} action="/archives" />
        <ListingList listings={filtered} changes={changes} emptyTitle="Aucune annonce archivée" />
      </main>
    </>
  );
}
