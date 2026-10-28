-- Nachvollziehbarkeit: Quellen, Belege pro Angabe, Sicherheit, Status
alter table public.wine_taste_profiles
  add column sources jsonb not null default '[]'::jsonb,   -- [{url, title, kind: producer|critic|merchant|other, vintage}]
  add column evidence jsonb not null default '{}'::jsonb,  -- {feld oder aroma: [{source_url, quote}]}
  add column confidence text check (confidence in ('hoch','mittel','niedrig')),
  add column status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  add column decided_by uuid references public.persons(id) on delete set null,
  add column decided_at timestamptz;
