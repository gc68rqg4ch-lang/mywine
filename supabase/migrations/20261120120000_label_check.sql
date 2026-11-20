-- Prüfschritt der Namen beim Einbuchen (Sonnet 5.5):
-- - api_usage: neuer Zweck „label_check“ (Kosten getrennt von der Erkennung sichtbar auf
--   /recherche). Bis zum Einspielen zählt die App den Aufruf als „recognize“.
-- - research_jobs: neue Auftragsart „label_check“ – Testlauf (dry_run) von Erkennung, Recherche
--   und Prüfschritt mit den gespeicherten Fotos einer Erfassung, ohne zu speichern oder zu senden.

alter table public.api_usage drop constraint if exists api_usage_purpose_check;
alter table public.api_usage add constraint api_usage_purpose_check check (purpose in (
  'recognize', 'label_check', 'chat', 'research_wine', 'research_taste', 'research_wine_taste', 'research_window',
  'research_keep', 'research_price', 'daily_note', 'other'
));

alter table public.research_jobs drop constraint if exists research_jobs_kind_check;
alter table public.research_jobs add constraint research_jobs_kind_check check (kind in (
  'page', 'research', 'window', 'keep', 'price', 'label_check'
));
