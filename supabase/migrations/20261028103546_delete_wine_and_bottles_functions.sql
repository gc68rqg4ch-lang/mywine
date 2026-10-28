-- Ganzen Wein unwiderruflich löschen (inkl. aller Flaschen, Bewertungen, Verkostungen, Fotos-Einträge, Journal).
-- Gibt die Storage-Pfade der Fotos/Dokumente zurück, damit die App die Dateien aus den Buckets entfernt.
create or replace function public.delete_wine(p_wine_id uuid)
returns table (storage_bucket text, storage_path text, thumb_path text)
language plpgsql
set search_path to ''
as $$
declare
  v_prev text := coalesce(current_setting('mywine.import', true), '');
begin
  if not private.is_member() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.wines where id = p_wine_id) then
    raise exception 'Wein nicht gefunden' using errcode = 'P0002';
  end if;

  return query
    select m.storage_bucket::text, m.storage_path::text, m.thumb_path::text
      from public.wine_media m where m.wine_id = p_wine_id;

  perform set_config('mywine.import', 'on', true);  -- kein Journal beim Löschen
  delete from public.inventory_items where wine_id = p_wine_id;
  delete from public.wines where id = p_wine_id;     -- Rest per ON DELETE CASCADE
  perform set_config('mywine.import', v_prev, true);
end $$;

-- Einzelne Flaschen einer Charge löschen (z. B. falsch erfasst). Ganz oder teilweise.
-- Rückgabe: verbleibende Anzahl in der Charge (0 = Charge gelöscht). Genau ein Journal-Eintrag «deleted».
create or replace function public.delete_bottles(p_item_id uuid, p_quantity integer default null)
returns integer
language plpgsql
set search_path to ''
as $$
declare
  v_item public.inventory_items;
  v_prev text := coalesce(current_setting('mywine.import', true), '');
begin
  if not private.is_member() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_item from public.inventory_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'Charge nicht gefunden' using errcode = 'P0002';
  end if;
  if p_quantity is not null and p_quantity < 1 then
    raise exception 'Anzahl muss mindestens 1 sein' using errcode = '22023';
  end if;

  if p_quantity is null or p_quantity >= v_item.quantity then
    delete from public.inventory_items where id = p_item_id;  -- Journal schreibt der Lösch-Trigger
    return 0;
  end if;

  perform set_config('mywine.import', 'on', true);
  update public.inventory_items set quantity = quantity - p_quantity where id = p_item_id;
  perform set_config('mywine.import', v_prev, true);

  insert into public.inventory_events
    (event_type, occurred_at, wine_id, vintage_year, inventory_item_id, quantity,
     bottle_size_ml, price, currency, storage_from, source)
  values
    ('deleted', now(), v_item.wine_id, v_item.vintage_year, v_item.id, p_quantity,
     v_item.bottle_size_ml, v_item.purchase_price, v_item.currency,
     nullif(concat_ws(' / ', v_item.storage_house, v_item.storage_room,
                      v_item.storage_compartment, v_item.storage_location), ''),
     'app');

  return v_item.quantity - p_quantity;
end $$;

revoke all on function public.delete_wine(uuid) from public, anon;
revoke all on function public.delete_bottles(uuid, integer) from public, anon;
grant execute on function public.delete_wine(uuid) to authenticated, service_role;
grant execute on function public.delete_bottles(uuid, integer) to authenticated, service_role;
