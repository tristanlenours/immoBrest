import 'server-only';
import { db } from './supabase';

export type ReviewStatus = 'sas' | 'approved' | 'rejected';

export type Listing = {
  id: string;
  source: string;
  review_status: ReviewStatus;
  market_status: string;
  title: string;
  type: string | null;
  quartier: string | null;
  tier: number | null;
  location: string | null;
  price: number | null;
  surface: number | null;
  pieces: number | null;
  chambres: number | null;
  floor: string | null;
  prestations: string | null;
  description: string | null;
  url: string | null;
  additional_links: { source: string; url: string }[];
  score: number | null;
  score_criteria: string[];
  notes: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  reject_reason: string | null;
};

export type HistoryPoint = { seen_at: string; price: number | null };

export async function getListings(...statuses: ReviewStatus[]): Promise<Listing[]> {
  const { data, error } = await db().from('immo_listings').select('*').in('review_status', statuses);
  if (error) throw new Error(`Lecture des annonces impossible : ${error.message}`);
  return (data ?? []) as Listing[];
}

export async function getListing(id: string): Promise<Listing | null> {
  const { data, error } = await db().from('immo_listings').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Lecture de l'annonce impossible : ${error.message}`);
  return (data as Listing | null) ?? null;
}

export async function getHistory(id: string): Promise<HistoryPoint[]> {
  const { data, error } = await db().from('immo_price_history').select('seen_at, price').eq('listing_id', id).order('seen_at');
  if (error) throw new Error(`Lecture de l'historique impossible : ${error.message}`);
  return (data ?? []) as HistoryPoint[];
}

// Variation de prix depuis le premier relevé, pour toutes les annonces.
export async function getPriceChanges(): Promise<Map<string, { first: number; last: number }>> {
  const { data, error } = await db().from('immo_price_history').select('listing_id, seen_at, price').order('seen_at');
  if (error) throw new Error(`Lecture de l'historique impossible : ${error.message}`);
  const changes = new Map<string, { first: number; last: number }>();
  for (const row of data ?? []) {
    if (!row.price) continue;
    const current = changes.get(row.listing_id);
    changes.set(row.listing_id, { first: current?.first ?? row.price, last: row.price });
  }
  return changes;
}

export async function countByReviewStatus(status: ReviewStatus): Promise<number> {
  const { count, error } = await db().from('immo_listings').select('id', { count: 'exact', head: true }).eq('review_status', status);
  if (error) throw new Error(`Comptage impossible : ${error.message}`);
  return count ?? 0;
}

export async function getLastRun(): Promise<string | null> {
  const { data } = await db()
    .from('immo_run_log')
    .select('finished_at')
    .eq('status', 'success')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.finished_at ?? null;
}

// ---------------------------------------------------------------------------
// Aides d'affichage
// ---------------------------------------------------------------------------

export function isOnline(l: Pick<Listing, 'market_status'>): boolean {
  const s = (l.market_status || '').toLowerCase();
  return !s.includes('vendu') && !s.includes('hors zone');
}

export function pricePerM2(l: Pick<Listing, 'price' | 'surface'>): number | null {
  return l.price && l.surface ? Math.round(l.price / Number(l.surface)) : null;
}

export function formatEuro(n: number | null | undefined): string {
  if (!n) return 'Prix sur demande';
  return `${n.toLocaleString('fr-FR')} €`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
}

export function daysAgo(iso: string | null): string {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  return `il y a ${days} j`;
}

export type CriteriaSummary = { positives: string[]; negatives: string[] };

const POSITIVE_LABELS: [RegExp, string][] = [
  [/Siam \/ Triangle/, 'Quartier prioritaire'],
  [/Dernier étage/, 'Dernier étage'],
  [/Seul à l'étage/, "Seul à l'étage"],
  [/Terrasse/, 'Terrasse / jardin'],
  [/Ascenseur/, 'Ascenseur'],
  [/Parking/, 'Parking / garage']
];

const NEGATIVE_LABELS: [RegExp, string][] = [
  [/Siam \/ Triangle/, 'Quartier moins prioritaire'],
  [/Dernier étage/, 'Pas dernier étage'],
  [/Seul à l'étage/, "Pas seul à l'étage"],
  [/Terrasse/, 'Pas de terrasse / jardin'],
  [/Ascenseur/, "Pas d'ascenseur"],
  [/Parking/, 'Pas de parking / garage']
];

// Transforme les lignes « - [x] ... (-2.0) » du scoring en listes lisibles de points forts / faibles.
export function summarizeCriteria(lines: string[]): CriteriaSummary {
  const positives: string[] = [];
  const negatives: string[] = [];
  for (const line of lines ?? []) {
    const m = line.match(/^\s*-\s*\[( |x)\]\s*(.*)$/);
    if (!m) continue;
    const checked = m[1] === 'x';
    const label = m[2].trim();
    const delta = label.match(/\((-\d+(?:\.\d+)?)[^)]*\)/)?.[1];
    const deltaText = delta ? ` (${delta.replace('-', '−')})` : '';

    if (label.startsWith('Malus')) {
      if (checked) negatives.push(label);
      continue;
    }
    if (label.startsWith('Bonus')) {
      if (checked) positives.push(label);
      continue;
    }
    if (checked) {
      const named = POSITIVE_LABELS.find(([re]) => re.test(label));
      if (named) positives.push(named[1]);
    } else if (delta) {
      const named = NEGATIVE_LABELS.find(([re]) => re.test(label));
      if (named) negatives.push(`${named[1]}${deltaText}`);
    }
  }
  return { positives, negatives };
}

export function scoreTone(score: number | null): 'high' | 'medium' | 'low' {
  const s = Number(score ?? 0);
  return s >= 7 ? 'high' : s >= 5 ? 'medium' : 'low';
}
