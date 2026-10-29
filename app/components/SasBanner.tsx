import Link from 'next/link';
import { formatEuro, headline, type Listing } from '@/lib/listings';
import { ScoreBadge } from './Ui';
import ListingPhoto from './ListingPhoto';

// Bandeau des nouvelles annonces en attente : un aperçu des mieux notées et un lien vers le sas pour trancher.
export default function SasBanner({ pending }: { pending: Listing[] }) {
  if (pending.length === 0) return null;
  const preview = [...pending].sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0)).slice(0, 3);
  const plural = pending.length > 1;

  return (
    <section className="card border-brand-500/40 bg-brand-50 p-4 dark:border-brand-500/40 dark:bg-brand-700/10" aria-label="Nouvelles annonces à valider">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold">
          <span aria-hidden="true">🔔 </span>
          {pending.length} nouvelle{plural ? 's' : ''} annonce{plural ? 's' : ''} à valider
          <span className="block text-sm font-normal text-slate-600 dark:text-slate-300">
            Ajoute{plural ? '-les' : '-la'} aux annonces actives ou écarte{plural ? '-les' : '-la'} depuis le sas.
          </span>
        </p>
        <Link href="/sas" className="btn bg-brand-600 text-white hover:bg-brand-700">
          Ouvrir le sas →
        </Link>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-3">
        {preview.map(l => {
          const title = headline(l);
          return (
            <li key={l.id}>
              <Link
                href={`/annonces/${encodeURIComponent(l.id)}`}
                className="flex items-center gap-3 rounded-xl bg-white p-2 shadow-sm hover:ring-2 hover:ring-brand-500/40 dark:bg-slate-900"
              >
                <ListingPhoto
                  src={l.photos?.[0]}
                  alt={l.title}
                  isHouse={(l.type || '').toLowerCase().includes('maison')}
                  className="h-14 w-14 shrink-0 rounded-lg"
                />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-semibold">{title.main}</span>
                  <span className="block truncate text-slate-500 dark:text-slate-400">
                    {[title.place, formatEuro(l.price)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <ScoreBadge score={l.score} size="sm" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
