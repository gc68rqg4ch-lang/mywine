-- Öffnet eine Flasche aus einer ungeöffneten Charge – atomar in einer Transaktion.
--
-- * Charge mit quantity > 1: quantity - 1 und neue Position (quantity 1, status open)
--   mit den Stammdaten der Charge.
-- * Charge mit quantity = 1: die Position selbst wird auf status open gesetzt,
--   damit keine Zeile mit 0 Flaschen zurückbleibt.
--
-- In beiden Fällen wird open_bottle_details mit Füllstand und Öffnungsdatum angelegt.
-- security invoker: RLS (private.is_member()) greift wie bei direkten Tabellenzugriffen.

create or replace function public.open_bottle(
  p_item_id uuid,
  p_fill_level_percent smallint default 100,
  p_date_opened date default current_date
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.inventory_items;
  v_open_id uuid;
begin
  if not private.is_member() then
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
      quantity, bottle_size_ml, purchase_price, currency,
      storage_house, storage_room, storage_compartment, storage_location,
      status, personal_wine_rating, personal_vintage_rating, photo_urls
    ) values (
      v_item.wine_id, v_item.vintage_year, v_item.vintage_rating, v_item.vintage_notes,
      1, v_item.bottle_size_ml, v_item.purchase_price, v_item.currency,
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
$$;

revoke all on function public.open_bottle(uuid, smallint, date) from public, anon;
grant execute on function public.open_bottle(uuid, smallint, date) to authenticated;
