import Link from 'next/link';
import Nav from '@/components/Nav';
import SourceStatusList from '@/components/SourceStatusList';
import { formatRunDate, getRuns, runDuration, sourceLabel, sourceStatuses, type Run } from '@/lib/runs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Relevés · ImmoBrest' };

const STATUS: Record<Run['status'], { label: string; className: string }> = {
  success: { label: 'Réussi', className: 'text-emerald-700 dark:text-emerald-300' },
  error: { label: 'Erreurs', className: 'text-red-700 dark:text-red-300' },
  running: { label: 'Non terminé', className: 'text-amber-700 dark:text-amber-300' }
};

function summary(run: Run): string {
  if (run.status === 'running') return 'En cours ou interrompu';
  const s = run.stats;
  const parts = [
    s.new ? `${s.new} nouvelle${s.new > 1 ? 's' : ''}` : null,
    s.priceChanged ? `${s.priceChanged} prix modifié${s.priceChanged > 1 ? 's' : ''}` : null,
    s.markedSold ? `${s.markedSold} vendue${s.markedSold > 1 ? 's' : ''}` : null,
    s.rejected ? `${s.rejected} écartée${s.rejected > 1 ? 's' : ''}` : null,
    s.purged ? `${s.purged} supprimée${s.purged > 1 ? 's' : ''}` : null,
    s.unchanged ? `${s.unchanged} sans changement` : null
  ].filter(Boolean);
  return parts.join(' · ') || 'Aucun changement';
}

export default async function RelevesPage() {
  const runs = await getRuns();

  return (
    <>
      <Nav current="/releves" />
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Relevés</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Chaque passage sur les sites, et ce qu&apos;il a changé.</p>
        </div>
        <SourceStatusList sources={sourceStatuses(runs)} />
        <ul className="card divide-y divide-slate-100 dark:divide-slate-800">
          {runs.map(run => (
            <li key={run.id}>
              <Link href={`/releves/${run.id}`} className="block px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">{formatRunDate(run.started_at)}</span>
                  <span className={`text-sm font-medium ${STATUS[run.status].className}`}>{STATUS[run.status].label}</span>
                </span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">
                  {(run.stats.sources || []).map(sourceLabel).join(', ') || run.pipeline} · {runDuration(run)}
                </span>
                <span className="block text-sm text-slate-700 dark:text-slate-300">{summary(run)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
