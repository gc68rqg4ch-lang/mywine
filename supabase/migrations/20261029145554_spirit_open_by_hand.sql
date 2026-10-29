-- Spirituosen werden von Hand geöffnet (kein automatisches „aktuelle Flasche“ mehr): Alle Flaschen
-- bleiben zu, bis man eine öffnet (open_bottle wie bei Wein). Eine offene Spirituose hat
-- Öffnungsdatum und Füllstand und bleibt im Bestand; leer → getrunken, ohne dass eine nächste
-- Flasche nachrückt.
--   spirit_bottle_empty: nur noch die offene Flasche leer (drunk, Füllstand 0). Liefert
--     { next_id: null, remaining } – remaining = volle plus offene Flaschen dieser Spirituose.
--   ensure_spirit_current: entfällt.
-- Haltbarkeit offen (open_keep_*) jetzt auch bei Spirituosen erlaubt (für Liköre; „offen gut bis“).
-- Bestehende Daten bleiben unverändert.

create or replace function public.spirit_bottle_empty(p_item_id uuid)
returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_item public.inventory_items;
  v_type text;
  v_remaining integer;
begin
  if not private.is_member() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then
    raise exception 'inventory item % not found', p_item_id using errcode = 'P0002';
  end if;
  select w.type::text into v_type from public.wines w where w.id = v_item.wine_id;
  if v_type is distinct from 'spirit' or v_item.status <> 'open' then
    raise exception 'inventory item % is not an open bottle of a spirit', p_item_id using errcode = '22023';
  end if;

  update public.open_bottle_details set fill_level_percent = 0 where inventory_item_id = v_item.id;
  update public.inventory_items set status = 'drunk' where id = v_item.id;

  select coalesce(sum(case when i.status = 'sealed' then i.quantity else 1 end), 0)::integer into v_remaining
  from public.inventory_items i
  where i.wine_id = v_item.wine_id and i.status in ('sealed', 'open');

  return jsonb_build_object('next_id', null, 'remaining', v_remaining);
end;
$$;

revoke all on function public.spirit_bottle_empty(uuid) from public, anon;
grant execute on function public.spirit_bottle_empty(uuid) to authenticated, service_role;

drop function if exists public.ensure_spirit_current(uuid, integer);

-- Haltbarkeit offen: Likörweine und Spirituosen (Liköre).
alter table public.wines drop constraint if exists wines_open_keep_fortified_check;
alter table public.wines drop constraint if exists wines_open_keep_type_check;
alter table public.wines
  add constraint wines_open_keep_type_check check (
    type::text in ('fortified', 'spirit') or (open_keep_days is null and open_keep_source is null and open_keep_note is null)
  );

-- Wird ein Likörwein bzw. eine Spirituose zu einer anderen Art, fällt die Haltbarkeit weg.
create or replace function public.clear_open_keep()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type is null or new.type::text not in ('fortified', 'spirit') then
    new.open_keep_days := null;
    new.open_keep_source := null;
    new.open_keep_note := null;
  end if;
  return new;
end;
$$;

comment on column public.wines.open_keep_days is 'Likörwein bzw. Likör (Spirituose): Tage, die eine offene Flasche gut bleibt; gut bis = date_opened + open_keep_days';
