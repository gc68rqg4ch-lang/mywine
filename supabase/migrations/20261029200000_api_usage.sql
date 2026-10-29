-- API-Kosten messen und begrenzen: je Claude-Aufruf (auch jede Runde einer Websuche) eine Zeile
-- mit Zweck, Modell, Tokens, Websuchen und den in der App berechneten Kosten (Preistabelle im
-- Code, src/lib/ai/cost.ts). Lesen nur Mitglieder, schreiben nur service_role (die App
-- protokolliert mit dem Admin-Client). Einträge älter als 400 Tage räumt pg_cron täglich auf.
-- Dazu je Monat eine einmalige Budget-Erhöhung und der Tag der letzten Budget-Meldung.

create table if not exists public.api_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  purpose text not null check (purpose in (
    'recognize', 'chat', 'research_wine', 'research_taste', 'research_window', 'research_keep',
    'research_price', 'daily_note', 'other'
  )),
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  web_searches integer not null default 0,
  web_fetches integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  wine_id uuid references public.wines (id) on delete set null,
  -- z. B. research_jobs.id, bei Testläufen der Preissuche mit „:dry_run“
  job_ref text
);

create index if not exists api_usage_created on public.api_usage (created_at);
create index if not exists api_usage_wine on public.api_usage (wine_id) where wine_id is not null;

alter table public.api_usage enable row level security;
drop policy if exists api_usage_members_read on public.api_usage;
create policy api_usage_members_read on public.api_usage
  for select to authenticated using (private.is_member());
-- Keine Schreib-Policy: nur service_role.

-- Monatsbudget: Grundbetrag aus API_MONTHLY_BUDGET_USD (App), dazu einmalige Erhöhungen je Monat.
create table if not exists public.api_budget (
  -- Erster Tag des Monats (Zeitzone Europe/Zurich)
  month date primary key,
  extra_usd numeric(10, 2) not null default 0 check (extra_usd >= 0),
  -- Tag der letzten Meldung „Budget erreicht“ (höchstens einmal pro Tag)
  notified_on date,
  updated_at timestamptz not null default now()
);

alter table public.api_budget enable row level security;
drop policy if exists api_budget_members_all on public.api_budget;
create policy api_budget_members_all on public.api_budget
  for all to authenticated using (private.is_member()) with check (private.is_member());

-- Summen je Zweck im Zeitraum (ohne 1000-Zeilen-Grenze der REST-API); RLS gilt (security invoker).
create or replace function public.api_cost_by_purpose(p_from timestamptz, p_to timestamptz)
returns table (purpose text, calls bigint, cost_usd numeric, web_searches bigint)
language sql
stable
security invoker
set search_path to ''
as $$
  select u.purpose, count(*), coalesce(sum(u.cost_usd), 0), coalesce(sum(u.web_searches), 0)
    from public.api_usage u
   where u.created_at >= p_from and u.created_at < p_to
   group by u.purpose
   order by 3 desc;
$$;

grant execute on function public.api_cost_by_purpose(timestamptz, timestamptz) to authenticated, service_role;

-- Aufräumen: Einträge älter als 400 Tage, täglich.
select cron.schedule('cleanup-api-usage', '25 3 * * *',
  $$delete from public.api_usage where created_at < now() - interval '400 days'$$);
