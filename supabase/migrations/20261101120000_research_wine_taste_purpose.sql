-- api_usage: neuer Zweck „research_wine_taste“ – Stammdaten und Geschmacksprofil in einem
-- gemeinsamen Recherche-Aufruf (statt zwei). Vorher/nachher vergleichbar auf /recherche.
-- Bis zum Einspielen zählt die App den Aufruf als „research_wine“.

alter table public.api_usage drop constraint if exists api_usage_purpose_check;
alter table public.api_usage add constraint api_usage_purpose_check check (purpose in (
  'recognize', 'chat', 'research_wine', 'research_taste', 'research_wine_taste', 'research_window',
  'research_keep', 'research_price', 'daily_note', 'other'
));
