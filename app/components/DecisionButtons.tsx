'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { decide, type Decision } from '@/app/actions';

const REJECT_REASONS = ['Quartier', 'Trop cher', 'Pas assez grand', 'Pas de charme', 'Doublon'];

type Mode = 'sas' | 'trash';

// mode « sas » : Accepter / Rejeter. mode « trash » : remettre dans le sas.
export default function DecisionButtons({ id, mode = 'sas', onDone }: { id: string; mode?: Mode; onDone?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choosingReason, setChoosingReason] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function run(decision: Decision, reason?: string) {
    setError(null);
    startTransition(async () => {
      const result = await decide(id, decision, reason);
      if (!result.ok) {
        setError(result.error ?? 'Échec.');
        return;
      }
      setDone(decision === 'approved' ? 'Acceptée ✓' : decision === 'rejected' ? 'Rejetée' : 'Remise dans le sas');
      onDone?.();
      router.refresh();
    });
  }

  if (done) {
    return <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{done}</p>;
  }

  if (mode === 'trash') {
    return (
      <div>
        <button className="btn-ghost" disabled={pending} onClick={() => run('sas')}>
          ↩ Remettre dans le sas
        </button>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!choosingReason ? (
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-primary" disabled={pending} onClick={() => run('approved')}>
            {pending ? '…' : '✓ Accepter'}
          </button>
          <button className="btn-danger" disabled={pending} onClick={() => setChoosingReason(true)}>
            ✗ Rejeter
          </button>
        </div>
      ) : (
        <div className="rounded-xl bg-rose-50 p-3 dark:bg-rose-950/40">
          <p className="mb-2 text-sm font-medium">Pourquoi rejeter ?</p>
          <div className="flex flex-wrap gap-2">
            {REJECT_REASONS.map(reason => (
              <button key={reason} className="btn-danger !min-h-[40px]" disabled={pending} onClick={() => run('rejected', reason)}>
                {reason}
              </button>
            ))}
            <button className="btn-ghost !min-h-[40px]" disabled={pending} onClick={() => run('rejected')}>
              Sans motif
            </button>
            <button className="min-h-[40px] px-3 text-sm text-slate-500 underline" onClick={() => setChoosingReason(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}
