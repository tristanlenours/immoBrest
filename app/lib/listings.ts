import 'server-only';
import { db } from './supabase';

export type ReviewStatus = 'sas' | 'approved' | 'rejected';

type Tri = 'oui' | 'non' | 'inconnu';

// Analyse Gemini rangée par le pipeline (voir .agents/skills/shared/listing_ai.js).
export type AiAnalysis = {
  complement_titre: string;
  accroche: string;
  dernier_etage: Tri;
  seul_a_l_etage: Tri;
  ascenseur: Tri;
  exterieur: 'terrasse' | 'balcon' | 'jardin' | 'aucun' | 'inconnu';
  stationnement: 'garage' | 'parking' | 'aucun' | 'inconnu';
  vue_mer: Tri;
  etat: 'neuf' | 'renove' | 'bon' | 'a_rafraichir' | 'travaux' | 'inconnu';
  dpe: string;
  etage: number | null;
  nb_etages: number | null;
  chambres: number | null;
  annee_construction: number | null;
  points_forts: string[];
  points_faibles: string[];
  model: string;
  analyzed_at: string;
};

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
  published_at?: string | null;
  photos?: string[];
  ai_analysis?: AiAnalysis | null;
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

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' });
}

// Jours calendaires écoulés (heure de Paris) : vu hier soir = « hier », même s'il y a moins de 24 h.
const parisDay = (d: Date) => new Date(d.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })).getTime();

function daysSince(iso: string): number {
  return Math.round((parisDay(new Date()) - parisDay(new Date(iso))) / 86_400_000);
}

export function daysAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const days = daysSince(iso);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  return `il y a ${days} j`;
}

// Titre « Maison 141 m² » + « Saint-Michel » + « avec jardin et garage » :
// type, surface et quartier sont fiables et identifient le bien, le complément vient de l'analyse IA.
export function headline(l: Pick<Listing, 'type' | 'surface' | 'quartier' | 'title' | 'ai_analysis'>) {
  const type = l.type ? l.type.charAt(0).toUpperCase() + l.type.slice(1).toLowerCase() : 'Bien';
  const main = l.surface ? `${type} ${Math.round(Number(l.surface))} m²` : type;
  const place = l.quartier && l.quartier !== 'Brest' ? l.quartier : null;
  let complement = l.ai_analysis?.complement_titre ?? '';
  if (!l.ai_analysis) {
    const prefix = [main, place].filter(Boolean).join(' ');
    if (l.title.startsWith(prefix)) complement = l.title.slice(prefix.length).replace(/^,/, '').trim();
    else if (l.title.includes(' - ')) complement = l.title.split(' - ').slice(1).join(' - ').trim();
  }
  // Le complément est rendu avec son séparateur : « avec terrasse » après une espace, « seul à l'étage » après une virgule.
  if (complement) complement = /^avec\b/i.test(complement) ? ` ${complement}` : `, ${complement}`;
  return { main, place, complement };
}

export type SeenInfo = {
  firstSeen: string | null;
  lastSeen: string | null;
  published: string | null;
  daysOnMarket: number | null;
  // Annonce encore active mais que les relevés n'ont pas revue depuis plusieurs jours (source en panne ?).
  stale: boolean;
};

export function seenInfo(l: Listing): SeenInfo {
  const firstSeen = l.first_seen_at;
  const lastSeen = l.last_seen_at ?? l.first_seen_at;
  const published = l.published_at ?? null;
  const start = published && firstSeen ? (published < firstSeen ? published : firstSeen) : firstSeen;
  const end = isOnline(l) ? new Date().toISOString() : lastSeen;
  const daysOnMarket = start && end ? Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000)) : null;
  return { firstSeen, lastSeen, published, daysOnMarket, stale: isOnline(l) && !!lastSeen && daysSince(lastSeen) > 3 };
}

export type CriteriaSummary = { positives: string[]; negatives: string[]; unknowns: string[] };

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

const UNKNOWN_LABELS: [RegExp, string][] = [
  [/Dernier étage/, 'Dernier étage non précisé'],
  [/Seul à l'étage/, "Seul à l'étage non précisé"],
  [/Terrasse/, 'Terrasse / jardin non précisé'],
  [/Ascenseur/, 'Ascenseur non précisé'],
  [/Parking/, 'Parking / garage non précisé']
];

// Transforme les lignes « - [x] ... (-2.0) » du scoring en listes lisibles de points forts / faibles,
// en isolant les critères que l'annonce ne permet pas de trancher (« non précisé »).
// Pour une maison, dernier étage / seul à l'étage / ascenseur sont réputés acquis : on ne les affiche pas.
const HOUSE_IMPLICIT = new Set(['Dernier étage', "Seul à l'étage", 'Ascenseur']);

export function summarizeCriteria(lines: string[], isHouse = false): CriteriaSummary {
  const positives: string[] = [];
  const negatives: string[] = [];
  const unknowns: string[] = [];
  for (const line of lines ?? []) {
    const m = line.match(/^\s*-\s*\[( |x)\]\s*(.*)$/);
    if (!m) continue;
    const checked = m[1] === 'x';
    const label = m[2].trim();
    const delta = label.match(/\((-\d+(?:\.\d+)?)[^)]*\)/)?.[1];
    const deltaText = delta ? ` (${delta.replace('-', '−')})` : '';

    if (!checked && label.includes('(non précisé)')) {
      const named = UNKNOWN_LABELS.find(([re]) => re.test(label));
      if (named) unknowns.push(`${named[1]}${deltaText}`);
      continue;
    }

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
      if (named && !(isHouse && HOUSE_IMPLICIT.has(named[1]))) positives.push(named[1]);
    } else if (delta) {
      const named = NEGATIVE_LABELS.find(([re]) => re.test(label));
      if (named) negatives.push(`${named[1]}${deltaText}`);
    }
  }
  return { positives, negatives, unknowns };
}

export function scoreTone(score: number | null): 'high' | 'medium' | 'low' {
  const s = Number(score ?? 0);
  return s >= 7 ? 'high' : s >= 5 ? 'medium' : 'low';
}
