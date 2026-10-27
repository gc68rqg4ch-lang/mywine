create or replace view public.cellar_overview with (security_invoker = true) as
select
  i.id as inventory_item_id, w.id as wine_id,
  w.name, w.producer, w.country, w.region, w.appellation, w.type, w.grapes, w.alcohol_content,
  i.vintage_year, i.vintage_rating, i.status, i.quantity, i.bottle_size_ml,
  i.purchase_price, i.currency,
  case when i.status = 'drunk' then 0 else i.quantity * i.purchase_price end as stock_value,
  i.storage_house, i.storage_room, i.storage_compartment, i.storage_location,
  i.personal_wine_rating, i.personal_vintage_rating,
  o.fill_level_percent, o.date_opened
from public.inventory_items i
join public.wines w on w.id = i.wine_id
left join public.open_bottle_details o on o.inventory_item_id = i.id;
