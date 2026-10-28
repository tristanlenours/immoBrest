-- ==============================================================================
-- IMMO BREST — Schéma PostgreSQL Supabase (cohabitation DraftMaster + Quiz)
-- ==============================================================================
-- Toutes les tables et fonctions sont préfixées par `immo_` afin de cohabiter
-- sans collision avec `quiz_*` (Quiz) et les tables de DraftMaster.
--
-- À exécuter dans l'éditeur SQL du projet Supabase partagé (pas de `supabase db push` :
-- l'historique de migrations est tenu par les dépôts Quiz et DraftMaster).
-- Le script est idempotent.
--
-- Modèle d'accès :
--   * le pipeline (scrapers, migration, notifications) utilise la clé service_role ;
--   * le site utilise la clé anon + Supabase Auth ; seuls les e-mails listés dans
--     `immo_allowed_emails` lisent les données ou modèrent le sas ;
--   * aucune écriture directe depuis le site : la modération passe par la RPC
--     `immo_review_listing`.
-- ==============================================================================

-- 1. E-mails autorisés à consulter et modérer -----------------------------------
create table if not exists public.immo_allowed_emails (
    email text primary key check (email = lower(email)),
    created_at timestamptz default now() not null
);

insert into public.immo_allowed_emails (email) values
    ('tristan.lenours@gmail.com'),
    ('lyra.titou@gmail.com')
on conflict do nothing;

create or replace function public.immo_is_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.immo_allowed_emails
        where email = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

-- 2. Annonces ------------------------------------------------------------------
-- `id` reprend le nom de dossier actuel (ex. leboncoin_3230023834, henry_86332541).
-- review_status : 'sas' (en attente de modération), 'approved' (base active),
--                 'rejected' (corbeille, sert d'anti-doublon).
-- market_status : statut du bien sur le marché ('Actif', 'Vendu ou retiré de la vente'...).
create table if not exists public.immo_listings (
    id text primary key,
    source text not null,
    review_status text not null default 'sas'
        check (review_status in ('sas', 'approved', 'rejected')),
    market_status text not null default 'Actif',
    title text not null,
    type text,
    quartier text,
    tier smallint,
    location text,
    price integer,
    surface numeric,
    pieces smallint,
    chambres smallint,
    floor text,
    prestations text,
    description text,
    url text,
    additional_links jsonb not null default '[]'::jsonb,
    score numeric,
    score_criteria jsonb not null default '[]'::jsonb,
    notes text,
    first_seen_at timestamptz,
    last_seen_at timestamptz,
    notified_at timestamptz,
    decided_at timestamptz,
    decided_by text,
    reject_reason text,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null
);

create index if not exists immo_listings_review_status_idx on public.immo_listings (review_status);
create index if not exists immo_listings_pending_notification_idx
    on public.immo_listings (created_at)
    where review_status = 'sas' and notified_at is null;
create index if not exists immo_listings_url_idx on public.immo_listings (url);

-- 3. Historique des relevés (prix, score, statut) ---------------------------------
create table if not exists public.immo_price_history (
    id bigint generated always as identity primary key,
    listing_id text not null references public.immo_listings(id) on delete cascade on update cascade,
    seen_at timestamptz not null,
    price integer,
    score numeric,
    market_status text,
    unique (listing_id, seen_at)
);

create index if not exists immo_price_history_listing_idx on public.immo_price_history (listing_id, seen_at);

-- 4. Ventes réelles DVF (DGFiP) ----------------------------------------------------
create table if not exists public.immo_dvf_sales (
    id text primary key,
    sale_date date not null,
    type text,
    adresse text,
    code_postal text,
    prix integer,
    surface numeric,
    surface_carrez numeric,
    pieces smallint,
    lat double precision,
    lon double precision,
    nb_lots smallint,
    prix_m2 integer
);

create index if not exists immo_dvf_sales_date_idx on public.immo_dvf_sales (sale_date);

-- 5. Journal d'exécution des pipelines (alerte en cas de panne) ------------------
create table if not exists public.immo_run_log (
    id bigint generated always as identity primary key,
    pipeline text not null,                -- 'leboncoin-local', 'cloud-sources', 'notify'...
    started_at timestamptz default now() not null,
    finished_at timestamptz,
    status text not null default 'running' check (status in ('running', 'success', 'error')),
    stats jsonb not null default '{}'::jsonb,
    error text
);

create index if not exists immo_run_log_pipeline_idx on public.immo_run_log (pipeline, started_at desc);

-- 6. Mise à jour automatique de updated_at ------------------------------------------
create or replace function public.immo_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists immo_listings_touch_updated_at on public.immo_listings;
create trigger immo_listings_touch_updated_at
    before update on public.immo_listings
    for each row execute function public.immo_touch_updated_at();

-- 7. Modération depuis le site (RPC) -------------------------------------------------
create or replace function public.immo_review_listing(
    p_listing_id text,
    p_decision text,
    p_reason text default null
)
returns public.immo_listings
language plpgsql
security definer
set search_path = public
as $$
declare
    result public.immo_listings;
begin
    if not public.immo_is_allowed() then
        raise exception 'immo_review_listing: accès refusé' using errcode = '42501';
    end if;

    if p_decision not in ('approved', 'rejected') then
        raise exception 'immo_review_listing: décision invalide (%)', p_decision using errcode = '22023';
    end if;

    update public.immo_listings
    set review_status = p_decision,
        decided_at = now(),
        decided_by = lower(auth.jwt() ->> 'email'),
        reject_reason = case when p_decision = 'rejected' then p_reason else null end
    where id = p_listing_id
    returning * into result;

    if not found then
        raise exception 'immo_review_listing: annonce introuvable (%)', p_listing_id using errcode = 'P0002';
    end if;

    return result;
end;
$$;

revoke all on function public.immo_review_listing(text, text, text) from public, anon;
grant execute on function public.immo_review_listing(text, text, text) to authenticated;

-- 8. Row Level Security -----------------------------------------------------------
alter table public.immo_allowed_emails enable row level security;
alter table public.immo_listings enable row level security;
alter table public.immo_price_history enable row level security;
alter table public.immo_dvf_sales enable row level security;
alter table public.immo_run_log enable row level security;

-- Lecture réservée aux e-mails autorisés ; aucune politique d'écriture (service_role
-- contourne RLS, la modération passe par la RPC security definer).
drop policy if exists immo_listings_select on public.immo_listings;
create policy immo_listings_select on public.immo_listings
    for select to authenticated using (public.immo_is_allowed());

drop policy if exists immo_price_history_select on public.immo_price_history;
create policy immo_price_history_select on public.immo_price_history
    for select to authenticated using (public.immo_is_allowed());

drop policy if exists immo_dvf_sales_select on public.immo_dvf_sales;
create policy immo_dvf_sales_select on public.immo_dvf_sales
    for select to authenticated using (public.immo_is_allowed());

-- immo_allowed_emails et immo_run_log : aucune politique => service_role uniquement.

revoke all on public.immo_allowed_emails, public.immo_listings, public.immo_price_history,
    public.immo_dvf_sales, public.immo_run_log from anon;
grant select on public.immo_listings, public.immo_price_history, public.immo_dvf_sales to authenticated;
