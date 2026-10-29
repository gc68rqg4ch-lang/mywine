-- Spirituosen: Kategorien in zwei Ebenen (z. B. Whisky → Bourbon), Felder in wines und die Views.
-- Braucht den Enum-Wert „spirit“ aus 20261029130000_spirit_type.sql (eigene Transaktion davor).
-- Kategorien legt nur Antoine an (nach Bestätigung im Chat); die App verwaltet sie nicht.
-- Die Startliste unten ist Stammdaten (kein Testdatum).

-- ——— Kategorien ———
create table if not exists public.spirit_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.spirit_categories (id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);

-- Name je Ebene eindeutig (Gross/Klein egal); Hauptkategorien (parent_id null) untereinander auch.
create unique index if not exists spirit_categories_parent_name on public.spirit_categories (parent_id, lower(name)) nulls not distinct;

-- Höchstens zwei Ebenen: eine Unterkategorie hat keine Unterkategorien, eine Kategorie mit
-- Unterkategorien wird nicht selbst zur Unterkategorie.
create or replace function private.spirit_categories_two_levels()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.parent_id is not null then
    if exists (select 1 from public.spirit_categories p where p.id = new.parent_id and p.parent_id is not null) then
      raise exception 'Unterkategorie darf keine Unterkategorie haben (höchstens zwei Ebenen)';
    end if;
    if exists (select 1 from public.spirit_categories c where c.parent_id = new.id) then
      raise exception 'Kategorie mit Unterkategorien kann nicht selbst Unterkategorie sein (höchstens zwei Ebenen)';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists spirit_categories_two_levels on public.spirit_categories;
create trigger spirit_categories_two_levels
  before insert or update of parent_id on public.spirit_categories
  for each row execute function private.spirit_categories_two_levels();

drop trigger if exists spirit_categories_set_updated_at on public.spirit_categories;
create trigger spirit_categories_set_updated_at
  before update on public.spirit_categories
  for each row execute function public.set_updated_at();

alter table public.spirit_categories enable row level security;
drop policy if exists spirit_categories_members_all on public.spirit_categories;
create policy spirit_categories_members_all on public.spirit_categories
  for all to authenticated using (private.is_member()) with check (private.is_member());

-- Startliste (Hauptkategorie → Unterkategorien); mehrfach ausführbar.
with mains (name, sort_order) as (
  values ('Whisky', 10), ('Likör', 20), ('Kräuterschnaps / Bitter', 30), ('Obstbrand', 40), ('Grappa / Trester', 50),
         ('Cognac / Brandy', 60), ('Rum', 70), ('Gin', 80), ('Vodka', 90), ('Tequila / Mezcal', 100), ('Andere', 110)
)
insert into public.spirit_categories (parent_id, name, sort_order)
select null, m.name, m.sort_order from mains m
on conflict (parent_id, lower(name)) do nothing;

with subs (parent, name, sort_order) as (
  values ('Whisky', 'Scotch Single Malt', 10), ('Whisky', 'Scotch Blend', 20), ('Whisky', 'Bourbon', 30),
         ('Whisky', 'Irish', 40), ('Whisky', 'Japanese', 50), ('Whisky', 'Schweizer', 60),
         ('Likör', 'Frucht', 10), ('Likör', 'Kräuter', 20), ('Likör', 'Nuss', 30), ('Likör', 'Sahne', 40), ('Likör', 'Kaffee', 50),
         ('Obstbrand', 'Kirsch', 10), ('Obstbrand', 'Williams', 20), ('Obstbrand', 'Zwetschge', 30), ('Obstbrand', 'Apfel / Calvados', 40),
         ('Cognac / Brandy', 'Cognac', 10), ('Cognac / Brandy', 'Armagnac', 20), ('Cognac / Brandy', 'Brandy', 30)
)
insert into public.spirit_categories (parent_id, name, sort_order)
select p.id, s.name, s.sort_order
from subs s
join public.spirit_categories p on p.parent_id is null and lower(p.name) = lower(s.parent)
on conflict (parent_id, lower(name)) do nothing;

-- ——— Felder in wines (alle optional) ———
--   spirit_category_id: Haupt- oder Unterkategorie (nur bei Art „spirit“)
--   age_years: Altersangabe (1–100), cask: Fass/Finish („Sherry Cask Finish“),
--   distilled_year / bottled_year: destilliert bzw. abgefüllt (Jahr)
alter table public.wines
  add column if not exists spirit_category_id uuid references public.spirit_categories (id) on delete restrict,
  add column if not exists age_years smallint,
  add column if not exists cask text,
  add column if not exists distilled_year smallint,
  add column if not exists bottled_year smallint;

create index if not exists wines_spirit_category on public.wines (spirit_category_id) where spirit_category_id is not null;

alter table public.wines drop constraint if exists wines_spirit_category_only_spirit;
alter table public.wines add constraint wines_spirit_category_only_spirit check (spirit_category_id is null or type::text = 'spirit');
alter table public.wines drop constraint if exists wines_age_years_check;
alter table public.wines add constraint wines_age_years_check check (age_years is null or age_years between 1 and 100);
alter table public.wines drop constraint if exists wines_cask_not_blank;
alter table public.wines add constraint wines_cask_not_blank check (cask is null or btrim(cask) <> '');
alter table public.wines drop constraint if exists wines_distilled_year_check;
alter table public.wines add constraint wines_distilled_year_check check (distilled_year is null or distilled_year between 1800 and 2100);
alter table public.wines drop constraint if exists wines_bottled_year_check;
alter table public.wines add constraint wines_bottled_year_check check (bottled_year is null or bottled_year between 1800 and 2100);

-- Alkohol: Spirituosen bis 100 % Vol., Wein weiterhin höchstens 25 %.
alter table public.wines drop constraint if exists wines_alcohol_content_check;
alter table public.wines add constraint wines_alcohol_content_check check (
  alcohol_content >= 0 and alcohol_content <= 100 and (alcohol_content <= 25 or type::text = 'spirit')
);

-- Recherche-Vorschläge dürfen die neuen Felder betreffen.
alter table public.research_suggestions drop constraint if exists research_suggestions_field_check;
alter table public.research_suggestions add constraint research_suggestions_field_check check (
  field = any (array[
    'producer', 'country', 'region', 'appellation', 'type', 'alcohol_content', 'drink_from_year', 'drink_until_year',
    'grapes', 'taste_profile', 'spirit_category_id', 'age_years', 'cask', 'distilled_year', 'bottled_year'
  ]::text[])
);

-- ——— Views ———
-- Art war schon drin. Ergänzt am Ende (create or replace – bestehende Spalten unverändert):
-- Kategorie (gespeicherte id, Hauptkategorie id + Name, Unterkategorie-Name) und die neuen Felder.
-- storage_locations, latest_wine_ratings und tasted_wines brauchen nichts Neues (Spirituosen
-- zählen dort wie Weine).

create or replace view public.cellar_overview with (security_invoker = true) as
 SELECT i.id AS inventory_item_id,
    w.id AS wine_id,
    w.name,
    w.producer,
    w.country,
    w.region,
    w.appellation,
    w.type,
    w.grapes,
    w.alcohol_content,
    i.vintage_year,
    i.vintage_rating,
    i.status,
    i.quantity,
    i.bottle_size_ml,
    i.purchase_price,
    i.currency,
        CASE
            WHEN i.status = 'drunk'::inventory_status THEN 0::numeric
            ELSE i.quantity::numeric * i.purchase_price
        END AS stock_value,
    i.storage_house,
    i.storage_room,
    i.storage_compartment,
    i.storage_location,
    i.personal_wine_rating,
    i.personal_vintage_rating,
    o.fill_level_percent,
    o.date_opened,
    i.regular_price,
        CASE
            WHEN i.status = 'drunk'::inventory_status THEN 0::numeric
            ELSE i.quantity::numeric * COALESCE(i.regular_price, i.purchase_price)
        END AS stock_value_regular,
    i.purchased_at,
    i.vendor_id,
    ve.name AS vendor_name,
    i.is_gift,
    i.drunk_at,
    wv.drink_from_year,
    wv.drink_until_year,
        CASE
            WHEN wv.drink_from_year IS NULL AND wv.drink_until_year IS NULL THEN 'unknown'::text
            WHEN wv.drink_until_year IS NOT NULL AND wv.drink_until_year < EXTRACT(year FROM CURRENT_DATE)::integer THEN 'overdue'::text
            WHEN wv.drink_from_year IS NOT NULL AND wv.drink_from_year > EXTRACT(year FROM CURRENT_DATE)::integer THEN 'wait'::text
            ELSE 'ready'::text
        END AS drink_status,
    w.spirit_category_id,
    COALESCE(sp.id, sc.id) AS spirit_main_category_id,
    COALESCE(sp.name, sc.name) AS spirit_main_category,
        CASE
            WHEN sp.id IS NOT NULL THEN sc.name
            ELSE NULL::text
        END AS spirit_sub_category,
    w.age_years,
    w.cask,
    w.distilled_year,
    w.bottled_year
   FROM inventory_items i
     JOIN wines w ON w.id = i.wine_id
     LEFT JOIN open_bottle_details o ON o.inventory_item_id = i.id
     LEFT JOIN vendors ve ON ve.id = i.vendor_id
     LEFT JOIN wine_vintages wv ON wv.wine_id = i.wine_id AND COALESCE(wv.vintage_year, 0) = COALESCE(i.vintage_year, 0)
     LEFT JOIN spirit_categories sc ON sc.id = w.spirit_category_id
     LEFT JOIN spirit_categories sp ON sp.id = sc.parent_id;

create or replace view public.cellar_wine_summary with (security_invoker = true) as
 WITH items AS (
         SELECT i.id,
            i.wine_id,
            i.vintage_year,
            i.vintage_rating,
            i.vintage_notes,
            i.quantity,
            i.bottle_size_ml,
            i.purchase_price,
            i.currency,
            i.storage_house,
            i.storage_room,
            i.storage_compartment,
            i.storage_location,
            i.status,
            i.personal_wine_rating,
            i.personal_vintage_rating,
            i.photo_urls,
            i.created_at,
            i.updated_at,
            i.drunk_at,
            i.regular_price,
            i.purchased_at,
            i.vendor_id,
            i.is_gift
           FROM inventory_items i
          WHERE i.status = ANY (ARRAY['sealed'::inventory_status, 'open'::inventory_status])
        ), per_vintage AS (
         SELECT it.wine_id,
            it.vintage_year,
            COALESCE(sum(it.quantity) FILTER (WHERE it.status = 'sealed'::inventory_status), 0::bigint)::integer AS sealed,
            count(*) FILTER (WHERE it.status = 'open'::inventory_status)::integer AS opened,
            round(avg(it.purchase_price) FILTER (WHERE it.status = 'sealed'::inventory_status AND it.purchase_price IS NOT NULL), 2) AS avg_price
           FROM items it
          GROUP BY it.wine_id, it.vintage_year
        ), per_location AS (
         SELECT it.wine_id,
            it.storage_house,
            it.storage_room,
            COALESCE(sum(it.quantity) FILTER (WHERE it.status = 'sealed'::inventory_status), 0::bigint)::integer AS sealed,
            count(*) FILTER (WHERE it.status = 'open'::inventory_status)::integer AS opened
           FROM items it
          GROUP BY it.wine_id, it.storage_house, it.storage_room
        ), grapes AS (
         SELECT g.wine_id,
            array_agg(DISTINCT g.grape ORDER BY g.grape) AS grapes
           FROM wine_grape_shares g
          GROUP BY g.wine_id
        )
 SELECT w.id AS wine_id,
    w.name,
    w.producer,
    w.country,
    w.region,
    w.appellation,
    w.type,
    COALESCE(gr.grapes, w.grapes) AS grapes,
    (( SELECT sum(v.sealed) AS sum
           FROM per_vintage v
          WHERE v.wine_id = w.id))::integer AS sealed_bottles,
    (( SELECT sum(v.opened) AS sum
           FROM per_vintage v
          WHERE v.wine_id = w.id))::integer AS open_bottles,
    ( SELECT COALESCE(sum(it.quantity::numeric * it.purchase_price), 0::numeric) AS "coalesce"
           FROM items it
          WHERE it.wine_id = w.id AND it.status = 'sealed'::inventory_status) AS stock_value,
    ( SELECT COALESCE(sum(it.quantity::numeric * COALESCE(it.regular_price, it.purchase_price)), 0::numeric) AS "coalesce"
           FROM items it
          WHERE it.wine_id = w.id AND it.status = 'sealed'::inventory_status) AS stock_value_regular,
    ( SELECT array_agg(DISTINCT v.vintage_year ORDER BY v.vintage_year) AS array_agg
           FROM per_vintage v
          WHERE v.wine_id = w.id AND v.vintage_year IS NOT NULL) AS vintages,
    ( SELECT array_agg(DISTINCT price_class(v.avg_price)) AS array_agg
           FROM per_vintage v
          WHERE v.wine_id = w.id AND v.avg_price IS NOT NULL) AS price_classes,
    ( SELECT jsonb_agg(jsonb_build_object('vintage_year', v.vintage_year, 'sealed', v.sealed, 'open', v.opened, 'avg_price', v.avg_price, 'price_class', price_class(v.avg_price), 'drink_from_year', wv.drink_from_year, 'drink_until_year', wv.drink_until_year, 'drink_status',
                CASE
                    WHEN wv.drink_from_year IS NULL AND wv.drink_until_year IS NULL THEN 'unknown'::text
                    WHEN wv.drink_until_year IS NOT NULL AND wv.drink_until_year < EXTRACT(year FROM CURRENT_DATE)::integer THEN 'overdue'::text
                    WHEN wv.drink_from_year IS NOT NULL AND wv.drink_from_year > EXTRACT(year FROM CURRENT_DATE)::integer THEN 'wait'::text
                    ELSE 'ready'::text
                END) ORDER BY v.vintage_year) AS jsonb_agg
           FROM per_vintage v
             LEFT JOIN wine_vintages wv ON wv.wine_id = v.wine_id AND COALESCE(wv.vintage_year, 0) = COALESCE(v.vintage_year, 0)
          WHERE v.wine_id = w.id) AS vintage_details,
    ( SELECT jsonb_agg(jsonb_build_object('storage_house', l.storage_house, 'storage_room', l.storage_room, 'sealed', l.sealed, 'open', l.opened) ORDER BY l.storage_house, l.storage_room) AS jsonb_agg
           FROM per_location l
          WHERE l.wine_id = w.id) AS locations,
    w.spirit_category_id,
    COALESCE(sp.id, sc.id) AS spirit_main_category_id,
    COALESCE(sp.name, sc.name) AS spirit_main_category,
        CASE
            WHEN sp.id IS NOT NULL THEN sc.name
            ELSE NULL::text
        END AS spirit_sub_category,
    w.age_years,
    w.cask,
    w.distilled_year,
    w.bottled_year
   FROM wines w
     LEFT JOIN grapes gr ON gr.wine_id = w.id
     LEFT JOIN spirit_categories sc ON sc.id = w.spirit_category_id
     LEFT JOIN spirit_categories sp ON sp.id = sc.parent_id
  WHERE (EXISTS ( SELECT 1
           FROM items it
          WHERE it.wine_id = w.id));

create or replace view public.cellar_wines with (security_invoker = true) as
 WITH loc AS (
         SELECT i.wine_id,
            i.vintage_year,
            i.bottle_size_ml,
            i.storage_house,
            i.storage_room,
            sum(i.quantity) FILTER (WHERE i.status = 'sealed'::inventory_status) AS sealed,
            count(*) FILTER (WHERE i.status = 'open'::inventory_status) AS opened,
            sum(i.quantity::numeric * i.purchase_price) FILTER (WHERE i.status = 'sealed'::inventory_status) AS value_paid,
            sum(i.quantity::numeric * COALESCE(i.regular_price, i.purchase_price)) FILTER (WHERE i.status = 'sealed'::inventory_status) AS value_regular
           FROM inventory_items i
          WHERE i.status = ANY (ARRAY['sealed'::inventory_status, 'open'::inventory_status])
          GROUP BY i.wine_id, i.vintage_year, i.bottle_size_ml, i.storage_house, i.storage_room
        )
 SELECT l.wine_id,
    l.vintage_year,
    l.bottle_size_ml,
    w.name,
    w.producer,
    w.country,
    w.region,
    w.appellation,
    w.type,
    COALESCE(sum(l.sealed), 0::numeric)::integer AS sealed_bottles,
    COALESCE(sum(l.opened), 0::numeric)::integer AS open_bottles,
    COALESCE(sum(l.value_paid), 0::numeric) AS stock_value,
    COALESCE(sum(l.value_regular), 0::numeric) AS stock_value_regular,
    jsonb_agg(jsonb_build_object('storage_house', l.storage_house, 'storage_room', l.storage_room, 'sealed', COALESCE(l.sealed, 0::bigint), 'open', COALESCE(l.opened, 0::bigint)) ORDER BY l.storage_house, l.storage_room) AS locations,
    wv.drink_from_year,
    wv.drink_until_year,
        CASE
            WHEN wv.drink_from_year IS NULL AND wv.drink_until_year IS NULL THEN 'unknown'::text
            WHEN wv.drink_until_year IS NOT NULL AND wv.drink_until_year < EXTRACT(year FROM CURRENT_DATE)::integer THEN 'overdue'::text
            WHEN wv.drink_from_year IS NOT NULL AND wv.drink_from_year > EXTRACT(year FROM CURRENT_DATE)::integer THEN 'wait'::text
            ELSE 'ready'::text
        END AS drink_status,
    round(sum(l.value_paid) / NULLIF(sum(l.sealed), 0::numeric), 2) AS avg_price,
    price_class(round(sum(l.value_paid) / NULLIF(sum(l.sealed), 0::numeric), 2)) AS price_class,
    w.spirit_category_id,
    COALESCE(sp.id, sc.id) AS spirit_main_category_id,
    COALESCE(sp.name, sc.name) AS spirit_main_category,
        CASE
            WHEN sp.id IS NOT NULL THEN sc.name
            ELSE NULL::text
        END AS spirit_sub_category,
    w.age_years,
    w.cask,
    w.distilled_year,
    w.bottled_year
   FROM loc l
     JOIN wines w ON w.id = l.wine_id
     LEFT JOIN wine_vintages wv ON wv.wine_id = l.wine_id AND COALESCE(wv.vintage_year, 0) = COALESCE(l.vintage_year, 0)
     LEFT JOIN spirit_categories sc ON sc.id = w.spirit_category_id
     LEFT JOIN spirit_categories sp ON sp.id = sc.parent_id
  GROUP BY l.wine_id, l.vintage_year, l.bottle_size_ml, w.name, w.producer, w.country, w.region, w.appellation, w.type, wv.drink_from_year, wv.drink_until_year, w.spirit_category_id, sc.id, sc.name, sp.id, sp.name, w.age_years, w.cask, w.distilled_year, w.bottled_year;
