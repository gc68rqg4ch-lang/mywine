-- Ersetzt die Rebsorten eines Weins (für einen Jahrgang oder allgemein) atomar.
-- p_shares: [{"grape": "Merlot", "percent": 60, "sort_order": 0, "source": "research"}, ...]
create or replace function public.replace_grape_shares(
  p_wine_id uuid,
  p_vintage_year integer,
  p_shares jsonb
)
returns setof public.wine_grape_shares
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_member() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_shares, '[]'::jsonb)) <> 'array' then
    raise exception 'p_shares must be a JSON array' using errcode = '22023';
  end if;

  delete from public.wine_grape_shares
  where wine_id = p_wine_id
    and vintage_year is not distinct from p_vintage_year;

  return query
  insert into public.wine_grape_shares (wine_id, vintage_year, grape, percent, sort_order, source)
  select p_wine_id,
         p_vintage_year,
         btrim(e->>'grape'),
         nullif(e->>'percent', '')::numeric,
         coalesce((e->>'sort_order')::smallint, (ord - 1)::smallint),
         coalesce(e->>'source', 'manual')
  from jsonb_array_elements(coalesce(p_shares, '[]'::jsonb)) with ordinality as t(e, ord)
  where btrim(coalesce(e->>'grape', '')) <> ''
  returning *;
end;
$$;

revoke execute on function public.replace_grape_shares(uuid, integer, jsonb) from public, anon;
grant execute on function public.replace_grape_shares(uuid, integer, jsonb) to authenticated, service_role;
