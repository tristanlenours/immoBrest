-- ==============================================================================
-- IMMO BREST — Référence lisible des annonces (ex. A20261107, M20261029-2)
-- ==============================================================================
-- À exécuter dans l'éditeur SQL du projet Supabase partagé (idempotent).
--
--   ref = lettre du type (A appartement, M maison) + date d'arrivée dans la base
--         (first_seen_at, jour de Paris, AAAAMMJJ), puis « -2 », « -3 »… quand
--         plusieurs annonces du même type arrivent le même jour.
--   * attribuée une fois pour toutes à l'insertion (trigger) : elle ne change ni
--     avec le type, ni avec un renommage de l'identifiant technique `id` ;
--   * unique sur toute la table (base active, sas, corbeille).
-- ==============================================================================

alter table public.immo_listings add column if not exists ref text;
create unique index if not exists immo_listings_ref_key on public.immo_listings (ref);

create or replace function public.immo_next_ref(p_type text, p_first_seen timestamptz)
returns text
language plpgsql
set search_path = public
as $$
declare
    base text;
    last_index integer;
begin
    base := (case when p_type ilike 'maison%' then 'M' else 'A' end)
         || to_char(coalesce(p_first_seen, now()) at time zone 'Europe/Paris', 'YYYYMMDD');

    -- Sérialise les attributions d'un même préfixe (insertions concurrentes).
    perform pg_advisory_xact_lock(hashtext('immo_ref:' || base));

    -- Plus grand indice déjà attribué (la référence sans suffixe vaut 1). On part du
    -- maximum et non du nombre : une annonce supprimée ne libère pas son indice.
    select max(case when ref = base then 1 else split_part(ref, '-', 2)::integer end)
      into last_index
      from public.immo_listings
     where ref = base or ref ~ ('^' || base || '-[0-9]+$');

    return case when last_index is null then base else base || '-' || (last_index + 1) end;
end;
$$;

create or replace function public.immo_listings_set_ref()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.ref is null then
        new.ref := public.immo_next_ref(new.type, coalesce(new.first_seen_at, new.created_at, now()));
    end if;
    return new;
end;
$$;

drop trigger if exists immo_listings_set_ref on public.immo_listings;
create trigger immo_listings_set_ref
    before insert on public.immo_listings
    for each row execute function public.immo_listings_set_ref();

-- Annonces existantes : attribution dans l'ordre d'arrivée.
do $$
declare
    r record;
begin
    for r in
        select id, type, coalesce(first_seen_at, created_at) as seen
          from public.immo_listings
         where ref is null
         order by coalesce(first_seen_at, created_at), id
    loop
        update public.immo_listings
           set ref = public.immo_next_ref(r.type, r.seen)
         where id = r.id;
    end loop;
end;
$$;
