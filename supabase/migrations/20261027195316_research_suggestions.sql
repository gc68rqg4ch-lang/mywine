-- Vorschläge aus der Recherche, wenn ein gefundener Wert von einem gespeicherten abweicht.
-- Leere Felder füllt die Recherche weiter direkt; hier landen nur Abweichungen zur Entscheidung.
create table public.research_suggestions (
  id uuid primary key default gen_random_uuid(),
  wine_id uuid not null references public.wines(id) on delete cascade,
  vintage_year integer,                       -- null = gilt für den Wein bzw. alle Jahrgänge
  field text not null check (field in (
    'producer','country','region','appellation','type','alcohol_content',
    'drink_from_year','drink_until_year','grapes')),
  current_value jsonb,                        -- gespeicherter Wert beim Vorschlag
  suggested_value jsonb not null,             -- gefundener Wert (grapes: [{grape, percent}])
  source_note text,                           -- kurze Quelle/Begründung aus der Recherche
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.persons(id) on delete set null
);

-- höchstens ein offener Vorschlag pro Wein/Jahrgang/Feld
create unique index research_suggestions_one_pending
  on public.research_suggestions (wine_id, coalesce(vintage_year, 0), field)
  where status = 'pending';
create index research_suggestions_pending_idx on public.research_suggestions (status, created_at desc);

alter table public.research_suggestions enable row level security;
create policy research_suggestions_members_all on public.research_suggestions
  for all to authenticated using (private.is_member()) with check (private.is_member());

comment on table public.research_suggestions is
  'Abweichungen zwischen Recherche und gespeicherten Angaben; der Nutzer entscheidet pro Zeile (accepted = übernommen, rejected = behalten).';
