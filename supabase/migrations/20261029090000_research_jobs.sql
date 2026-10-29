-- Recherche im Hintergrund: Warteschlange für 🔎 auf der Weinseite und den Sammellauf auf
-- /recherche. Ein Worker (API-Route /api/research/worker, jede Minute von pg_cron über pg_net
-- aufgerufen) arbeitet die Aufträge nacheinander ab – nie parallel: Er braucht die Sperre in
-- research_worker_lock (eine Zeile, mit Ablaufzeit), Aufträge holt er mit „for update skip locked“.
-- Mitglieder (private.is_member()) sehen und verwalten die Aufträge; der Worker nutzt service_role.

create table if not exists public.research_jobs (
  id uuid primary key default gen_random_uuid(),
  -- Ein Lauf: alle Aufträge eines „Start“ im Sammellauf bzw. ein 🔎 auf der Weinseite.
  run_id uuid not null,
  wine_id uuid not null references public.wines (id) on delete cascade,
  -- Gesuchter Jahrgang (Anzeige); die genauen Angaben stehen in params.
  vintage_year integer,
  -- page = 🔎 auf der Weinseite, research = Sammellauf (alle Angaben bzw. nur Profil), window = nur Trinkfenster.
  kind text not null check (kind in ('page', 'research', 'window')),
  -- Umfang, Profil-Modus, Jahrgang(e), 12-Monats-Regel – wie bisher an die Recherche übergeben.
  params jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'skipped')),
  -- Angehalten (z. B. 'usage_limit'): bleibt queued, wird erst nach „Fortsetzen“ wieder abgearbeitet.
  hold text,
  attempts integer not null default 0,
  -- Ergebnis kurz (Text) und für die Meldung (ergänzt, Profil, Trinkfenster, Vorschläge).
  summary text,
  result jsonb,
  error text,
  created_by uuid references public.persons (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  -- Telegram-Meldung zum Lauf verschickt (am letzten Auftrag des Laufs vermerkt).
  notified_at timestamptz
);

create index if not exists research_jobs_queue on public.research_jobs (created_at, position) where status = 'queued' and hold is null;
create index if not exists research_jobs_run on public.research_jobs (run_id);
create index if not exists research_jobs_wine_open on public.research_jobs (wine_id) where status in ('queued', 'running');

alter table public.research_jobs enable row level security;
drop policy if exists research_jobs_members_all on public.research_jobs;
create policy research_jobs_members_all on public.research_jobs
  for all to authenticated using (private.is_member()) with check (private.is_member());

-- Sperre des Workers: höchstens einer arbeitet; läuft nach p_seconds ab (abgestürzter Aufruf).
create table if not exists public.research_worker_lock (
  id integer primary key check (id = 1),
  owner uuid,
  locked_until timestamptz
);
insert into public.research_worker_lock (id) values (1) on conflict (id) do nothing;
alter table public.research_worker_lock enable row level security;
-- Keine Policy: nur service_role (über die Funktionen unten).

create or replace function public.acquire_research_worker(p_owner uuid, p_seconds integer)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.research_worker_lock
     set owner = p_owner, locked_until = now() + make_interval(secs => p_seconds)
   where id = 1 and (locked_until is null or locked_until < now() or owner = p_owner);
  return found;
end;
$$;

create or replace function public.release_research_worker(p_owner uuid)
returns void
language sql
security definer
set search_path to ''
as $$
  update public.research_worker_lock set owner = null, locked_until = null where id = 1 and owner = p_owner;
$$;

-- Nächsten Auftrag übernehmen (nur mit gültiger Sperre): ältester offener, nicht angehaltener.
create or replace function public.claim_research_job(p_owner uuid)
returns setof public.research_jobs
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not exists (
    select 1 from public.research_worker_lock where id = 1 and owner = p_owner and locked_until > now()
  ) then
    return;
  end if;
  return query
    update public.research_jobs j
       set status = 'running', started_at = now(), attempts = j.attempts + 1
     where j.id = (
       select q.id from public.research_jobs q
        where q.status = 'queued' and q.hold is null
        order by q.created_at, q.position, q.id
        limit 1
        for update skip locked
     )
    returning j.*;
end;
$$;

-- Aufräumen: erledigte, gescheiterte und übersprungene Aufträge älter als 30 Tage löschen
-- (der Cron dafür wird separat eingerichtet). Gibt die Zahl gelöschter Aufträge zurück.
create or replace function public.cleanup_research_jobs()
returns integer
language sql
security definer
set search_path to ''
as $$
  with gone as (
    delete from public.research_jobs
     where status in ('done', 'failed', 'skipped') and coalesce(finished_at, created_at) < now() - interval '30 days'
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.acquire_research_worker(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_research_worker(uuid) from public, anon, authenticated;
revoke all on function public.claim_research_job(uuid) from public, anon, authenticated;
revoke all on function public.cleanup_research_jobs() from public, anon, authenticated;
grant execute on function public.acquire_research_worker(uuid, integer) to service_role;
grant execute on function public.release_research_worker(uuid) to service_role;
grant execute on function public.claim_research_job(uuid) to service_role;
grant execute on function public.cleanup_research_jobs() to service_role;
