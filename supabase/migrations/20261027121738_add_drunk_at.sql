alter table public.inventory_items add column drunk_at timestamptz;

-- Backfill: nur über die App ausgetrunkene Flaschen haben ein echtes Datum
update public.inventory_items i
set drunk_at = i.updated_at
where i.status = 'drunk'
  and exists (select 1 from public.open_bottle_details o where o.inventory_item_id = i.id);

create or replace function public.set_drunk_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'drunk' and old.status is distinct from 'drunk' then
    new.drunk_at := coalesce(new.drunk_at, now());
  elsif new.status <> 'drunk' then
    new.drunk_at := null;
  end if;
  return new;
end;
$$;

create trigger inventory_items_set_drunk_at
  before update on public.inventory_items
  for each row execute function public.set_drunk_at();

create index inventory_items_drunk_at_idx on public.inventory_items (drunk_at desc) where status = 'drunk';
