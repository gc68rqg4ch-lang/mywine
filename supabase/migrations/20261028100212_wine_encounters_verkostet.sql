-- Orte genauer beschreiben
alter table public.places
  add column kind text check (kind in ('restaurant','weingut','bar','privat','messe','sonstiges')),
  add column city text;

-- Merker «Kaufen?» pro Wein
alter table public.wines
  add column want_to_buy boolean not null default false;

-- Verkostet: ein Wein irgendwo probiert (unabhängig vom Bestand)
create table public.wine_encounters (
  id uuid primary key default gen_random_uuid(),
  wine_id uuid not null references public.wines(id) on delete cascade,
  vintage_year integer,
  tasted_on date not null default current_date,
  place_id uuid references public.places(id) on delete set null,
  price numeric(10,2) check (price is null or price >= 0),
  price_unit text check (price_unit in ('bottle','glass')),
  currency text not null default 'CHF',
  occasion text,
  companions text,
  note text,
  person_id uuid references public.persons(id) on delete set null,
  source text not null default 'app' check (source in ('app','bot')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index wine_encounters_wine_idx on public.wine_encounters (wine_id, tasted_on desc);
create index wine_encounters_place_idx on public.wine_encounters (place_id);

alter table public.wine_encounters enable row level security;
create policy wine_encounters_members_all on public.wine_encounters
  for all to authenticated using (private.is_member()) with check (private.is_member());

create trigger wine_encounters_set_updated_at before update on public.wine_encounters
  for each row execute function public.set_updated_at();

-- Bewertungen und Verkostungen optional an einen Anlass hängen
alter table public.wine_ratings
  add column encounter_id uuid references public.wine_encounters(id) on delete set null;
alter table public.wine_tastings
  add column encounter_id uuid references public.wine_encounters(id) on delete set null;
create index wine_ratings_encounter_idx on public.wine_ratings (encounter_id);
create index wine_tastings_encounter_idx on public.wine_tastings (encounter_id);

-- Merker automatisch zurücksetzen, sobald gekauft wird
create or replace function public.clear_want_to_buy_on_purchase()
returns trigger language plpgsql as $$
begin
  if new.status = 'sealed' then
    update public.wines set want_to_buy = false
     where id = new.wine_id and want_to_buy;
  end if;
  return new;
end $$;

create trigger inventory_items_clear_want_to_buy after insert on public.inventory_items
  for each row execute function public.clear_want_to_buy_on_purchase();

-- Übersicht für die Liste «Verkostet»
create view public.tasted_wines with (security_invoker = true) as
select
  w.id as wine_id,
  count(e.id)::int as encounter_count,
  max(e.tasted_on) as last_tasted_on,
  (select p.name from public.wine_encounters e2
     left join public.places p on p.id = e2.place_id
    where e2.wine_id = w.id
    order by e2.tasted_on desc, e2.created_at desc limit 1) as last_place_name,
  w.want_to_buy,
  coalesce((select sum(i.quantity) from public.inventory_items i
             where i.wine_id = w.id and i.status in ('sealed','open')), 0)::int as bottles_in_stock
from public.wines w
join public.wine_encounters e on e.wine_id = w.id
group by w.id, w.want_to_buy;
