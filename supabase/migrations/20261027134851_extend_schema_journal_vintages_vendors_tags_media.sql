-- ===== Händler & Orte =====
create table public.vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  description text,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index vendors_name_uq on public.vendors (lower(name));

create table public.places (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  description text,
  is_home     boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index places_name_uq on public.places (lower(name));

-- ===== Kauf-Infos an der Position =====
alter table public.inventory_items
  add column purchased_at date,
  add column vendor_id uuid references public.vendors(id) on delete set null,
  add column is_gift boolean not null default false;
create index inventory_items_vendor_idx on public.inventory_items (vendor_id);
create index inventory_items_purchased_at_idx on public.inventory_items (purchased_at);

-- ===== Wein + Jahrgang =====
create table public.wine_vintages (
  id               uuid primary key default gen_random_uuid(),
  wine_id          uuid not null references public.wines(id) on delete cascade,
  vintage_year     integer check (vintage_year between 1800 and 2100),
  drink_from_year  integer check (drink_from_year between 1800 and 2200),
  drink_until_year integer check (drink_until_year between 1800 and 2200),
  vintage_rating   text,
  personal_rating  numeric(2,1) check (personal_rating between 0 and 5),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (drink_from_year is null or drink_until_year is null or drink_from_year <= drink_until_year)
);
create unique index wine_vintages_uq on public.wine_vintages (wine_id, coalesce(vintage_year, 0));
create trigger wine_vintages_set_updated_at before update on public.wine_vintages
  for each row execute function public.set_updated_at();

insert into public.wine_vintages (wine_id, vintage_year, vintage_rating)
select distinct on (wine_id, coalesce(vintage_year, 0)) wine_id, vintage_year, vintage_rating
from public.inventory_items
order by wine_id, coalesce(vintage_year, 0), vintage_rating nulls last
on conflict do nothing;

-- ===== Tags =====
create table public.tags (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  description text,
  color       text,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now()
);
create unique index tags_name_uq on public.tags (lower(name));

create table public.wine_tags (
  wine_id    uuid not null references public.wines(id) on delete cascade,
  tag_id     uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (wine_id, tag_id)
);
create index wine_tags_tag_idx on public.wine_tags (tag_id);

-- ===== Verkostungsnotizen =====
create table public.tasting_notes (
  id           uuid primary key default gen_random_uuid(),
  wine_id      uuid not null references public.wines(id) on delete cascade,
  vintage_year integer check (vintage_year between 1800 and 2100),
  tasted_at    date,
  rating       numeric(2,1) check (rating between 0 and 5),
  note         text not null check (btrim(note) <> ''),
  place_id     uuid references public.places(id) on delete set null,
  source       text not null default 'manual' check (source in ('import','manual','bot')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index tasting_notes_wine_idx on public.tasting_notes (wine_id, vintage_year);
create index tasting_notes_place_idx on public.tasting_notes (place_id);
create trigger tasting_notes_set_updated_at before update on public.tasting_notes
  for each row execute function public.set_updated_at();

-- ===== Medien (Etiketten, Fotos, PDF-Datenblätter) =====
create type public.media_kind as enum ('label_front','label_back','photo','document');

create table public.wine_media (
  id                uuid primary key default gen_random_uuid(),
  wine_id           uuid not null references public.wines(id) on delete cascade,
  vintage_year      integer check (vintage_year between 1800 and 2100),
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  kind              public.media_kind not null,
  storage_bucket    text not null,
  storage_path      text not null,
  file_name         text,
  mime_type         text,
  sort_order        smallint not null default 0,
  created_at        timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);
create index wine_media_wine_idx on public.wine_media (wine_id, vintage_year);
create index wine_media_item_idx on public.wine_media (inventory_item_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wine-documents', 'wine-documents', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

create policy wine_documents_members_read on storage.objects
  for select to authenticated using (bucket_id = 'wine-documents' and private.is_member());
create policy wine_documents_members_write on storage.objects
  for insert to authenticated with check (bucket_id = 'wine-documents' and private.is_member());

-- ===== Journal =====
create type public.event_type as enum ('purchased','opened','fill_changed','drunk','moved','deleted');

create table public.inventory_events (
  id                 uuid primary key default gen_random_uuid(),
  event_type         public.event_type not null,
  occurred_at        timestamptz not null default now(),
  wine_id            uuid not null references public.wines(id) on delete cascade,
  vintage_year       integer,
  inventory_item_id  uuid references public.inventory_items(id) on delete set null,
  quantity           integer,
  bottle_size_ml     integer,
  price              numeric(10,2),
  currency           char(3),
  vendor_id          uuid references public.vendors(id) on delete set null,
  place_id           uuid references public.places(id) on delete set null,
  storage_from       text,
  storage_to         text,
  fill_level_percent smallint check (fill_level_percent between 0 and 100),
  rating             numeric(2,1) check (rating between 0 and 5),
  note               text,
  source             text not null default 'app' check (source in ('app','bot','import')),
  created_at         timestamptz not null default now()
);
create index inventory_events_time_idx on public.inventory_events (occurred_at desc);
create index inventory_events_type_time_idx on public.inventory_events (event_type, occurred_at desc);
create index inventory_events_wine_idx on public.inventory_events (wine_id, vintage_year);
create index inventory_events_item_idx on public.inventory_events (inventory_item_id);
create index inventory_events_vendor_idx on public.inventory_events (vendor_id);
create index inventory_events_place_idx on public.inventory_events (place_id);

-- Automatisches Journal: schreibt Ereignisse, sobald sich der Bestand ändert.
-- Beim Import mit  set_config('mywine.import','on',true)  abschaltbar.
create or replace function public.log_inventory_events()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_skip boolean := coalesce(current_setting('mywine.import', true), '') = 'on';
  v_from text; v_to text;
begin
  if v_skip then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'sealed' and new.quantity > 0 then
      insert into public.inventory_events (event_type, occurred_at, wine_id, vintage_year, inventory_item_id,
        quantity, bottle_size_ml, price, currency, vendor_id, storage_to)
      values ('purchased', coalesce(new.purchased_at::timestamptz, now()), new.wine_id, new.vintage_year, new.id,
        new.quantity, new.bottle_size_ml, new.purchase_price, new.currency, new.vendor_id,
        concat_ws(' / ', new.storage_house, new.storage_room, new.storage_compartment, new.storage_location));
    end if;
    return new;

  elsif tg_op = 'UPDATE' then
    if new.status = 'drunk' and old.status is distinct from 'drunk' then
      insert into public.inventory_events (event_type, occurred_at, wine_id, vintage_year, inventory_item_id,
        quantity, bottle_size_ml, price, currency, rating)
      values ('drunk', coalesce(new.drunk_at, now()), new.wine_id, new.vintage_year, new.id,
        greatest(new.quantity, 1), new.bottle_size_ml, new.purchase_price, new.currency, new.personal_wine_rating);
    end if;

    v_from := concat_ws(' / ', old.storage_house, old.storage_room, old.storage_compartment, old.storage_location);
    v_to   := concat_ws(' / ', new.storage_house, new.storage_room, new.storage_compartment, new.storage_location);
    if v_from is distinct from v_to and new.status <> 'drunk' then
      insert into public.inventory_events (event_type, wine_id, vintage_year, inventory_item_id,
        quantity, bottle_size_ml, storage_from, storage_to)
      values ('moved', new.wine_id, new.vintage_year, new.id, new.quantity, new.bottle_size_ml, v_from, v_to);
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    if old.status <> 'drunk' then
      insert into public.inventory_events (event_type, wine_id, vintage_year, inventory_item_id,
        quantity, bottle_size_ml, price, currency)
      values ('deleted', old.wine_id, old.vintage_year, null, old.quantity, old.bottle_size_ml,
        old.purchase_price, old.currency);
    end if;
    return old;
  end if;
  return null;
end;
$$;

create trigger inventory_items_log_insert after insert on public.inventory_items
  for each row execute function public.log_inventory_events();
create trigger inventory_items_log_update after update on public.inventory_items
  for each row execute function public.log_inventory_events();
create trigger inventory_items_log_delete before delete on public.inventory_items
  for each row execute function public.log_inventory_events();

create or replace function public.log_open_bottle_events()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_item public.inventory_items;
begin
  if coalesce(current_setting('mywine.import', true), '') = 'on' then
    return new;
  end if;
  select * into v_item from public.inventory_items where id = new.inventory_item_id;
  if not found then return new; end if;

  if tg_op = 'INSERT' then
    insert into public.inventory_events (event_type, occurred_at, wine_id, vintage_year, inventory_item_id,
      quantity, bottle_size_ml, price, currency, fill_level_percent)
    values ('opened', coalesce(new.date_opened::timestamptz, now()), v_item.wine_id, v_item.vintage_year, v_item.id,
      1, v_item.bottle_size_ml, v_item.purchase_price, v_item.currency, new.fill_level_percent);
  elsif tg_op = 'UPDATE' and new.fill_level_percent is distinct from old.fill_level_percent
        and v_item.status = 'open' then
    insert into public.inventory_events (event_type, wine_id, vintage_year, inventory_item_id, fill_level_percent)
    values ('fill_changed', v_item.wine_id, v_item.vintage_year, v_item.id, new.fill_level_percent);
  end if;
  return new;
end;
$$;

create trigger open_bottle_details_log after insert or update on public.open_bottle_details
  for each row execute function public.log_open_bottle_events();

-- ===== RLS =====
alter table public.vendors          enable row level security;
alter table public.places           enable row level security;
alter table public.wine_vintages    enable row level security;
alter table public.tags             enable row level security;
alter table public.wine_tags        enable row level security;
alter table public.tasting_notes    enable row level security;
alter table public.wine_media       enable row level security;
alter table public.inventory_events enable row level security;

create policy vendors_members_all          on public.vendors          for all to authenticated using (private.is_member()) with check (private.is_member());
create policy places_members_all           on public.places           for all to authenticated using (private.is_member()) with check (private.is_member());
create policy wine_vintages_members_all    on public.wine_vintages    for all to authenticated using (private.is_member()) with check (private.is_member());
create policy tags_members_all             on public.tags             for all to authenticated using (private.is_member()) with check (private.is_member());
create policy wine_tags_members_all        on public.wine_tags        for all to authenticated using (private.is_member()) with check (private.is_member());
create policy tasting_notes_members_all    on public.tasting_notes    for all to authenticated using (private.is_member()) with check (private.is_member());
create policy wine_media_members_all       on public.wine_media       for all to authenticated using (private.is_member()) with check (private.is_member());
create policy inventory_events_members_all on public.inventory_events for all to authenticated using (private.is_member()) with check (private.is_member());
