alter table public.wine_tastings drop constraint if exists wine_tastings_quality_points_check;
alter table public.wine_tastings alter column quality_points type numeric(2,1) using quality_points::numeric;
alter table public.wine_tastings add constraint wine_tastings_quality_points_check
  check (quality_points between 0 and 4 and quality_points * 2 = round(quality_points * 2));
