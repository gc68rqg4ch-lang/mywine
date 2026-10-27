alter table public.wine_tastings drop constraint if exists wine_tastings_source_check;
alter table public.wine_tastings add constraint wine_tastings_source_check
  check (source in ('app','import','bot'));
