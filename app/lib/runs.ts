import 'server-only';
import { db } from './supabase';

// Journal des relevés : immo_run_log, alimenté par le fetch (voir .agents/skills/leboncoin_fetch).
export type RunEventType =
  | 'new'
  | 'price'
  | 'sold'
  | 'rejected'
  | 'purged'
  | 'warning'
  | 'updated'
  | 'score'
  | 'enriched'
  | 'missing'
  | 'filtered'
  | 'trashed'
  | 'duplicate'
  | 'unchanged';

export type RunEvent = {
  at: string;
  type: RunEventType;
  source: string;
  id?: string;
  url?: string | null;
  title: string;
  price?: number | null;
  detail: string;
};

type SourceRun = { started_at?: string; finished_at: string; found: number; status: 'ok' | 'empty' | 'error'; error?: string };

type RunStats = {
  new?: number;
  priceChanged?: number;
  unchanged?: number;
  skippedTrashed?: number;
  markedSold?: number;
  rejected?: number;
  purged?: number;
  sources?: string[];
  foundBySource?: Record<string, number>;
  sourceRuns?: Record<string, SourceRun>;
  failures?: string[];
  events?: RunEvent[];
};

export type Run = {
  id: number;
  pipeline: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'error';
  error: string | null;
  stats: RunStats;
};

export type SourceStatus = { key: string; label: string; paused?: boolean; run: (SourceRun & { runId: number }) | null };

const SOURCES: { key: string; label: string; paused?: boolean }[] = [
  { key: 'leboncoin', label: 'Leboncoin' },
  { key: 'henry', label: 'Agence Henry' },
  { key: 'barraine', label: 'Barraine' },
  { key: 'luxior', label: 'Luxior' },
  { key: 'human', label: 'Human', paused: true }
];

// Les relevés antérieurs au détail par source n'ont que foundBySource et failures.
function sourceRunOf(run: Run, key: string): SourceRun | null {
  const stats = run.stats;
  if (!run.finished_at || !(stats.sources || []).includes(key)) return null;
  if (stats.sourceRuns?.[key]) return stats.sourceRuns[key];
  const failure = (stats.failures || []).find(f => f.startsWith(`${key}:`));
  const found = stats.foundBySource?.[key] ?? 0;
  return {
    finished_at: run.finished_at,
    found,
    status: failure ? 'error' : found === 0 ? 'empty' : 'ok',
    error: failure?.slice(key.length + 2)
  };
}

export async function getRuns(limit = 40): Promise<Run[]> {
  const { data, error } = await db()
    .from('immo_run_log')
    .select('id, pipeline, started_at, finished_at, status, error, stats')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Lecture du journal impossible : ${error.message}`);
  return (data ?? []) as Run[];
}

export async function getRun(id: number): Promise<Run | null> {
  const { data, error } = await db()
    .from('immo_run_log')
    .select('id, pipeline, started_at, finished_at, status, error, stats')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Lecture du relevé impossible : ${error.message}`);
  return data as Run | null;
}

export function sourceStatuses(runs: Run[]): SourceStatus[] {
  return SOURCES.map(source => {
    for (const run of runs) {
      const sourceRun = sourceRunOf(run, source.key);
      if (sourceRun) return { ...source, run: { ...sourceRun, runId: run.id } };
    }
    return { ...source, run: null };
  });
}

export function sourceLabel(key: string): string {
  return SOURCES.find(s => s.key === key)?.label ?? key;
}

export function formatRunDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Paris' });
  return `${day} à ${time.replace(':', 'h')}`;
}

export function runDuration(run: Pick<Run, 'started_at' | 'finished_at'>): string {
  if (!run.finished_at) return '—';
  const minutes = Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 60_000);
  return minutes < 1 ? "moins d'1 min" : `${minutes} min`;
}
