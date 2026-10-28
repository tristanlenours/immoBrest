import 'server-only';
import { db } from './supabase';
import quartiers from './quartiers.json';
import type { Listing } from './listings';

type Sale = {
  id: string;
  sale_date: string;
  adresse: string | null;
  prix: number | null;
  surface: number | null;
  surface_carrez: number | null;
  lat: number | null;
  lon: number | null;
  prix_m2: number | null;
};

export type DvfComparison = {
  prixM2: number;
  medianM2: number;
  diffPct: number;
  sampleCount: number;
  scope: string;
  years: string;
  comparables: { date: string; adresse: string; surface: number; prix: number; prixM2: number }[];
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const surfaceOf = (s: Sale) => Number(s.surface_carrez ?? s.surface ?? 0);

// Compare le prix au m² de l'annonce avec les ventes réelles (DVF) des deux dernières années :
// même type de bien, dans le rayon du quartier quand il y a assez de ventes, sinon sur tout Brest.
export async function compareWithDvf(l: Listing): Promise<DvfComparison | null> {
  if (!l.price || !l.surface) return null;

  const type = (l.type || '').toLowerCase().includes('maison') ? 'Maison' : 'Appartement';
  const since = new Date();
  since.setFullYear(since.getFullYear() - 2);

  const { data, error } = await db()
    .from('immo_dvf_sales')
    .select('id, sale_date, adresse, prix, surface, surface_carrez, lat, lon, prix_m2')
    .eq('type', type)
    .gte('sale_date', since.toISOString().slice(0, 10))
    .not('prix_m2', 'is', null);
  if (error || !data || data.length === 0) return null;
  const sales = data as Sale[];

  const quartier = quartiers.find(q => q.name === l.quartier);
  let matched = sales;
  let scope = 'Brest';

  if (quartier) {
    const within = (km: number) =>
      sales.filter(s => s.lat && s.lon && haversineKm(quartier.lat, quartier.lon, s.lat, s.lon) <= km);
    let near = within(quartier.radiusKm);
    if (near.length < 4) near = within(Math.max(0.85, quartier.radiusKm * 1.4));
    if (near.length >= 3) {
      matched = near;
      scope = quartier.name;
    }
  }

  const medianM2 = median(matched.map(s => Number(s.prix_m2)));
  if (!medianM2) return null;

  const prixM2 = Math.round(l.price / Number(l.surface));
  const target = Number(l.surface);
  const comparables = [...matched]
    .sort((a, b) => {
      const da = Math.abs(surfaceOf(a) - target);
      const dbb = Math.abs(surfaceOf(b) - target);
      if (Math.abs(da - dbb) > 12) return da - dbb;
      return b.sale_date.localeCompare(a.sale_date);
    })
    .slice(0, 5)
    .map(s => ({
      date: s.sale_date,
      adresse: s.adresse || 'Brest',
      surface: Math.round(surfaceOf(s)),
      prix: s.prix ?? 0,
      prixM2: Number(s.prix_m2)
    }));

  return {
    prixM2,
    medianM2,
    diffPct: Math.round(((prixM2 - medianM2) / medianM2) * 100),
    sampleCount: matched.length,
    scope,
    years: `${since.getFullYear()}–${new Date().getFullYear()}`,
    comparables
  };
}
