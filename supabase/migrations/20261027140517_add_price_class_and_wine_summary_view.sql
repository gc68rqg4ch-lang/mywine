-- Preisklassen (CHF pro Flasche): bis 30 / 30–60 / 60–100 / 100–200 / über 200
create or replace function public.price_class(p_price numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_price is null then null
    when p_price <= 30  then 'bis 30'
    when p_price <= 60  then '30–60'
    when p_price <= 100 then '60–100'
    when p_price <= 200 then '100–200'
    else 'über 200'
  end;
$$;

-- Übersicht: ein Eintrag pro Wein (alle Jahrgänge, Flaschengrössen und Lagerorte zusammengefasst)
create view public.cellar_wine_summary with (security_invoker = true) as
with items as (
  select i.*
  from public.inventory_items i
  where i.status in ('sealed','open')
),
per_vintage as (
  select
    it.wine_id, it.vintage_year,
    coalesce(sum(it.quantity) filter (where it.status = 'sealed'), 0)::int as sealed,
    count(*) filter (where it.status = 'open')::int as opened,
    round(avg(it.purchase_price) filter (where it.status = 'sealed' and it.purchase_price is not null), 2) as avg_price
  from items it
  group by it.wine_id, it.vintage_year
),
per_location as (
  select
    it.wine_id, it.storage_house, it.storage_room,
    coalesce(sum(it.quantity) filter (where it.status = 'sealed'), 0)::int as sealed,
    count(*) filter (where it.status = 'open')::int as opened
  from items it
  group by it.wine_id, it.storage_house, it.storage_room
),
grapes as (
  select g.wine_id, array_agg(distinct g.grape order by g.grape) as grapes
  from public.wine_grape_shares g
  group by g.wine_id
)
select
  w.id as wine_id,
  w.name, w.producer, w.country, w.region, w.appellation, w.type,
  coalesce(gr.grapes, w.grapes) as grapes,
  (select sum(v.sealed) from per_vintage v where v.wine_id = w.id)::int as sealed_bottles,
  (select sum(v.opened) from per_vintage v where v.wine_id = w.id)::int as open_bottles,
  (select coalesce(sum(it.quantity * it.purchase_price), 0) from items it
     where it.wine_id = w.id and it.status = 'sealed') as stock_value,
  (select coalesce(sum(it.quantity * coalesce(it.regular_price, it.purchase_price)), 0) from items it
     where it.wine_id = w.id and it.status = 'sealed') as stock_value_regular,
  (select array_agg(distinct v.vintage_year order by v.vintage_year) from per_vintage v
     where v.wine_id = w.id and v.vintage_year is not null) as vintages,
  (select array_agg(distinct public.price_class(v.avg_price)) from per_vintage v
     where v.wine_id = w.id and v.avg_price is not null) as price_classes,
  (select jsonb_agg(jsonb_build_object(
            'vintage_year', v.vintage_year,
            'sealed', v.sealed,
            'open', v.opened,
            'avg_price', v.avg_price,
            'price_class', public.price_class(v.avg_price),
            'drink_from_year', wv.drink_from_year,
            'drink_until_year', wv.drink_until_year,
            'drink_status', case
               when wv.drink_from_year is null and wv.drink_until_year is null then 'unknown'
               when wv.drink_until_year is not null and wv.drink_until_year < extract(year from current_date)::int then 'overdue'
               when wv.drink_from_year is not null and wv.drink_from_year > extract(year from current_date)::int then 'wait'
               else 'ready' end)
          order by v.vintage_year nulls last)
     from per_vintage v
     left join public.wine_vintages wv on wv.wine_id = v.wine_id
       and coalesce(wv.vintage_year, 0) = coalesce(v.vintage_year, 0)
     where v.wine_id = w.id) as vintage_details,
  (select jsonb_agg(jsonb_build_object(
            'storage_house', l.storage_house,
            'storage_room', l.storage_room,
            'sealed', l.sealed,
            'open', l.opened)
          order by l.storage_house nulls last, l.storage_room nulls last)
     from per_location l where l.wine_id = w.id) as locations
from public.wines w
left join grapes gr on gr.wine_id = w.id
where exists (select 1 from items it where it.wine_id = w.id);

-- Preisklasse auch in der Jahrgangs-Ansicht
create or replace view public.cellar_wines with (security_invoker = true) as
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
  end as drink_status,
  round(sum(l.value_paid) / nullif(sum(l.sealed), 0), 2) as avg_price,
  public.price_class(round(sum(l.value_paid) / nullif(sum(l.sealed), 0), 2)) as price_class
from loc l
join public.wines w on w.id = l.wine_id
left join public.wine_vintages wv on wv.wine_id = l.wine_id
  and coalesce(wv.vintage_year, 0) = coalesce(l.vintage_year, 0)
group by l.wine_id, l.vintage_year, l.bottle_size_ml, w.name, w.producer, w.country, w.region,
         w.appellation, w.type, wv.drink_from_year, wv.drink_until_year;
