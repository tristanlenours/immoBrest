import Nav from '@/components/Nav';
import { ListingList } from '@/components/ListingList';
import { getListings, getPriceChanges } from '@/lib/listings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Corbeille · ImmoBrest' };

export default async function CorbeillePage() {
  const [rejected, changes] = await Promise.all([getListings('rejected'), getPriceChanges()]);
  // Les annonces à vrai lien d'origine (hors doublons Castorus sans lien) et les mieux notées en premier.
  const list = rejected.filter(l => l.url).sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));

  return (
    <>
      <Nav current="/corbeille" />
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Corbeille</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {list.length} annonce{list.length > 1 ? 's' : ''} rejetée{list.length > 1 ? 's' : ''}. Elles ne reviennent jamais dans le sas, sauf si tu les y remets ici.
          </p>
        </div>
        <ListingList listings={list} changes={changes} emptyTitle="La corbeille est vide" actions="trash" />
      </main>
    </>
  );
}
