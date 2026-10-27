create or replace view public.cellar_overview with (security_invoker = true) as
select
  i.id as inventory_item_id, w.id as wine_id,
  w.name, w.producer, w.country, w.region, w.appellation, w.type, w.grapes, w.alcohol_content,
  i.vintage_year, i.vintage_rating, i.status, i.quantity, i.bottle_size_ml,
  i.purchase_price, i.currency,
  case when i.status = 'drunk' then 0 else i.quantity * i.purchase_price end as stock_value,
  i.storage_house, i.storage_room, i.storage_compartment, i.storage_location,
  i.personal_wine_rating, i.personal_vintage_rating,
  o.fill_level_percent, o.date_opened,
  i.regular_price,
  case when i.status = 'drunk' then 0 else i.quantity * coalesce(i.regular_price, i.purchase_price) end as stock_value_regular,
  i.purchased_at, i.vendor_id, ve.name as vendor_name, i.is_gift, i.drunk_at,
  wv.drink_from_year, wv.drink_until_year,
  case
    when wv.drink_from_year is null and wv.drink_until_year is null then 'unknown'
    when wv.drink_until_year is not null and wv.drink_until_year < extract(year from current_date)::int then 'overdue'
    when wv.drink_from_year is not null and wv.drink_from_year > extract(year from current_date)::int then 'wait'
    else 'ready'
  end as drink_status
from public.inventory_items i
join public.wines w on w.id = i.wine_id
left join public.open_bottle_details o on o.inventory_item_id = i.id
left join public.vendors ve on ve.id = i.vendor_id
left join public.wine_vintages wv on wv.wine_id = i.wine_id
  and coalesce(wv.vintage_year, 0) = coalesce(i.vintage_year, 0);
