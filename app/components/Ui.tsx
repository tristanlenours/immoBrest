import { scoreTone } from '@/lib/listings';

const SCORE_STYLES = {
  high: 'bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800',
  medium: 'bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800',
  low: 'bg-rose-100 text-rose-800 ring-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-800'
};

export function ScoreBadge({ score, size = 'md' }: { score: number | null; size?: 'sm' | 'md' | 'lg' }) {
  const dimension = size === 'lg' ? 'h-20 w-20 text-3xl' : size === 'sm' ? 'h-12 w-12 text-lg' : 'h-14 w-14 text-xl';
  return (
    <div
      className={`flex shrink-0 flex-col items-center justify-center rounded-full ring-2 ${dimension} ${SCORE_STYLES[scoreTone(score)]}`}
      aria-label={`Score ${score ?? 'non calculé'} sur 10`}
    >
      <span className="font-bold leading-none">{score ?? '–'}</span>
      <span className="text-[10px] font-medium opacity-70">/10</span>
    </div>
  );
}

const SOURCE_STYLES: Record<string, string> = {
  Leboncoin: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  'Agence Henry': 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  Luxior: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  Barraine: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200',
  Human: 'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200'
};

export function SourceBadge({ source }: { source: string }) {
  return <span className={`chip ${SOURCE_STYLES[source] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>{source}</span>;
}

export function QuartierBadge({ quartier, tier }: { quartier: string | null; tier: number | null }) {
  if (!quartier) return null;
  const tone =
    tier === 1
      ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
      : tier === 2
        ? 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
  return (
    <span className={`chip ${tone}`}>
      📍 {quartier}
      {tier ? ` · rang ${tier}` : ''}
    </span>
  );
}

const PILL_STYLES = {
  good: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
  bad: 'bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200',
  unknown: 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
};
const PILL_ICONS = { good: '✓', bad: '✗', unknown: '?' };

export function Pill({ tone, children, title }: { tone: 'good' | 'bad' | 'unknown'; children: React.ReactNode; title?: string }) {
  return (
    <span className={`chip ${PILL_STYLES[tone]}`} title={title}>
      {PILL_ICONS[tone]}&nbsp;{children}
    </span>
  );
}

// Points forts / faibles / non précisés du scoring, sous forme de pastilles.
export function CriteriaPills({ positives, negatives, unknowns }: { positives: string[]; negatives: string[]; unknowns: string[] }) {
  if (positives.length + negatives.length + unknowns.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {positives.map(p => (
        <Pill key={p} tone="good">{p}</Pill>
      ))}
      {negatives.map(n => (
        <Pill key={n} tone="bad">{n}</Pill>
      ))}
      {unknowns.map(u => (
        <Pill key={u} tone="unknown" title="L'annonce ne permet pas de trancher : 3/4 du malus est appliqué">
          {u}
        </Pill>
      ))}
    </div>
  );
}

export function PriceDrop({ first, last }: { first?: number; last?: number }) {
  if (!first || !last || first === last) return null;
  const diff = last - first;
  const down = diff < 0;
  return (
    <span className={`chip ${down ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'}`}>
      {down ? '▼' : '▲'} {Math.abs(diff).toLocaleString('fr-FR')}&nbsp;€ depuis la 1ʳᵉ vue
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card px-6 py-14 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}
