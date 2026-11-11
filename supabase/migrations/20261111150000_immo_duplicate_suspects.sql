-- Doublons possibles signalés à l'arrivée dans le sas, tranchés à la main dans l'app.
--   duplicate_suspects  : [{ "id": "<annonce>", "reason": "<ressemblances>" }], recalculé à chaque relevé
--   duplicate_dismissed : annonces jugées « pas un doublon », jamais resignalées
alter table immo_listings add column if not exists duplicate_suspects jsonb not null default '[]'::jsonb;
alter table immo_listings add column if not exists duplicate_dismissed text[] not null default '{}';
