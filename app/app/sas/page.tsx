import Nav from '@/components/Nav';
import ListingCard from '@/components/ListingCard';
import { EmptyState } from '@/components/Ui';
import { getLastRun, getListings, getPriceChanges, daysAgo } from '@/lib/listings';

export const dynamic = 'force-dynamic';
export const metadata = { title: "Sas d'attente · ImmoBrest" };

export default async function SasPage() {
  const [sas, changes, lastRun] = await Promise.all([getListings('sas'), getPriceChanges(), getLastRun()]);
  // Les mieux notées d'abord : ce sont celles qu'on veut trancher en premier.
  sas.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));

  return (
    <>
      <Nav current="/sas" />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sas d&apos;attente</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {sas.length > 0 ? `${sas.length} annonce${sas.length > 1 ? 's' : ''} à valider` : 'Tout est à jour'} · dernier relevé {daysAgo(lastRun)}
          </p>
        </div>

        {sas.length === 0 ? (
          <EmptyState title="Rien à valider pour le moment" hint="Les nouvelles annonces apparaissent ici après chaque relevé quotidien." />
        ) : (
          sas.map(listing => <ListingCard key={listing.id} listing={listing} change={changes.get(listing.id)} actions="sas" detailed />)
        )}
      </main>
    </>
  );
}
