'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmDuplicate, dismissDuplicate } from '@/app/actions';

export type SuspectView = {
  id: string;
  ref: string | null;
  title: string;
  status: string;
  reason: string;
};

const STATUS_LABELS: Record<string, string> = { approved: 'base active', sas: 'sas', rejected: 'corbeille' };

// Encart « Doublon possible » d'une annonce du sas : l'utilisateur ouvre l'autre fiche et tranche.
export default function DuplicateSuspects({ id, suspects }: { id: string; suspects: SuspectView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState<SuspectView | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(suspect: SuspectView, isDuplicate: boolean) {
    setError(null);
    startTransition(async () => {
      const result = isDuplicate ? await confirmDuplicate(id, suspect.id) : await dismissDuplicate(id, suspect.id);
      if (!result.ok) {
        setError(result.error ?? 'Échec.');
        return;
      }
      if (isDuplicate) setConfirmed(suspect);
      else setHidden(current => [...current, suspect.id]);
      router.refresh();
    });
  }

  if (confirmed) {
    return (
      <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        Écartée comme doublon de {confirmed.ref ?? confirmed.title} ; ses liens sont ajoutés à cette annonce.
      </p>
    );
  }

  const visible = suspects.filter(s => !hidden.includes(s.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
      {visible.map(s => (
        <div key={s.id}>
          <p className="font-medium text-amber-900 dark:text-amber-200">⚠ Doublon possible</p>
          <p className="mt-1">
            <Link href={`/annonces/${encodeURIComponent(s.ref ?? s.id)}`} target="_blank" className="font-medium text-brand-700 underline dark:text-brand-100">
              {s.ref && <span className="font-mono">{s.ref} · </span>}
              {s.title} ↗
            </Link>{' '}
            <span className="text-slate-500 dark:text-slate-400">({STATUS_LABELS[s.status] ?? s.status})</span>
          </p>
          <p className="mt-1 text-slate-600 dark:text-slate-300">{s.reason}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-danger !min-h-[40px]" disabled={pending} onClick={() => run(s, true)}>
              C&apos;est un doublon
            </button>
            <button className="btn-ghost !min-h-[40px]" disabled={pending} onClick={() => run(s, false)}>
              Pas un doublon
            </button>
          </div>
        </div>
      ))}
      {error && <p className="text-rose-600">{error}</p>}
    </div>
  );
}
