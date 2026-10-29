-- ==============================================================================
-- IMMO BREST — Photos, date de publication et analyse IA des annonces
-- ==============================================================================
-- À exécuter dans l'éditeur SQL du projet Supabase partagé (idempotent).
--
--   * photos       : URLs des photos de l'annonce (la première sert de vignette).
--   * published_at : date de (re)publication annoncée par la source (Leboncoin).
--                    Jusqu'ici elle était rangée dans last_seen_at, qui redevient
--                    strictement « dernière fois que le relevé a vu l'annonce ».
--   * ai_analysis  : extraction Gemini (caractéristiques oui/non/inconnu, état,
--                    titre, points forts/faibles) utilisée par le scoring.
-- ==============================================================================

alter table public.immo_listings add column if not exists photos jsonb not null default '[]'::jsonb;
alter table public.immo_listings add column if not exists published_at timestamptz;
alter table public.immo_listings add column if not exists ai_analysis jsonb;

-- Les annonces Leboncoin portaient leur date de publication dans last_seen_at :
-- on la recopie une fois dans published_at (last_seen_at sera corrigé au prochain relevé).
update public.immo_listings
set published_at = last_seen_at
where id like 'leboncoin\_%' and published_at is null and last_seen_at is not null;
