-- tasting_notes wird nicht mehr gebraucht: die Import-Notizen stehen seit "wines_notes" in
-- wines.notes. Zuerst change_vintage ohne tasting_notes (sonst scheitert jeder Jahrgangswechsel),
-- dann die Tabelle löschen (mit Policy, Trigger und Constraints). Rechte der Funktion bleiben.

CREATE OR REPLACE FUNCTION public.change_vintage(p_wine_id uuid, p_from integer, p_to integer, p_item_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_src public.wine_vintages;
  v_dst public.wine_vintages;
begin
  if not private.is_member() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_to is not null and (p_to < 1800 or p_to > extract(year from now())::int + 1) then
    raise exception 'ungültiger Jahrgang %', p_to using errcode = '22023';
  end if;

  if p_from is not distinct from p_to then
    return;
  end if;

  -- Nur eine Charge umhängen
  if p_item_id is not null then
    update public.inventory_items
       set vintage_year = p_to
     where id = p_item_id and wine_id = p_wine_id and vintage_year is not distinct from p_from;
    if not found then
      raise exception 'Charge % passt nicht zu Wein/Jahrgang', p_item_id using errcode = 'P0002';
    end if;

    update public.inventory_events set vintage_year = p_to where inventory_item_id = p_item_id;

    insert into public.wine_vintages (wine_id, vintage_year)
    select p_wine_id, p_to
    where not exists (select 1 from public.wine_vintages
                       where wine_id = p_wine_id and vintage_year is not distinct from p_to);
    return;
  end if;

  -- Ganzen Jahrgang verschieben
  select * into v_src from public.wine_vintages
   where wine_id = p_wine_id and vintage_year is not distinct from p_from for update;
  select * into v_dst from public.wine_vintages
   where wine_id = p_wine_id and vintage_year is not distinct from p_to for update;

  if v_src.id is not null and v_dst.id is not null then
    update public.wine_vintages set
      drink_from_year  = coalesce(v_dst.drink_from_year,  v_src.drink_from_year),
      drink_until_year = coalesce(v_dst.drink_until_year, v_src.drink_until_year),
      vintage_rating   = coalesce(v_dst.vintage_rating,   v_src.vintage_rating),
      personal_rating  = coalesce(v_dst.personal_rating,  v_src.personal_rating),
      notes            = coalesce(v_dst.notes,            v_src.notes)
    where id = v_dst.id;
    delete from public.wine_vintages where id = v_src.id;
  elsif v_src.id is not null then
    update public.wine_vintages set vintage_year = p_to where id = v_src.id;
  else
    insert into public.wine_vintages (wine_id, vintage_year)
    select p_wine_id, p_to
    where not exists (select 1 from public.wine_vintages
                       where wine_id = p_wine_id and vintage_year is not distinct from p_to);
  end if;

  -- Rebsorten: hat das Ziel schon eigene Angaben, gelten diese
  if exists (select 1 from public.wine_grape_shares
              where wine_id = p_wine_id and vintage_year is not distinct from p_to) then
    delete from public.wine_grape_shares
     where wine_id = p_wine_id and vintage_year is not distinct from p_from and p_from is not null;
  else
    update public.wine_grape_shares set vintage_year = p_to
     where wine_id = p_wine_id and vintage_year is not distinct from p_from and p_from is not null;
  end if;

  update public.inventory_items  set vintage_year = p_to where wine_id = p_wine_id and vintage_year is not distinct from p_from;
  update public.inventory_events set vintage_year = p_to where wine_id = p_wine_id and vintage_year is not distinct from p_from;
  update public.wine_ratings     set vintage_year = p_to where wine_id = p_wine_id and vintage_year is not distinct from p_from;
  update public.wine_tastings    set vintage_year = p_to where wine_id = p_wine_id and vintage_year is not distinct from p_from;
  update public.wine_media       set vintage_year = p_to where wine_id = p_wine_id and vintage_year is not distinct from p_from;
end;
$function$;

drop table public.tasting_notes;
