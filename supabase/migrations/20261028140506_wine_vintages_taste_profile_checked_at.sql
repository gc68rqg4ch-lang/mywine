-- Wann zuletzt nach einem Geschmacksprofil für diesen Jahrgang gesucht wurde (auch ohne Fund)
alter table public.wine_vintages
  add column taste_profile_checked_at timestamptz;

-- Bestehende Profile als geprüft markieren
update public.wine_vintages v
   set taste_profile_checked_at = p.researched_at
  from public.wine_taste_profiles p
 where p.wine_id = v.wine_id
   and p.vintage_year is not distinct from v.vintage_year
   and p.researched_at is not null;
