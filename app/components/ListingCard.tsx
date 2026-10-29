import Link from 'next/link';
import { formatEuro, formatShortDate, daysAgo, headline, pricePerM2, seenInfo, summarizeCriteria, isOnline, type Listing } from '@/lib/listings';
import { CriteriaPills, PriceDrop, ScoreBadge, SourceBadge } from './Ui';
import DecisionButtons from './DecisionButtons';
import ListingPhoto from './ListingPhoto';

type Props = {
  listing: Listing;
  change?: { first: number; last: number };
  // 'sas' : boutons Accepter/Rejeter et description ; 'trash' : bouton de remise dans le sas ; 'none' : lecture seule
  actions?: 'sas' | 'trash' | 'none';
  detailed?: boolean;
};

const TIER_STYLES: Record<number, string> = {
  1: 'text-emerald-700 dark:text-emerald-300',
  2: 'text-amber-700 dark:text-amber-300'
};

export default function ListingCard({ listing: l, change, actions = 'none', detailed = false }: Props) {
  const href = `/annonces/${encodeURIComponent(l.id)}`;
  const m2 = pricePerM2(l);
  const criteria = summarizeCriteria(l.score_criteria, (l.type || '').toLowerCase().includes('maison'));
  const title = headline(l);
  const seen = seenInfo(l);
  const photos = l.photos ?? [];
  const isHouse = (l.type || '').toLowerCase().includes('maison');
  const facts = [
    l.pieces ? `${l.pieces} pièces` : null,
    l.chambres ? `${l.chambres} ch.` : null,
    l.floor && l.floor !== 'Non spécifié' ? `étage ${l.floor}` : null
  ].filter(Boolean);

  return (
    <article className="card flex flex-col overflow-hidden">
      <Link href={href} className="relative block aspect-[16/9] bg-slate-100 dark:bg-slate-800" aria-label={`Voir la fiche : ${l.title}`}>
        <ListingPhoto src={photos[0]} alt={l.title} isHouse={isHouse} className="h-full w-full" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <SourceBadge source={l.source} />
          {!isOnline(l) && <span className="chip bg-slate-900/80 text-white">{l.market_status}</span>}
        </div>
        <div className="absolute right-3 top-3 rounded-full bg-white/90 p-0.5 shadow dark:bg-slate-900/90">
          <ScoreBadge score={l.score} size="sm" />
        </div>
        {photos.length > 1 && (
          <span className="absolute bottom-3 right-3 chip bg-slate-900/70 text-white">📷 {photos.length}</span>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <h2 className="text-lg leading-snug sm:text-xl">
          <Link href={href} className="hover:text-brand-600">
            <span className="font-bold">{title.main}</span>
            {title.place && (
              <span className={`font-semibold ${TIER_STYLES[l.tier ?? 0] ?? 'text-slate-700 dark:text-slate-300'}`}> {title.place}</span>
            )}
            {title.complement && <span className="font-normal text-slate-600 dark:text-slate-300">{title.complement}</span>}
          </Link>
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {[...facts, l.tier ? `quartier rang ${l.tier}` : null].filter(Boolean).join(' · ')}
        </p>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-2xl font-bold tracking-tight">{formatEuro(l.price)}</p>
          {m2 && <p className="text-sm text-slate-500 dark:text-slate-400">{m2.toLocaleString('fr-FR')}&nbsp;€/m²</p>}
          <PriceDrop first={change?.first} last={change?.last} />
        </div>

        {l.ai_analysis?.accroche && <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{l.ai_analysis.accroche}</p>}

        <div className="mt-3">
          <CriteriaPills {...criteria} />
        </div>

        {l.reject_reason && actions === 'trash' && (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Motif : {l.reject_reason}</p>
        )}

        {detailed && l.description && (
          <details className="mt-3 text-sm text-slate-700 dark:text-slate-300">
            <summary className="cursor-pointer select-none font-medium text-brand-700 dark:text-brand-100">Lire la description</summary>
            <p className="mt-2 whitespace-pre-line leading-relaxed">{l.description}</p>
          </details>
        )}

        <div className="mt-auto pt-4">
          <SeenLine seen={seen} online={isOnline(l)} />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
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
            <Link href={href} className="text-slate-600 hover:underline dark:text-slate-400">
              Détails & DVF
            </Link>
          </div>
        </div>

        {actions !== 'none' && (
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            {/* key = identifiant : sans lui, React réutilise l'état « Rejetée » d'une carte retirée pour la suivante. */}
            <DecisionButtons key={l.id} id={l.id} mode={actions} />
          </div>
        )}
      </div>
    </article>
  );
}

// « Repérée le 8 oct. · vue aujourd'hui · publiée le 2 oct. » : d'où vient l'information de fraîcheur.
function SeenLine({ seen, online }: { seen: ReturnType<typeof seenInfo>; online: boolean }) {
  const items: { label: string; title: string; warn?: boolean }[] = [];
  if (seen.firstSeen) {
    items.push({ label: `Repérée le ${formatShortDate(seen.firstSeen)}`, title: "Première fois que nos relevés ont vu l'annonce" });
  }
  if (seen.lastSeen) {
    items.push(
      online
        ? {
            label: `vue ${daysAgo(seen.lastSeen)}`,
            title: seen.stale
              ? "Pas revue depuis plusieurs jours : la source n'a peut-être pas été relevée, ou l'annonce a été retirée"
              : "Dernière fois que nos relevés ont vu l'annonce en ligne",
            warn: seen.stale
          }
        : { label: `retirée après le ${formatShortDate(seen.lastSeen)}`, title: "Dernière fois que l'annonce a été vue en ligne" }
    );
  }
  if (seen.published) {
    items.push({ label: `publiée le ${formatShortDate(seen.published)}`, title: 'Date de publication indiquée par la source' });
  }
  if (items.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-x-1.5 text-xs text-slate-500 dark:text-slate-400">
      {items.map((item, i) => (
        <span key={item.label} title={item.title} className={item.warn ? 'font-medium text-amber-700 dark:text-amber-300' : undefined}>
          {i > 0 && <span aria-hidden="true">· </span>}
          {item.label}
        </span>
      ))}
    </p>
  );
}
