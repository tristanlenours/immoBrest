import Link from 'next/link';
import { formatRunDate, type SourceStatus } from '@/lib/runs';

const STALE_MS = 2 * 86_400_000;

function describe(s: SourceStatus): { text: string; warn: boolean } {
  if (s.paused) return { text: 'en pause', warn: false };
  if (!s.run) return { text: 'aucun relevé', warn: true };
  if (s.run.status === 'error') return { text: 'en échec', warn: true };
  if (s.run.status === 'empty') return { text: 'aucune annonce lue', warn: true };
  const stale = Date.now() - new Date(s.run.finished_at).getTime() > STALE_MS;
  return { text: `${s.run.found} annonce${s.run.found > 1 ? 's' : ''} retenue${s.run.found > 1 ? 's' : ''}`, warn: stale };
}

// Dernier passage de chaque source, sur l'accueil et en tête de la page des relevés.
export default function SourceStatusList({ sources, link = false }: { sources: SourceStatus[]; link?: boolean }) {
  return (
    <section className="card p-4" aria-label="Derniers relevés par source">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Derniers relevés</h2>
        {link && (
          <Link href="/releves" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-100">
            Voir le détail
          </Link>
        )}
      </div>
      <ul className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {sources.map(s => {
          const { text, warn } = describe(s);
          const inner = (
            <>
              <span className="block text-sm font-medium">{s.label}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {s.run ? formatRunDate(s.run.finished_at) : '—'}
                {' · '}
                <span className={warn ? 'font-medium text-amber-700 dark:text-amber-300' : undefined}>{text}</span>
              </span>
            </>
          );
          return <li key={s.key}>{s.run ? <Link href={`/releves/${s.run.runId}`} className="block hover:underline">{inner}</Link> : inner}</li>;
        })}
      </ul>
    </section>
  );
}
