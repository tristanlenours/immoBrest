import Link from 'next/link';
import { formatEuro, pricePerM2, summarizeCriteria, daysAgo, type Listing } from '@/lib/listings';
import { PriceDrop, QuartierBadge, ScoreBadge, SourceBadge, Pill } from './Ui';
import DecisionButtons from './DecisionButtons';

type Props = {
  listing: Listing;
  change?: { first: number; last: number };
  // 'sas' : boutons Accepter/Rejeter et description ; 'trash' : bouton de remise dans le sas ; 'none' : lecture seule
  actions?: 'sas' | 'trash' | 'none';
  detailed?: boolean;
};

export default function ListingCard({ listing: l, change, actions = 'none', detailed = false }: Props) {
  const m2 = pricePerM2(l);
  const { positives, negatives } = summarizeCriteria(l.score_criteria);
  const facts = [
    l.type,
    l.surface ? `${Number(l.surface)} m²` : null,
    l.pieces ? `${l.pieces} pièces` : null,
    l.chambres ? `${l.chambres} ch.` : null,
    l.floor && l.floor !== 'Non spécifié' ? `étage ${l.floor}` : null
  ].filter(Boolean);

  return (
    <article key={l.id} className="card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <SourceBadge source={l.source} />
            <QuartierBadge quartier={l.quartier} tier={l.tier} />
            <span className="text-xs text-slate-500 dark:text-slate-400">vue {daysAgo(l.first_seen_at)}</span>
          </div>
          <h2 className="mt-2 text-base font-semibold leading-snug sm:text-lg">
            <Link href={`/annonces/${encodeURIComponent(l.id)}`} className="hover:text-brand-600">
              {l.title}
            </Link>
          </h2>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{facts.join(' · ')}</p>
        </div>
        <ScoreBadge score={l.score} />
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-2xl font-bold tracking-tight">{formatEuro(l.price)}</p>
        {m2 && <p className="text-sm text-slate-500 dark:text-slate-400">{m2.toLocaleString('fr-FR')}&nbsp;€/m²</p>}
        <PriceDrop first={change?.first} last={change?.last} />
      </div>

      {(positives.length > 0 || negatives.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {positives.map(p => (
            <Pill key={p} tone="good">{p}</Pill>
          ))}
          {negatives.map(n => (
            <Pill key={n} tone="bad">{n}</Pill>
          ))}
        </div>
      )}

      {l.reject_reason && actions === 'trash' && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Motif : {l.reject_reason}</p>
      )}

      {detailed && l.description && (
        <details className="mt-3 text-sm text-slate-700 dark:text-slate-300">
          <summary className="cursor-pointer select-none font-medium text-brand-700 dark:text-brand-100">Lire la description</summary>
          <p className="mt-2 whitespace-pre-line leading-relaxed">{l.description}</p>
        </details>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {l.url && (
          <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 hover:underline dark:text-brand-100">
            Voir l&apos;annonce ↗
          </a>
        )}
        {l.additional_links.map(link => (
          <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:underline dark:text-slate-400">
            {link.source} ↗
          </a>
        ))}
        <Link href={`/annonces/${encodeURIComponent(l.id)}`} className="text-slate-600 hover:underline dark:text-slate-400">
          Détails & comparaison DVF
        </Link>
      </div>

      {actions !== 'none' && (
        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
          {/* key = identifiant : sans lui, React réutilise l'état « Rejetée » d'une carte retirée pour la suivante. */}
          <DecisionButtons key={l.id} id={l.id} mode={actions} />
        </div>
      )}
    </article>
  );
}
