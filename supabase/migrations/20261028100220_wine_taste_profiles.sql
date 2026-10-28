-- Geschmacksprofil aus Recherche, gleiche Begriffe wie das WSET-Tool (SAT)
create table public.wine_taste_profiles (
  id uuid primary key default gen_random_uuid(),
  wine_id uuid not null references public.wines(id) on delete cascade,
  vintage_year integer,
  sweetness text,          -- wie sat.fields.suesse
  acidity text,            -- wie sat.fields.saeure
  tannin text,             -- wie sat.fields.tannin
  alcohol text,
  body text,               -- wie sat.fields.koerper
  flavour_intensity text,  -- wie sat.fields.geschmackIntensitaet
  finish text,             -- wie sat.fields.abgang
  aromas jsonb not null default '{}'::jsonb,  -- { "Gruppe": ["Aroma", ...] } wie sat.aromas
  style_summary text,
  food_pairing text[] not null default '{}',
  source text not null default 'research' check (source in ('research','manual')),
  source_note text,
  researched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wine_taste_profiles_wine_vintage_key unique nulls not distinct (wine_id, vintage_year)
);

alter table public.wine_taste_profiles enable row level security;
create policy wine_taste_profiles_members_all on public.wine_taste_profiles
  for all to authenticated using (private.is_member()) with check (private.is_member());

create trigger wine_taste_profiles_set_updated_at before update on public.wine_taste_profiles
  for each row execute function public.set_updated_at();
