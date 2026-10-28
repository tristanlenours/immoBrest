'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { db } from '@/lib/supabase';

export type Decision = 'approved' | 'rejected' | 'sas';

// Les actions serveur sont des POST publics : on revérifie la session, en plus du middleware.
async function assertSession() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token, process.env.SESSION_SECRET))) {
    throw new Error('Session expirée, reconnecte-toi.');
  }
}

export async function decide(id: string, decision: Decision, reason?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await assertSession();
    if (!['approved', 'rejected', 'sas'].includes(decision)) throw new Error('Décision invalide.');

    const patch =
      decision === 'sas'
        ? { review_status: 'sas', decided_at: null, decided_by: null, reject_reason: null }
        : {
            review_status: decision,
            decided_at: new Date().toISOString(),
            decided_by: 'web',
            reject_reason: decision === 'rejected' ? (reason?.slice(0, 120) || null) : null
          };

    const { error, count } = await db().from('immo_listings').update(patch, { count: 'exact' }).eq('id', id);
    if (error) throw new Error(error.message);
    if (!count) throw new Error('Annonce introuvable.');

    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
  }
}
