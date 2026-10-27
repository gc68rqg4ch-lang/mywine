-- Ein Eintrag pro Wein + Jahrgang + Flaschengrösse, mit Aufteilung nach Lagerort
create view public.cellar_wines with (security_invoker = true) as
with loc as (
  select
    i.wine_id, i.vintage_year, i.bottle_size_ml,
    i.storage_house, i.storage_room,
    sum(i.quantity) filter (where i.status = 'sealed') as sealed,
    count(*)        filter (where i.status = 'open')   as opened,
    sum(i.quantity * i.purchase_price) filter (where i.status = 'sealed') as value_paid,
    sum(i.quantity * coalesce(i.regular_price, i.purchase_price)) filter (where i.status = 'sealed') as value_regular
  from public.inventory_items i
  where i.status in ('sealed','open')
  group by i.wine_id, i.vintage_year, i.bottle_size_ml, i.storage_house, i.storage_room
)
select
  l.wine_id,
  l.vintage_year,
  l.bottle_size_ml,
  w.name, w.producer, w.country, w.region, w.appellation, w.type,
  coalesce(sum(l.sealed), 0)::int  as sealed_bottles,
  coalesce(sum(l.opened), 0)::int  as open_bottles,
  coalesce(sum(l.value_paid), 0)    as stock_value,
  coalesce(sum(l.value_regular), 0) as stock_value_regular,
  jsonb_agg(jsonb_build_object(
      'storage_house', l.storage_house,
      'storage_room',  l.storage_room,
      'sealed',        coalesce(l.sealed, 0),
      'open',          coalesce(l.opened, 0))
    order by l.storage_house nulls last, l.storage_room nulls last) as locations,
  wv.drink_from_year, wv.drink_until_year,
  case
    when wv.drink_from_year is null and wv.drink_until_year is null then 'unknown'
    when wv.drink_until_year is not null and wv.drink_until_year < extract(year from current_date)::int then 'overdue'
    when wv.drink_from_year is not null and wv.drink_from_year > extract(year from current_date)::int then 'wait'
    else 'ready'
  end as drink_status
from loc l
join public.wines w on w.id = l.wine_id
left join public.wine_vintages wv on wv.wine_id = l.wine_id
  and coalesce(wv.vintage_year, 0) = coalesce(l.vintage_year, 0)
group by l.wine_id, l.vintage_year, l.bottle_size_ml, w.name, w.producer, w.country, w.region,
         w.appellation, w.type, wv.drink_from_year, wv.drink_until_year;

-- Lagerorte für die Auswahl oben rechts
create view public.storage_locations with (security_invoker = true) as
select storage_house, storage_room,
       sum(quantity) filter (where status = 'sealed')::int as sealed_bottles,
       count(*) filter (where status = 'open')::int        as open_bottles
from public.inventory_items
where status in ('sealed','open') and storage_room is not null
group by storage_house, storage_room;
