-- Preis beim Einbuchen automatisch suchen („🔎 Such du“ bei Antoine): Die Recherche sucht den Preis
-- pro Flasche bei Schweizer Händlern (nur CHF) und speichert ihn direkt in der Charge.
--   inventory_items.price_source: manual = von Hand (bzw. Altbestand ohne Angabe), research =
--     recherchiert. Recherchierte Preise überschreiben nie einen von Hand eingegebenen.
--   inventory_items.price_note: Herkunft eines recherchierten Preises (Händler, Jahrgang, Grösse,
--     Datum, Adresse) – für den Hinweis auf der Weinseite.
--   research_jobs: neue Auftragsart price (Preissuche im Hintergrund).

alter table public.inventory_items
  add column if not exists price_source text,
  add column if not exists price_note text;

alter table public.inventory_items drop constraint if exists inventory_items_price_source_check;
alter table public.inventory_items
  add constraint inventory_items_price_source_check check (price_source is null or price_source in ('manual', 'research'));

comment on column public.inventory_items.price_source is 'Herkunft der Preise: manual (von Hand, auch NULL bei Altbestand) / research (recherchiert)';
comment on column public.inventory_items.price_note is 'Recherchierter Preis: Händler, Jahrgang, Grösse, Datum, URL';

alter table public.research_jobs drop constraint if exists research_jobs_kind_check;
alter table public.research_jobs
  add constraint research_jobs_kind_check check (kind in ('page', 'research', 'window', 'keep', 'price'));
