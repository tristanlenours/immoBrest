import type { HistoryPoint } from '@/lib/listings';

// Courbe en escalier du prix dans le temps (SVG, sans dépendance).
export default function PriceChart({ history }: { history: HistoryPoint[] }) {
  const points = history.filter(h => h.price).map(h => ({ t: new Date(h.seen_at).getTime(), price: h.price as number }));
  if (points.length < 2) return null;

  const W = 640;
  const H = 180;
  const pad = { l: 56, r: 16, t: 16, b: 28 };
  const tMin = points[0].t;
  const tMax = Math.max(points[points.length - 1].t, tMin + 86_400_000);
  const prices = points.map(p => p.price);
  const pMin = Math.min(...prices);
  const pMax = Math.max(...prices);
  const span = Math.max(pMax - pMin, pMax * 0.02);
  const lo = pMin - span * 0.15;
  const hi = pMax + span * 0.15;

  const x = (t: number) => pad.l + ((t - tMin) / (tMax - tMin)) * (W - pad.l - pad.r);
  const y = (p: number) => pad.t + (1 - (p - lo) / (hi - lo)) * (H - pad.t - pad.b);

  // Escalier : le prix reste constant jusqu'au relevé suivant.
  const path = points
    .map((p, i) => (i === 0 ? `M${x(p.t)},${y(p.price)}` : `H${x(p.t)}V${y(p.price)}`))
    .join('') + `H${x(tMax)}`;

  const fmt = (n: number) => `${Math.round(n / 1000)} k€`;
  const date = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Évolution du prix dans le temps">
      {[hi, (hi + lo) / 2, lo].map(v => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-slate-200 dark:stroke-slate-800" />
          <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
            {fmt(v)}
          </text>
        </g>
      ))}
      <path d={path} fill="none" strokeWidth={2.5} strokeLinejoin="round" className="stroke-brand-600" />
      {points.map(p => (
        <circle key={p.t} cx={x(p.t)} cy={y(p.price)} r={4} className="fill-brand-600 stroke-white dark:stroke-slate-900" strokeWidth={2} />
      ))}
      <text x={pad.l} y={H - 8} className="fill-slate-500 text-[11px]">
        {date(tMin)}
      </text>
      <text x={W - pad.r} y={H - 8} textAnchor="end" className="fill-slate-500 text-[11px]">
        {date(tMax)}
      </text>
    </svg>
  );
}
