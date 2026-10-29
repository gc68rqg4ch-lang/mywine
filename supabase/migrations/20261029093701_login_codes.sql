-- Login mit 6-stelligem Code von Antoine (Telegram) – neben dem Magic Link. Gespeichert wird nur
-- ein HMAC-SHA256 des Codes (Server-Secret LOGIN_CODE_SECRET), mit Ablaufzeit (10 Min.),
-- Versuchszähler (höchstens 5) und Zeitpunkt der Verwendung (einmalig). Ein neuer Code macht den
-- alten ungültig (invalidated_at). Nur der Server (service_role) liest und schreibt; RLS ohne
-- Policy, kein Zugriff für anon/authenticated.

create table if not exists public.login_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists login_codes_user_created on public.login_codes (user_id, created_at desc);

alter table public.login_codes enable row level security;
revoke all on table public.login_codes from anon, authenticated;
grant all on table public.login_codes to service_role;

-- Aufräumen: Codes löschen, die seit über einem Tag abgelaufen sind (die letzten 15 Minuten
-- braucht die Begrenzung „höchstens 5 Anforderungen“). Gibt die Zahl gelöschter Codes zurück.
-- Der Cron dafür wird separat eingerichtet.
create or replace function public.cleanup_login_codes()
returns integer
language sql
security definer
set search_path to ''
as $$
  with gone as (
    delete from public.login_codes where expires_at < now() - interval '1 day' returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.cleanup_login_codes() from public, anon, authenticated;
grant execute on function public.cleanup_login_codes() to service_role;
