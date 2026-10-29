-- Spirituosen: kein Zustand „offen“ wie bei Wein. Im Bestand ist von jeder Spirituose (je
-- Flaschengrösse) genau eine Flasche die „aktuelle“ (status open + Füllstand in
-- open_bottle_details), die übrigen sind voll (sealed); leer = drunk.
--   ensure_spirit_current: gibt es keine aktuelle Flasche, wird eine volle aktuell (100 %,
--     heute) – z. B. nach dem Einbuchen. Eine vorhandene bleibt unverändert.
--   spirit_bottle_empty: aktuelle Flasche leer (drunk) und – falls noch eine volle da ist – die
--     nächste aktuell, in einer Transaktion. Liefert { next_id, remaining }.
-- Beide wie open_bottle: nur Mitglieder bzw. der Server (service_role). Zum Schluss erhalten
-- schon erfasste Spirituosen ohne aktuelle Flasche eine.

create or replace function public.ensure_spirit_current(p_wine_id uuid, p_bottle_size_ml integer default null)
returns uuid
language plpgsql
set search_path to ''
as $$
declare
  v_type text;
  v_current uuid;
  v_batch public.inventory_items;
  v_size integer;
begin
  if not private.is_member() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Je Spirituose nacheinander (sperrt den Wein).
  select w.type::text into v_type from public.wines w where w.id = p_wine_id for update;
  if not found or v_type is distinct from 'spirit' then
    return null;
  end if;

  -- Grösse: angegeben, sonst die der ältesten vollen Charge bzw. der aktuellen Flasche.
  v_size := p_bottle_size_ml;

  select i.id into v_current
  from public.inventory_items i
  where i.wine_id = p_wine_id and i.status = 'open'
    and (v_size is null or i.bottle_size_ml is not distinct from v_size)
  order by i.created_at
  limit 1;
  if v_current is not null then
    return v_current;
  end if;

  select * into v_batch
  from public.inventory_items i
  where i.wine_id = p_wine_id and i.status = 'sealed' and i.quantity > 0
    and (v_size is null or i.bottle_size_ml is not distinct from v_size)
  order by i.purchased_at nulls first, i.created_at
  limit 1
  for update;
  if not found then
    return null;
  end if;

  -- Eine aktuelle je Grösse: gibt es für diese Grösse schon eine, diese nehmen.
  select i.id into v_current
  from public.inventory_items i
  where i.wine_id = p_wine_id and i.status = 'open' and i.bottle_size_ml is not distinct from v_batch.bottle_size_ml
  limit 1;
  if v_current is not null then
    return v_current;
  end if;

  return public.open_bottle(v_batch.id, 100::smallint, current_date);
end;
$$;

create or replace function public.spirit_bottle_empty(p_item_id uuid)
returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_item public.inventory_items;
  v_type text;
  v_next uuid;
  v_remaining integer;
begin
  if not private.is_member() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then
    raise exception 'inventory item % not found', p_item_id using errcode = 'P0002';
  end if;
  select w.type::text into v_type from public.wines w where w.id = v_item.wine_id for update;
  if v_type is distinct from 'spirit' or v_item.status <> 'open' then
    raise exception 'inventory item % is not the current bottle of a spirit', p_item_id using errcode = '22023';
  end if;

  update public.open_bottle_details set fill_level_percent = 0 where inventory_item_id = v_item.id;
  update public.inventory_items set status = 'drunk' where id = v_item.id;

  v_next := public.ensure_spirit_current(v_item.wine_id, v_item.bottle_size_ml);

  select coalesce(sum(case when i.status = 'sealed' then i.quantity else 1 end), 0)::integer into v_remaining
  from public.inventory_items i
  where i.wine_id = v_item.wine_id and i.status in ('sealed', 'open');

  return jsonb_build_object('next_id', v_next, 'remaining', v_remaining);
end;
$$;

revoke all on function public.ensure_spirit_current(uuid, integer) from public, anon;
revoke all on function public.spirit_bottle_empty(uuid) from public, anon;
grant execute on function public.ensure_spirit_current(uuid, integer) to authenticated, service_role;
grant execute on function public.spirit_bottle_empty(uuid) to authenticated, service_role;

-- Schon erfasste Spirituosen: je Wein und Grösse eine aktuelle Flasche (falls noch keine).
do $$
declare
  r record;
begin
  for r in
    select distinct i.wine_id, i.bottle_size_ml
    from public.inventory_items i
    join public.wines w on w.id = i.wine_id
    where w.type::text = 'spirit' and i.status = 'sealed' and i.quantity > 0
      and not exists (
        select 1 from public.inventory_items o
        where o.wine_id = i.wine_id and o.status = 'open' and o.bottle_size_ml is not distinct from i.bottle_size_ml
      )
  loop
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform public.ensure_spirit_current(r.wine_id, r.bottle_size_ml);
  end loop;
end;
$$;
