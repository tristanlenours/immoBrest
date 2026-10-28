import Link from 'next/link';
import { notFound } from 'next/navigation';
import Nav from '@/components/Nav';
import PriceChart from '@/components/PriceChart';
import DecisionButtons from '@/components/DecisionButtons';
import { Pill, QuartierBadge, ScoreBadge, SourceBadge } from '@/components/Ui';
import { compareWithDvf } from '@/lib/dvf';
import { formatDate, formatEuro, getHistory, getListing, pricePerM2, summarizeCriteria } from '@/lib/listings';

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
  const { positives, negatives } = summarizeCriteria(listing.score_criteria);
  const m2 = pricePerM2(listing);

  const facts: [string, string | null][] = [
    ['Type', listing.type],
    ['Surface', listing.surface ? `${Number(listing.surface)} m²` : null],
    ['Pièces', listing.pieces ? String(listing.pieces) : null],
    ['Chambres', listing.chambres ? String(listing.chambres) : null],
    ['Étage', listing.floor && listing.floor !== 'Non spécifié' ? listing.floor : null],
    ['Prestations', listing.prestations && listing.prestations !== 'Non spécifiées' ? listing.prestations : null],
    ['Localisation', listing.location],
    ['Première vue', formatDate(listing.first_seen_at)],
    ['Dernière vue', formatDate(listing.last_seen_at)]
  ];

  return (
    <>
      <Nav current="/annonces" />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <Link href="/annonces" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
          ← Retour aux annonces
        </Link>

        <section className="card p-5">
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
              <h1 className="mt-2 text-xl font-bold leading-snug sm:text-2xl">{listing.title}</h1>
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

        {(positives.length > 0 || negatives.length > 0) && (
          <section className="card p-5">
            <h2 className="font-semibold">Pourquoi ce score</h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {positives.map(p => (
                <Pill key={p} tone="good">{p}</Pill>
              ))}
              {negatives.map(n => (
                <Pill key={n} tone="bad">{n}</Pill>
              ))}
            </div>
          </section>
        )}

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

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : '';
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-0.5 text-base font-bold sm:text-lg ${color}`}>{value}</p>
    </div>
  );
}
