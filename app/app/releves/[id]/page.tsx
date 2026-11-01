import Link from 'next/link';
import { notFound } from 'next/navigation';
import Nav from '@/components/Nav';
import { formatEuro } from '@/lib/listings';
import { formatRunDate, getRun, runDuration, sourceLabel, type RunEvent, type RunEventType } from '@/lib/runs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Relevé · ImmoBrest' };

// Ordre d'affichage : ce qui a changé d'abord, le reste replié.
const GROUPS: { type: RunEventType; title: string; hint: string; open?: boolean }[] = [
  { type: 'warning', title: 'Problèmes', hint: 'Une étape a échoué sur cette annonce.', open: true },
  { type: 'new', title: 'Nouvelles annonces', hint: 'Jamais vues, placées dans le sas.', open: true },
  { type: 'price', title: 'Prix modifiés', hint: 'Différents du passage précédent.', open: true },
  { type: 'sold', title: 'Passées en vendues', hint: 'Disparues, page 404 ou bandeau sur la photo.', open: true },
  { type: 'rejected', title: 'Écartées par le scoring', hint: 'Note de 5 ou moins, sans quartier ou colocation.', open: true },
  { type: 'purged', title: 'Supprimées', hint: 'Écartées et plus vues en ligne depuis 14 jours.', open: true },
  { type: 'updated', title: 'Mises à jour', hint: 'Même prix, mais description ou photos complétées.', open: true },
  { type: 'score', title: 'Notes modifiées', hint: 'Note recalculée par le scoring.', open: true },
  { type: 'enriched', title: 'Enrichies', hint: 'Photos, analyse IA ou titre.' },
  { type: 'missing', title: 'Actives non revues', hint: 'Absentes de ce relevé, pas encore considérées vendues.' },
  { type: 'filtered', title: 'Refusées par les filtres', hint: 'Lues sur le site mais hors critères, non enregistrées.' },
  { type: 'trashed', title: 'Déjà en corbeille', hint: 'Revues en ligne, non reproposées.' },
  { type: 'duplicate', title: 'Doublons', hint: 'Même bien publié sur plusieurs sites.' },
  { type: 'unchanged', title: 'Sans changement', hint: 'Revues en ligne, rien de nouveau.' }
];

function EventRow({ event: e }: { event: RunEvent }) {
  return (
    <li className="py-2">
      <p className="text-sm font-medium">
        {e.id ? (
          <Link href={`/annonces/${encodeURIComponent(e.id)}`} className="hover:text-brand-600">
            {e.title || e.id}
          </Link>
        ) : (
          e.title || 'Annonce sans titre'
        )}
      </p>
      <p className="text-sm text-slate-700 dark:text-slate-300">{e.detail}</p>
      <p className="flex flex-wrap gap-x-3 text-xs text-slate-500 dark:text-slate-400">
        <span>{e.source}</span>
        {e.price ? <span>{formatEuro(e.price)}</span> : null}
        {e.url && (
          <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
            Voir l&apos;annonce ↗
          </a>
        )}
      </p>
    </li>
  );
}

export default async function RelevePage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const run = Number.isInteger(id) ? await getRun(id) : null;
  if (!run) notFound();

  const { stats } = run;
  const events = stats.events ?? [];
  const sourceRuns = Object.entries(stats.foundBySource ?? {});

  return (
    <>
      <Nav current="/releves" />
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <Link href="/releves" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
          ← Retour aux relevés
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Relevé du {formatRunDate(run.started_at)}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Terminé le {formatRunDate(run.finished_at)} · durée {runDuration(run)}
          </p>
        </div>

        {run.status === 'running' && (
          <p className="card p-4 text-sm text-amber-700 dark:text-amber-300">Ce relevé ne s&apos;est pas terminé : il est en cours, ou a été interrompu.</p>
        )}
        {run.error && <p className="card p-4 text-sm text-red-700 dark:text-red-300">{run.error}</p>}

        {sourceRuns.length > 0 && (
          <section className="card p-4">
            <h2 className="text-sm font-semibold">Annonces retenues par source</h2>
            <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {sourceRuns.map(([key, found]) => (
                <li key={key}>
                  {sourceLabel(key)} : {found}
                  {found === 0 && <span className="text-amber-700 dark:text-amber-300"> (source ignorée pour la détection des ventes)</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {events.length === 0 ? (
          <p className="card p-4 text-sm text-slate-500 dark:text-slate-400">
            Le détail annonce par annonce n&apos;existe que pour les relevés lancés depuis la mise en place de la piste d&apos;audit.
          </p>
        ) : (
          GROUPS.map(group => {
            const items = events.filter(e => e.type === group.type);
            if (items.length === 0) return null;
            return (
              <details key={group.type} open={group.open} className="card p-4">
                <summary className="cursor-pointer select-none">
                  <span className="font-semibold">
                    {group.title} · {items.length}
                  </span>
                  <span className="block text-sm text-slate-500 dark:text-slate-400">{group.hint}</span>
                </summary>
                <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((event, i) => (
                    <EventRow key={`${event.url ?? event.title}-${i}`} event={event} />
                  ))}
                </ul>
              </details>
            );
          })
        )}
      </main>
    </>
  );
}
