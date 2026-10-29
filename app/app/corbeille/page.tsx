import Nav from '@/components/Nav';
import { ListingList } from '@/components/ListingList';
import { getListings, getPriceChanges } from '@/lib/listings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Corbeille · ImmoBrest' };

// Motif posé par le scoring sur les annonces arrivées dans le sas avec une note ≤ 5.
const LOW_SCORE_REASON = 'NOTE ≤ 5';

export default async function CorbeillePage() {
  const [rejected, changes] = await Promise.all([getListings('rejected'), getPriceChanges()]);
  // Les annonces à vrai lien d'origine (hors doublons Castorus sans lien) et les mieux notées en premier.
  const list = rejected.filter(l => l.url).sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
  const lowScore = list.filter(l => l.decided_by === 'auto' && (l.reject_reason || '').startsWith(LOW_SCORE_REASON));
  const others = list.filter(l => !lowScore.includes(l));

  return (
    <>
      <Nav current="/corbeille" />
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Corbeille</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Les annonces de la corbeille ne reviennent jamais dans le sas, sauf si tu les y remets ici.
          </p>
        </div>

        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Écartées d&apos;office · {lowScore.length}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Arrivées dans le sas avec une note de 5 ou moins. Vérifie les critères qui les pénalisent ; remise dans le sas, une
              annonce n&apos;est plus écartée automatiquement. Elles sont supprimées quand elles ne sont plus vues en ligne depuis 14 jours.
            </p>
          </div>
          <ListingList listings={lowScore} changes={changes} emptyTitle="Aucune annonce écartée d'office" actions="trash" />
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Rejetées · {others.length}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Rejetées à la main, ou hors critères (sans quartier, colocation).</p>
          </div>
          <ListingList listings={others} changes={changes} emptyTitle="Aucune annonce rejetée" actions="trash" />
        </section>
      </main>
    </>
  );
}
