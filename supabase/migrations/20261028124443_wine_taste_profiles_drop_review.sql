-- Keine Freigabe nötig: gefundene Profile gelten sofort
alter table public.wine_taste_profiles
  drop column status,
  drop column decided_by,
  drop column decided_at;
