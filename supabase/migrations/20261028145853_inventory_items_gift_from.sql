alter table public.inventory_items
  add column gift_from text,
  add constraint inventory_items_gift_from_not_blank check (gift_from is null or btrim(gift_from) <> ''),
  add constraint inventory_items_gift_from_requires_gift check (gift_from is null or is_gift);

comment on column public.inventory_items.gift_from is 'Name der schenkenden Person (nur wenn is_gift)';
