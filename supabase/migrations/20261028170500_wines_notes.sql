alter table public.wines add column notes text,
  add constraint wines_notes_not_blank check (notes is null or btrim(notes) <> '');

comment on column public.wines.notes is 'Freie Notizen zum Wein (App)';

-- Import-Notizen aus tasting_notes übernehmen (doppelte gleiche Notizen nur einmal, Jahrgang voranstellen)
update public.wines w
set notes = x.notes
from (
  select wine_id,
         string_agg(line, E'\n' order by vy nulls first, line) as notes
  from (
    select distinct t.wine_id, t.vintage_year as vy,
           case when t.vintage_year is not null then t.vintage_year::text || ': ' else '' end || btrim(t.note) as line
    from public.tasting_notes t
    where t.note is not null and btrim(t.note) <> ''
  ) d
  group by wine_id
) x
where x.wine_id = w.id;
