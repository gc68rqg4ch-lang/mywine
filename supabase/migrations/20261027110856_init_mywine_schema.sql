-- MyWine: Grundschema
create type public.wine_type as enum ('red','white','rose','sparkling','sweet','fortified','orange');
create type public.inventory_status as enum ('sealed','open','drunk');

-- Zugriff: nur eingetragene Mitglieder (Single-User, später erweiterbar)
create table public.app_members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_members m where m.user_id = (select auth.uid()));
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Stammdaten
create table public.wines (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (btrim(name) <> ''),
  producer        text not null check (btrim(producer) <> ''),
  country         text,
  region          text,
  appellation     text,
  type            public.wine_type,
  grapes          text[] not null default '{}',
  alcohol_content numeric(4,1) check (alcohol_content between 0 and 25),
  created_at      timestamptz not null default now()
);
create unique index wines_name_producer_uq on public.wines (lower(name), lower(producer));

-- Bestand (eine Zeile = Charge gleicher Flaschen an einem Ort, mit Status)
create table public.inventory_items (
  id                      uuid primary key default gen_random_uuid(),
  wine_id                 uuid not null references public.wines(id) on delete restrict,
  vintage_year            integer check (vintage_year between 1800 and 2100),
  vintage_rating          text,
  vintage_notes           text,
  quantity                integer not null default 1 check (quantity >= 0),
  bottle_size_ml          integer check (bottle_size_ml > 0),
  purchase_price          numeric(10,2) check (purchase_price >= 0),
  currency                char(3) default 'CHF' check (currency ~ '^[A-Z]{3}$'),
  storage_house           text,
  storage_room            text,
  storage_compartment     text,
  storage_location        text,
  status                  public.inventory_status not null default 'sealed',
  personal_wine_rating    numeric(2,1) check (personal_wine_rating between 0 and 5),
  personal_vintage_rating numeric(2,1) check (personal_vintage_rating between 0 and 5),
  photo_urls              text[] not null default '{}',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index inventory_items_wine_id_idx on public.inventory_items (wine_id);
create index inventory_items_status_idx  on public.inventory_items (status);

create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- Offene Flaschen (1:1 zu inventory_items)
create table public.open_bottle_details (
  inventory_item_id  uuid primary key references public.inventory_items(id) on delete cascade,
  fill_level_percent smallint check (fill_level_percent between 0 and 100),
  date_opened        date,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger open_bottle_details_set_updated_at
  before update on public.open_bottle_details
  for each row execute function public.set_updated_at();

-- RLS
alter table public.app_members         enable row level security;
alter table public.wines               enable row level security;
alter table public.inventory_items     enable row level security;
alter table public.open_bottle_details enable row level security;

create policy app_members_read_self on public.app_members
  for select to authenticated using (user_id = (select auth.uid()));

create policy wines_members_all on public.wines
  for all to authenticated using (public.is_member()) with check (public.is_member());
create policy inventory_members_all on public.inventory_items
  for all to authenticated using (public.is_member()) with check (public.is_member());
create policy open_details_members_all on public.open_bottle_details
  for all to authenticated using (public.is_member()) with check (public.is_member());

revoke execute on function public.is_member() from anon, public;
grant execute on function public.is_member() to authenticated;

-- Übersicht für App & Statistiken
create view public.cellar_overview with (security_invoker = true) as
select
  i.id as inventory_item_id, w.id as wine_id,
  w.name, w.producer, w.country, w.region, w.appellation, w.type, w.grapes, w.alcohol_content,
  i.vintage_year, i.vintage_rating, i.status, i.quantity, i.bottle_size_ml,
  i.purchase_price, i.currency, (i.quantity * i.purchase_price) as stock_value,
  i.storage_house, i.storage_room, i.storage_compartment, i.storage_location,
  i.personal_wine_rating, i.personal_vintage_rating,
  o.fill_level_percent, o.date_opened
from public.inventory_items i
join public.wines w on w.id = i.wine_id
left join public.open_bottle_details o on o.inventory_item_id = i.id;
