CREATE OR REPLACE FUNCTION public.open_bottle(p_item_id uuid, p_fill_level_percent smallint DEFAULT 100, p_date_opened date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_item public.inventory_items;
  v_open_id uuid;
begin
  if not private.is_member() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_fill_level_percent is null or p_fill_level_percent not between 0 and 100 then
    raise exception 'fill level must be between 0 and 100' using errcode = '22023';
  end if;

  select * into v_item
  from public.inventory_items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'inventory item % not found', p_item_id using errcode = 'P0002';
  end if;

  if v_item.status <> 'sealed' or v_item.quantity < 1 then
    raise exception 'inventory item % is not a sealed batch with bottles left', p_item_id
      using errcode = '22023';
  end if;

  if v_item.quantity = 1 then
    update public.inventory_items
    set status = 'open'
    where id = v_item.id;

    v_open_id := v_item.id;
  else
    update public.inventory_items
    set quantity = quantity - 1
    where id = v_item.id;

    insert into public.inventory_items (
      wine_id, vintage_year, vintage_rating, vintage_notes,
      quantity, bottle_size_ml, purchase_price, regular_price, currency,
      purchased_at, vendor_id, is_gift, gift_from,
      storage_house, storage_room, storage_compartment, storage_location,
      status, personal_wine_rating, personal_vintage_rating, photo_urls
    ) values (
      v_item.wine_id, v_item.vintage_year, v_item.vintage_rating, v_item.vintage_notes,
      1, v_item.bottle_size_ml, v_item.purchase_price, v_item.regular_price, v_item.currency,
      v_item.purchased_at, v_item.vendor_id, v_item.is_gift, v_item.gift_from,
      v_item.storage_house, v_item.storage_room, v_item.storage_compartment, v_item.storage_location,
      'open', v_item.personal_wine_rating, v_item.personal_vintage_rating, v_item.photo_urls
    )
    returning id into v_open_id;
  end if;

  insert into public.open_bottle_details (inventory_item_id, fill_level_percent, date_opened)
  values (v_open_id, p_fill_level_percent, coalesce(p_date_opened, current_date))
  on conflict (inventory_item_id) do update
    set fill_level_percent = excluded.fill_level_percent,
        date_opened = excluded.date_opened;

  return v_open_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.move_bottles(p_item_id uuid, p_quantity integer, p_house text, p_room text, p_compartment text DEFAULT NULL::text, p_location text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_src public.inventory_items;
  v_target uuid;
  v_from text;
  v_to text;
  v_prev text := coalesce(current_setting('mywine.import', true), '');
begin
  if not private.is_member() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_src from public.inventory_items where id = p_item_id for update;
  if v_src.id is null then
    raise exception 'Charge nicht gefunden' using errcode = 'P0002';
  end if;
  if v_src.status = 'drunk' then
    raise exception 'Getrunkene Flaschen lassen sich nicht verschieben' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > v_src.quantity then
    raise exception 'Anzahl muss zwischen 1 und % liegen', v_src.quantity using errcode = '22023';
  end if;

  v_from := concat_ws(' / ', v_src.storage_house, v_src.storage_room, v_src.storage_compartment, v_src.storage_location);
  v_to   := concat_ws(' / ', nullif(p_house, ''), nullif(p_room, ''), nullif(p_compartment, ''), nullif(p_location, ''));
  if v_from = v_to then
    return v_src.id;
  end if;

  perform set_config('mywine.import', 'on', true);

  -- gleiche Charge am Ziel?
  if v_src.status = 'sealed' then
    select i.id into v_target
      from public.inventory_items i
     where i.id <> v_src.id and i.status = 'sealed'
       and i.wine_id = v_src.wine_id
       and i.vintage_year     is not distinct from v_src.vintage_year
       and i.bottle_size_ml   is not distinct from v_src.bottle_size_ml
       and i.purchase_price   is not distinct from v_src.purchase_price
       and i.regular_price    is not distinct from v_src.regular_price
       and i.currency         is not distinct from v_src.currency
       and i.purchased_at     is not distinct from v_src.purchased_at
       and i.vendor_id        is not distinct from v_src.vendor_id
       and i.is_gift          is not distinct from v_src.is_gift
       and i.gift_from        is not distinct from v_src.gift_from
       and concat_ws(' / ', i.storage_house, i.storage_room, i.storage_compartment, i.storage_location) = v_to
     limit 1
     for update;
  end if;

  if v_target is not null then
    update public.inventory_items set quantity = quantity + p_quantity where id = v_target;
  elsif p_quantity = v_src.quantity then
    update public.inventory_items
       set storage_house = nullif(p_house, ''), storage_room = nullif(p_room, ''),
           storage_compartment = nullif(p_compartment, ''), storage_location = nullif(p_location, '')
     where id = v_src.id;
    v_target := v_src.id;
  else
    insert into public.inventory_items (wine_id, vintage_year, vintage_rating, vintage_notes, quantity, bottle_size_ml,
      purchase_price, currency, storage_house, storage_room, storage_compartment, storage_location, status,
      personal_wine_rating, personal_vintage_rating, photo_urls, regular_price, purchased_at, vendor_id, is_gift, gift_from)
    values (v_src.wine_id, v_src.vintage_year, v_src.vintage_rating, v_src.vintage_notes, p_quantity, v_src.bottle_size_ml,
      v_src.purchase_price, v_src.currency, nullif(p_house, ''), nullif(p_room, ''), nullif(p_compartment, ''), nullif(p_location, ''),
      v_src.status, v_src.personal_wine_rating, v_src.personal_vintage_rating, v_src.photo_urls, v_src.regular_price,
      v_src.purchased_at, v_src.vendor_id, v_src.is_gift, v_src.gift_from)
    returning id into v_target;
  end if;

  -- Quelle anpassen
  if v_target <> v_src.id then
    if p_quantity = v_src.quantity then
      update public.inventory_events set inventory_item_id = v_target where inventory_item_id = v_src.id;
      update public.wine_media       set inventory_item_id = v_target where inventory_item_id = v_src.id;
      update public.wine_ratings     set inventory_item_id = v_target where inventory_item_id = v_src.id;
      update public.wine_tastings    set inventory_item_id = v_target where inventory_item_id = v_src.id;
      update public.ingest_jobs      set inventory_item_id = v_target where inventory_item_id = v_src.id;
      delete from public.inventory_items where id = v_src.id;
    else
      update public.inventory_items set quantity = quantity - p_quantity where id = v_src.id;
    end if;
  end if;

  insert into public.inventory_events (event_type, wine_id, vintage_year, inventory_item_id,
    quantity, bottle_size_ml, price, currency, storage_from, storage_to)
  values ('moved', v_src.wine_id, v_src.vintage_year, v_target,
    p_quantity, v_src.bottle_size_ml, v_src.purchase_price, v_src.currency, v_from, v_to);

  perform set_config('mywine.import', v_prev, true);
  return v_target;
end;
$function$;
