-- Personen (für getrennte Bewertungen), optional mit Login verknüpft
create table public.persons (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> ''),
  user_id    uuid unique references auth.users(id) on delete set null,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);
create unique index persons_name_uq on public.persons (lower(name));

-- Subjektive Bewertung pro Person (mehrere Bewertungen über die Zeit möglich)
create table public.wine_ratings (
  id                uuid primary key default gen_random_uuid(),
  wine_id           uuid not null references public.wines(id) on delete cascade,
  vintage_year      integer check (vintage_year between 1800 and 2100),
  person_id         uuid not null references public.persons(id) on delete cascade,
  rating            numeric(2,1) not null check (rating between 0 and 5 and rating * 2 = round(rating * 2)),
  rated_at          date not null default current_date,
  note              text,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  source            text not null default 'manual' check (source in ('manual','import','bot')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index wine_ratings_wine_idx on public.wine_ratings (wine_id, vintage_year, person_id, rated_at desc);
create index wine_ratings_person_idx on public.wine_ratings (person_id);
create index wine_ratings_item_idx on public.wine_ratings (inventory_item_id);
create trigger wine_ratings_set_updated_at before update on public.wine_ratings
  for each row execute function public.set_updated_at();

-- Aktuellste Bewertung je Wein/Jahrgang/Person
create view public.latest_wine_ratings with (security_invoker = true) as
select distinct on (r.wine_id, coalesce(r.vintage_year, 0), r.person_id)
  r.wine_id, r.vintage_year, r.person_id, p.name as person_name, r.rating, r.rated_at, r.note
from public.wine_ratings r
join public.persons p on p.id = r.person_id
order by r.wine_id, coalesce(r.vintage_year, 0), r.person_id, r.rated_at desc, r.created_at desc;

-- Objektive Verkostung nach WSET Level 3 SAT (Struktur wie im bestehenden Verkostungs-Tool)
create table public.wine_tastings (
  id                uuid primary key default gen_random_uuid(),
  wine_id           uuid not null references public.wines(id) on delete cascade,
  vintage_year      integer check (vintage_year between 1800 and 2100),
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  person_id         uuid references public.persons(id) on delete set null,
  tasted_at         date not null default current_date,
  wine_style        text check (wine_style in ('Rotwein','Weisswein','Rosé','Schaumwein','Gespritete & Süssweine')),
  quality_level     text check (quality_level in ('fehlerhaft','schwach','durchschnittlich','gut','sehr gut','hervorragend')),
  quality_points    smallint check (quality_points between 0 and 4),
  readiness         text check (readiness in (
                      'zu jung',
                      'kann jetzt getrunken werden, hat aber noch Reifungspotenzial',
                      'jetzt trinken: nicht für Alterung oder weitere Lagerung geeignet',
                      'zu alt')),
  sat               jsonb not null default '{}'::jsonb,
  notes             text,
  place_id          uuid references public.places(id) on delete set null,
  source            text not null default 'app' check (source in ('app','import')),
  tool_version      text not null default 'wset_l3_sat_v1',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index wine_tastings_wine_idx on public.wine_tastings (wine_id, vintage_year, tasted_at desc);
create index wine_tastings_item_idx on public.wine_tastings (inventory_item_id);
create index wine_tastings_person_idx on public.wine_tastings (person_id);
create index wine_tastings_place_idx on public.wine_tastings (place_id);
create trigger wine_tastings_set_updated_at before update on public.wine_tastings
  for each row execute function public.set_updated_at();

alter table public.persons       enable row level security;
alter table public.wine_ratings  enable row level security;
alter table public.wine_tastings enable row level security;
create policy persons_members_all       on public.persons       for all to authenticated using (private.is_member()) with check (private.is_member());
create policy wine_ratings_members_all  on public.wine_ratings  for all to authenticated using (private.is_member()) with check (private.is_member());
create policy wine_tastings_members_all on public.wine_tastings for all to authenticated using (private.is_member()) with check (private.is_member());
