-- Rebsorten mit Prozentanteil, optional pro Jahrgang (Cuvées ändern sich von Jahr zu Jahr)
create table public.wine_grape_shares (
  id           uuid primary key default gen_random_uuid(),
  wine_id      uuid not null references public.wines(id) on delete cascade,
  vintage_year integer check (vintage_year between 1800 and 2100),
  grape        text not null check (btrim(grape) <> ''),
  percent      numeric(5,2) check (percent > 0 and percent <= 100),
  sort_order   smallint not null default 0,
  source       text not null default 'manual' check (source in ('import','label','research','manual')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index wine_grape_shares_uq
  on public.wine_grape_shares (wine_id, coalesce(vintage_year, 0), lower(grape));
create index wine_grape_shares_grape_idx on public.wine_grape_shares (lower(grape));

create trigger wine_grape_shares_set_updated_at
  before update on public.wine_grape_shares
  for each row execute function public.set_updated_at();

alter table public.wine_grape_shares enable row level security;
create policy wine_grape_shares_members_all on public.wine_grape_shares
  for all to authenticated using (private.is_member()) with check (private.is_member());

-- Bestehende Rebsorten übernehmen (ohne Prozent, ohne Jahrgang)
insert into public.wine_grape_shares (wine_id, vintage_year, grape, percent, sort_order, source)
select w.id, null, g.grape, null, (g.ord - 1)::smallint, 'import'
from public.wines w
cross join lateral unnest(w.grapes) with ordinality as g(grape, ord)
where btrim(g.grape) <> ''
on conflict do nothing;
