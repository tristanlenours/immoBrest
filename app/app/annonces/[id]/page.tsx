import Link from 'next/link';
import { notFound } from 'next/navigation';
import Nav from '@/components/Nav';
import PriceChart from '@/components/PriceChart';
import DecisionButtons from '@/components/DecisionButtons';
import ListingPhoto from '@/components/ListingPhoto';
import { CriteriaPills, QuartierBadge, ScoreBadge, SourceBadge } from '@/components/Ui';
import { compareWithDvf } from '@/lib/dvf';
import {
  daysAgo,
  formatDate,
  formatDateTime,
  formatEuro,
  getHistory,
  getListing,
  headline,
  isOnline,
  pricePerM2,
  seenInfo,
  summarizeCriteria,
  type AiAnalysis
} from '@/lib/listings';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { id: string } }) {
  const l = await getListing(decodeURIComponent(params.id)).catch(() => null);
  return { title: l ? `${l.title} · ImmoBrest` : 'Annonce · ImmoBrest' };
}

export default async function ListingPage({ params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id);
  const listing = await getListing(id);
  if (!listing) notFound();

  const [history, dvf] = await Promise.all([getHistory(id), compareWithDvf(listing)]);
  const criteria = summarizeCriteria(listing.score_criteria, (listing.type || '').toLowerCase().includes('maison'));
  const m2 = pricePerM2(listing);
  const title = headline(listing);
  const seen = seenInfo(listing);
  const photos = listing.photos ?? [];
  const isHouse = (listing.type || '').toLowerCase().includes('maison');
  const priceChanges = history.filter((h, i) => i > 0 && h.price !== history[i - 1].price).length;

  const facts: [string, string | null][] = [
    ['Type', listing.type],
    ['Surface', listing.surface ? `${Number(listing.surface)} m²` : null],
    ['Pièces', listing.pieces ? String(listing.pieces) : null],
    ['Chambres', listing.chambres ? String(listing.chambres) : null],
    ['Étage', listing.floor && listing.floor !== 'Non spécifié' ? listing.floor : null],
    ['Prestations', listing.prestations && listing.prestations !== 'Non spécifiées' ? listing.prestations : null],
    ['Localisation', listing.location]
  ];

  // [libellé, valeur, précision]
  const timeline: [string, string, string][] = [
    ['Repérée par nos relevés', formatDateTime(seen.firstSeen), daysAgo(seen.firstSeen)],
    [
      isOnline(listing) ? 'Vue en ligne pour la dernière fois' : 'Dernière fois vue en ligne',
      formatDateTime(seen.lastSeen),
      seen.stale ? `${daysAgo(seen.lastSeen)} · source pas relevée depuis ?` : daysAgo(seen.lastSeen)
    ]
  ];
  if (seen.published) timeline.push(['Publiée par la source', formatDate(seen.published), daysAgo(seen.published)]);
  if (seen.daysOnMarket !== null) {
    timeline.push(['Sur le marché depuis', `${seen.daysOnMarket} jours`, isOnline(listing) ? 'toujours en ligne' : 'retirée']);
  }
  timeline.push(['Changements de prix', priceChanges === 0 ? 'aucun' : String(priceChanges), `${history.length} relevé${history.length > 1 ? 's' : ''} de prix`]);

  return (
    <>
      <Nav current="/annonces" />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <Link href="/annonces" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
          ← Retour aux annonces
        </Link>

        <section className="card overflow-hidden">
          <Gallery photos={photos} alt={listing.title} isHouse={isHouse} />
          <div className="p-5">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <SourceBadge source={listing.source} />
                <QuartierBadge quartier={listing.quartier} tier={listing.tier} />
                <span className="chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{listing.market_status}</span>
                <span className="chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {listing.review_status === 'sas' ? "En attente" : listing.review_status === 'approved' ? 'Acceptée' : 'Rejetée'}
                </span>
              </div>
              <h1 className="mt-2 text-xl leading-snug sm:text-2xl">
                <span className="font-bold">{title.main}</span>
                {title.place && <span className="font-semibold"> {title.place}</span>}
                {title.complement && <span className="font-normal text-slate-600 dark:text-slate-300">{title.complement}</span>}
              </h1>
              {listing.ai_analysis?.accroche && <p className="mt-1 text-slate-600 dark:text-slate-300">{listing.ai_analysis.accroche}</p>}
              <p className="mt-2 text-3xl font-bold tracking-tight">
                {formatEuro(listing.price)}
                {m2 && <span className="ml-3 text-base font-normal text-slate-500 dark:text-slate-400">{m2.toLocaleString('fr-FR')}&nbsp;€/m²</span>}
              </p>
            </div>
            <ScoreBadge score={listing.score} size="lg" />
          </div>

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {listing.url && (
              <a href={listing.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 hover:underline dark:text-brand-100">
                Voir l&apos;annonce ↗
              </a>
            )}
            {listing.additional_links.map(link => (
              <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:underline dark:text-slate-400">
                {link.source} ↗
              </a>
            ))}
          </div>

          {listing.review_status === 'sas' && (
            <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
              <DecisionButtons id={listing.id} />
            </div>
          )}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold">Suivi de l&apos;annonce</h2>
          <dl className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {timeline.map(([label, value, hint]) => (
              <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
                <dd className="text-right">
                  <span className="font-medium">{value}</span>
                  <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{hint}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {dvf && (
          <section className="card p-5">
            <h2 className="font-semibold">Comparaison avec les ventes réelles</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {dvf.sampleCount} ventes · {listing.type?.toLowerCase().includes('maison') ? 'maisons' : 'appartements'} · {dvf.scope} · {dvf.years}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              <Stat label="Cette annonce" value={`${dvf.prixM2.toLocaleString('fr-FR')} €/m²`} />
              <Stat label="Médiane vendue" value={`${dvf.medianM2.toLocaleString('fr-FR')} €/m²`} />
              <Stat
                label="Écart"
                value={`${dvf.diffPct > 0 ? '+' : ''}${dvf.diffPct} %`}
                tone={dvf.diffPct > 10 ? 'bad' : dvf.diffPct < -5 ? 'good' : undefined}
              />
            </div>
            {dvf.comparables.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-1 pr-3">Date</th>
                      <th className="py-1 pr-3">Adresse</th>
                      <th className="py-1 pr-3 text-right">Surface</th>
                      <th className="py-1 pr-3 text-right">Prix</th>
                      <th className="py-1 text-right">€/m²</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dvf.comparables.map(c => (
                      <tr key={`${c.date}-${c.adresse}-${c.prix}`} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-1.5 pr-3 whitespace-nowrap">{formatDate(c.date)}</td>
                        <td className="py-1.5 pr-3">{c.adresse}</td>
                        <td className="py-1.5 pr-3 text-right whitespace-nowrap">{c.surface} m²</td>
                        <td className="py-1.5 pr-3 text-right whitespace-nowrap">{formatEuro(c.prix)}</td>
                        <td className="py-1.5 text-right whitespace-nowrap">{c.prixM2.toLocaleString('fr-FR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {history.length > 0 && (
          <section className="card p-5">
            <h2 className="font-semibold">Historique du prix</h2>
            <div className="mt-2">
              <PriceChart history={history} />
            </div>
            <ul className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {history.map(h => (
                <li key={h.seen_at} className="flex justify-between py-1.5">
                  <span className="text-slate-500 dark:text-slate-400">{formatDate(h.seen_at)}</span>
                  <span className="font-medium">{formatEuro(h.price)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {criteria.positives.length + criteria.negatives.length + criteria.unknowns.length > 0 && (
          <section className="card p-5">
            <h2 className="font-semibold">Pourquoi ce score</h2>
            <div className="mt-3">
              <CriteriaPills {...criteria} />
            </div>
            {criteria.unknowns.length > 0 && (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                « ? » : l&apos;annonce ne permet pas de trancher, 3/4 du malus est appliqué. Une confirmation de l&apos;agence peut faire monter la note.
              </p>
            )}
          </section>
        )}

        {listing.ai_analysis && <AiSection ai={listing.ai_analysis} />}

        <section className="card p-5">
          <h2 className="font-semibold">Caractéristiques</h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-slate-100 py-1.5 dark:border-slate-800">
                  <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
          </dl>
          {listing.notes && <p className="mt-3 text-sm italic text-slate-600 dark:text-slate-400">{listing.notes}</p>}
        </section>

        {listing.description && (
          <section className="card p-5">
            <h2 className="font-semibold">Description</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-300">{listing.description}</p>
          </section>
        )}
      </main>
    </>
  );
}

function Gallery({ photos, alt, isHouse }: { photos: string[]; alt: string; isHouse: boolean }) {
  if (photos.length <= 1) {
    return <ListingPhoto src={photos[0]} alt={alt} isHouse={isHouse} className="aspect-[16/9] w-full" />;
  }
  return (
    <div className="flex snap-x snap-mandatory gap-1 overflow-x-auto bg-slate-100 dark:bg-slate-800">
      {photos.map((src, i) => (
        <ListingPhoto key={src} src={src} alt={`${alt} — photo ${i + 1}`} isHouse={isHouse} className="aspect-[4/3] h-64 shrink-0 snap-start sm:h-80" />
      ))}
    </div>
  );
}

const TRI_LABELS: Record<string, string> = { oui: 'Oui', non: 'Non', inconnu: 'Non précisé' };
const ETAT_LABELS: Record<string, string> = {
  neuf: 'Neuf',
  renove: 'Rénové',
  bon: 'Bon état',
  a_rafraichir: 'À rafraîchir',
  travaux: 'Gros travaux',
  inconnu: 'Non précisé'
};
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function AiSection({ ai }: { ai: AiAnalysis }) {
  const floor = ai.etage === null ? 'Non précisé' : `${ai.etage === 0 ? 'RDC' : ai.etage}${ai.nb_etages ? ` / ${ai.nb_etages}` : ''}`;
  const features: [string, string][] = [
    ['Dernier étage', TRI_LABELS[ai.dernier_etage]],
    ["Seul à l'étage", TRI_LABELS[ai.seul_a_l_etage]],
    ['Ascenseur', TRI_LABELS[ai.ascenseur]],
    ['Extérieur', ai.exterieur === 'inconnu' ? 'Non précisé' : capitalize(ai.exterieur)],
    ['Stationnement', ai.stationnement === 'inconnu' ? 'Non précisé' : capitalize(ai.stationnement)],
    ['Vue mer', TRI_LABELS[ai.vue_mer]],
    ['État', ETAT_LABELS[ai.etat] ?? ai.etat],
    ['DPE', ai.dpe === 'inconnu' ? 'Non précisé' : ai.dpe],
    ['Étage', floor],
    ['Construction', ai.annee_construction ? String(ai.annee_construction) : 'Non précisé']
  ];
  return (
    <section className="card p-5">
      <h2 className="font-semibold">Analyse IA de l&apos;annonce</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Points forts</h3>
          <ul className="mt-1.5 space-y-1 text-sm">
            {ai.points_forts.map(p => (
              <li key={p}>✓ {p}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">Points faibles &amp; incertitudes</h3>
          <ul className="mt-1.5 space-y-1 text-sm">
            {ai.points_faibles.length === 0 ? (
              <li className="text-slate-500 dark:text-slate-400">Rien de notable</li>
            ) : (
              ai.points_faibles.map(p => <li key={p}>✗ {p}</li>)
            )}
          </ul>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-x-6 text-sm sm:grid-cols-2">
        {features.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-slate-100 py-1.5 dark:border-slate-800">
            <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
            <dd className={`text-right font-medium ${v === 'Non précisé' ? 'text-amber-700 dark:text-amber-300' : ''}`}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Lu dans la description par {ai.model} le {formatDate(ai.analyzed_at)}. Ces caractéristiques alimentent le score.
      </p>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : '';
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-0.5 text-base font-bold sm:text-lg ${color}`}>{value}</p>
    </div>
  );
}
