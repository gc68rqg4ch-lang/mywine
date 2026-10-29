-- Startseite: Antoines Tagestext pro Person und Tag (Europe/Zurich), von Claude geschrieben.
-- Erzeugt jeden Morgen um 05:00 über die Route /api/home/daily (pg_cron über pg_net); fehlt er
-- beim Öffnen, holt die App ihn einmal im Hintergrund nach. text enthält Platzhalter {{W1}} …
-- für Weine; wines ordnet sie Wein und Jahrgang zu (die App macht daraus Links).
-- status: pending (wird gerade geschrieben), done, failed (z. B. API-Limit – dann bis morgen der
-- Ersatztext, kein neuer Versuch). Mitglieder (private.is_member()) lesen und schreiben.

create table if not exists public.daily_notes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons (id) on delete cascade,
  note_date date not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  text text,
  -- [{ "ref": "W1", "wine_id": "…", "vintage_year": 2019, "name": "Pintia 2019" }, …]
  wines jsonb not null default '[]'::jsonb,
  model text,
  error text,
  created_at timestamptz not null default now(),
  generated_at timestamptz,
  unique (person_id, note_date)
);

create index if not exists daily_notes_person_date on public.daily_notes (person_id, note_date desc);

alter table public.daily_notes enable row level security;
drop policy if exists daily_notes_members_all on public.daily_notes;
create policy daily_notes_members_all on public.daily_notes
  for all to authenticated using (private.is_member()) with check (private.is_member());

-- Aufräumen: Tagestexte älter als 60 Tage löschen (der Cron dafür wird separat eingerichtet).
create or replace function public.cleanup_daily_notes()
returns integer
language sql
security definer
set search_path to ''
as $$
  with gone as (
    delete from public.daily_notes where note_date < (now() at time zone 'Europe/Zurich')::date - 60 returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.cleanup_daily_notes() from public, anon, authenticated;
grant execute on function public.cleanup_daily_notes() to service_role;
