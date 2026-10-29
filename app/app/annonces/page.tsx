import Nav from '@/components/Nav';
import SasBanner from '@/components/SasBanner';
import { applyFilters, FilterBar, ListingList, type Filters } from '@/components/ListingList';
import { getListings, getPriceChanges, isOnline } from '@/lib/listings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Annonces · ImmoBrest' };

export default async function AnnoncesPage({ searchParams }: { searchParams: Filters }) {
  const [approved, pending, changes] = await Promise.all([getListings('approved'), getListings('sas'), getPriceChanges()]);
  const online = approved.filter(isOnline);
  const quartiers = [...new Set(online.map(l => l.quartier).filter((q): q is string => !!q))].sort();
  const filtered = applyFilters(online, searchParams);

  return (
    <>
      <Nav current="/annonces" />
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <SasBanner pending={pending} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Annonces</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {filtered.length} sur {online.length} annonces en ligne
          </p>
        </div>
        <FilterBar filters={searchParams} quartiers={quartiers} action="/annonces" />
        <ListingList listings={filtered} changes={changes} emptyTitle="Aucune annonce ne correspond" />
      </main>
    </>
  );
}
