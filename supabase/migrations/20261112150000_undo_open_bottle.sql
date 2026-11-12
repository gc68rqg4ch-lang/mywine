-- Öffnen rückgängig: Eine versehentlich geöffnete Flasche wieder als ungeöffnet buchen, als wäre
-- sie nie geöffnet worden (Wein, Likörwein, Spirituose). Gegenstück zu open_bottle.
--
-- Bedingungen (sonst Fehler, Code in Klammern):
--   - die Position ist eine offene Flasche (22023; nicht gefunden: P0002)
--   - geöffnet vor höchstens 24 Stunden, massgebend open_bottle_details.created_at, nicht
--     date_opened (kann zurückdatiert sein) (UO001)
--   - seit dem Öffnen keine Bewertung, Verkostung, Foto oder Erfassung an dieser Flasche
--     (wine_ratings, wine_tastings, wine_media, ingest_jobs per inventory_item_id) (UO002).
--     Gezählt wird ab dem Öffnen: Bei der letzten Flasche einer Charge ist die offene Position
--     die Charge selbst, und Fotos bzw. die Erfassung vom Einbuchen hängen schon vorher daran.
-- Füllstand darf unter 100 % sein (abgezogene Gläser werden mit zurückgenommen).
--
-- Ablauf: open_bottle_details löschen; gibt es eine ungeöffnete Charge mit denselben Merkmalen,
-- die open_bottle beim Abspalten kopiert, dort quantity + 1 und die offene Position löschen;
-- sonst die offene Position selbst auf sealed zurücksetzen (letzte Flasche). Die Journal-Einträge
-- opened und fill_changed dieser Position werden gelöscht.
--
-- Trigger: log_inventory_events schreibt beim Löschen einer Charge ein „deleted“-Event (ohne
-- inventory_item_id – nachträglich nicht mehr zuzuordnen). Darum läuft die Funktion mit dem
-- bestehenden Import-Schalter mywine.import (nur für diese Transaktion): so entsteht kein neues
-- Event (deleted, moved, fill_changed). open_bottle_details hat keinen Trigger auf DELETE.

CREATE OR REPLACE FUNCTION public.undo_open_bottle(p_item_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_item public.inventory_items;
  v_opened_at timestamptz;
  v_target public.inventory_items;
  v_sealed_id uuid;
  v_prev_import text;
begin
  if not private.is_member() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_item
  from public.inventory_items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'inventory item % not found', p_item_id using errcode = 'P0002';
  end if;

  if v_item.status <> 'open' then
    raise exception 'inventory item % is not an open bottle', p_item_id using errcode = '22023';
  end if;

  select d.created_at into v_opened_at
  from public.open_bottle_details d
  where d.inventory_item_id = p_item_id
  for update;

  if v_opened_at is null or v_opened_at < now() - interval '24 hours' then
    raise exception 'bottle % was opened more than 24 hours ago', p_item_id using errcode = 'UO001';
  end if;

  if exists (select 1 from public.wine_ratings  r where r.inventory_item_id = p_item_id and r.created_at >= v_opened_at)
  or exists (select 1 from public.wine_tastings t where t.inventory_item_id = p_item_id and t.created_at >= v_opened_at)
  or exists (select 1 from public.wine_media    m where m.inventory_item_id = p_item_id and m.created_at >= v_opened_at)
  or exists (select 1 from public.ingest_jobs   j where j.inventory_item_id = p_item_id and j.created_at >= v_opened_at) then
    raise exception 'bottle % already has ratings, tastings, photos or entries', p_item_id using errcode = 'UO002';
  end if;

  -- Keine neuen Journal-Einträge durch die Trigger (nur diese Transaktion).
  v_prev_import := coalesce(current_setting('mywine.import', true), '');
  perform set_config('mywine.import', 'on', true);

  delete from public.inventory_events
   where inventory_item_id = p_item_id and event_type in ('opened', 'fill_changed');

  delete from public.open_bottle_details where inventory_item_id = p_item_id;

  -- Ungeöffnete Charge mit denselben Merkmalen wie beim Abspalten (open_bottle kopiert sie).
  select * into v_target
  from public.inventory_items s
  where s.id <> v_item.id
    and s.status = 'sealed'
    and s.wine_id = v_item.wine_id
    and s.vintage_year is not distinct from v_item.vintage_year
    and s.bottle_size_ml is not distinct from v_item.bottle_size_ml
    and s.purchase_price is not distinct from v_item.purchase_price
    and s.regular_price is not distinct from v_item.regular_price
    and s.currency is not distinct from v_item.currency
    and s.purchased_at is not distinct from v_item.purchased_at
    and s.vendor_id is not distinct from v_item.vendor_id
    and s.is_gift is not distinct from v_item.is_gift
    and s.gift_from is not distinct from v_item.gift_from
    and s.storage_house is not distinct from v_item.storage_house
    and s.storage_room is not distinct from v_item.storage_room
    and s.storage_compartment is not distinct from v_item.storage_compartment
    and s.storage_location is not distinct from v_item.storage_location
  order by s.created_at
  limit 1
  for update;

  if found then
    update public.inventory_items set quantity = quantity + 1 where id = v_target.id;
    delete from public.inventory_items where id = v_item.id;
    v_sealed_id := v_target.id;
  else
    -- Letzte Flasche (bzw. inzwischen umgelagert): die Position selbst wieder zu.
    update public.inventory_items set status = 'sealed', quantity = 1 where id = v_item.id;
    v_sealed_id := v_item.id;
  end if;

  perform set_config('mywine.import', v_prev_import, true);
  return v_sealed_id;
end;
$function$;

revoke all on function public.undo_open_bottle(uuid) from public, anon;
grant execute on function public.undo_open_bottle(uuid) to authenticated, service_role;
