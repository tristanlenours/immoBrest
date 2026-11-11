'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { db } from '@/lib/supabase';
import { mergeLinks, type ExtraLink } from '@/lib/links';

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

    // Remise dans le sas : decided_by reste renseigné pour que le scoring ne l'écarte plus d'office.
    const patch =
      decision === 'sas'
        ? { review_status: 'sas', decided_at: new Date().toISOString(), decided_by: 'web', reject_reason: null }
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

type LinkRow = { id: string; ref: string | null; url: string | null; additional_links: ExtraLink[] | null; duplicate_suspects: { id: string; reason: string }[] | null; duplicate_dismissed: string[] | null };

async function readLinkRow(id: string): Promise<LinkRow> {
  const { data, error } = await db()
    .from('immo_listings')
    .select('id, ref, url, additional_links, duplicate_suspects, duplicate_dismissed')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Annonce introuvable : ${id}`);
  return data as LinkRow;
}

// Doublon confirmé : l'annonce du sas part en corbeille (motif « Doublon de … ») et ses liens
// (Leboncoin, Agence Henry…) sont ajoutés à l'annonce gardée, pour les retrouver sur sa fiche.
export async function confirmDuplicate(id: string, keptId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await assertSession();
    if (id === keptId) throw new Error('Une annonce ne peut pas être son propre doublon.');
    const [duplicate, kept] = await Promise.all([readLinkRow(id), readLinkRow(keptId)]);

    const { error: linkError } = await db().from('immo_listings').update(mergeLinks(kept, duplicate)).eq('id', keptId);
    if (linkError) throw new Error(linkError.message);

    const { error } = await db()
      .from('immo_listings')
      .update({
        review_status: 'rejected',
        decided_at: new Date().toISOString(),
        decided_by: 'web',
        reject_reason: `Doublon de ${kept.ref ?? kept.id}`,
        duplicate_suspects: []
      })
      .eq('id', id);
    if (error) throw new Error(error.message);

    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
  }
}

// « Pas un doublon » : le signalement disparaît et ne sera plus refait par les relevés suivants.
export async function dismissDuplicate(id: string, otherId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await assertSession();
    const row = await readLinkRow(id);
    const { error } = await db()
      .from('immo_listings')
      .update({
        duplicate_suspects: (row.duplicate_suspects ?? []).filter(s => s.id !== otherId),
        duplicate_dismissed: [...new Set([...(row.duplicate_dismissed ?? []), otherId])]
      })
      .eq('id', id);
    if (error) throw new Error(error.message);

    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
  }
}
