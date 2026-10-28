-- Jahrgang eines Weins holen oder anlegen – sicher auch bei gleichzeitigen Aufrufen (z. B.
-- Geschmacksprofil- und Trinkfenster-Suche nach dem Einbuchen). Der eindeutige Index
-- wine_vintages_uq ist ein Ausdrucks-Index (wine_id, COALESCE(vintage_year, 0)); ein Upsert über
-- supabase-js geht damit nicht. Hier: INSERT … ON CONFLICT DO NOTHING, dann SELECT.
-- Gibt die id des (bestehenden oder neuen) Eintrags zurück. vintage_year NULL = ohne Jahrgang.
create or replace function public.ensure_wine_vintage(p_wine_id uuid, p_vintage_year integer default null)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_id uuid;
begin
  if not private.is_member() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into public.wine_vintages (wine_id, vintage_year)
  values (p_wine_id, p_vintage_year)
  on conflict (wine_id, (coalesce(vintage_year, 0))) do nothing;

  select id into v_id
  from public.wine_vintages
  where wine_id = p_wine_id and vintage_year is not distinct from p_vintage_year;

  return v_id;
end;
$function$;

revoke all on function public.ensure_wine_vintage(uuid, integer) from public, anon;
grant execute on function public.ensure_wine_vintage(uuid, integer) to authenticated, service_role;
