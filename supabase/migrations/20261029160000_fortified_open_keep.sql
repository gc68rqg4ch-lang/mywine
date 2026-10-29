-- Likörweine (type = 'fortified': Port, Sherry, Madeira, Marsala, Wermut …): wie lange eine offene
-- Flasche gut bleibt (im Kühlschrank, verschlossen). „Gut bis“ wird nie gespeichert, sondern immer
-- aus open_bottle_details.date_opened + open_keep_days berechnet.
-- Herkunft wie beim Trinkfenster: research = Quelle, estimate = Schätzung nach Stil, manual = von
-- Hand. manual wird nie automatisch überschrieben, research ersetzt estimate.

alter table public.wines
  add column if not exists open_keep_days smallint,
  add column if not exists open_keep_source text,
  add column if not exists open_keep_note text;

alter table public.wines drop constraint if exists wines_open_keep_days_check;
alter table public.wines
  add constraint wines_open_keep_days_check check (open_keep_days is null or open_keep_days between 1 and 3650);

alter table public.wines drop constraint if exists wines_open_keep_source_check;
alter table public.wines
  add constraint wines_open_keep_source_check check (open_keep_source is null or open_keep_source in ('research', 'estimate', 'manual'));

-- Nur bei Likörweinen gesetzt.
alter table public.wines drop constraint if exists wines_open_keep_fortified_check;
alter table public.wines
  add constraint wines_open_keep_fortified_check check (
    type = 'fortified' or (open_keep_days is null and open_keep_source is null and open_keep_note is null)
  );

-- Wird ein Likörwein zu einer anderen Art, fällt die Haltbarkeit weg (statt am Check zu scheitern).
create or replace function public.clear_open_keep()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type is distinct from 'fortified' then
    new.open_keep_days := null;
    new.open_keep_source := null;
    new.open_keep_note := null;
  end if;
  return new;
end;
$$;

drop trigger if exists wines_clear_open_keep on public.wines;
create trigger wines_clear_open_keep
  before insert or update of type, open_keep_days, open_keep_source, open_keep_note on public.wines
  for each row execute function public.clear_open_keep();

comment on column public.wines.open_keep_days is 'Likörwein: Tage, die eine offene Flasche gut bleibt (Kühlschrank, verschlossen); gut bis = date_opened + open_keep_days';
comment on column public.wines.open_keep_source is 'Herkunft der Haltbarkeit offen: research / estimate / manual';
comment on column public.wines.open_keep_note is 'Begründung bzw. Quelle der Haltbarkeit offen (bei Schätzung mit Stil)';

-- Recherche im Hintergrund: neue Auftragsart keep = nur „Haltbarkeit offen“ (Option auf /recherche).
alter table public.research_jobs drop constraint if exists research_jobs_kind_check;
alter table public.research_jobs
  add constraint research_jobs_kind_check check (kind in ('page', 'research', 'window', 'keep'));
