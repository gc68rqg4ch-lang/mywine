-- Herkunft des Trinkfensters je Jahrgang: label (Ablaufdatum vom Etikett), research (Quelle:
-- Produzent, Kritik, Händler), estimate (Schätzung ohne Quelle), manual (von Hand bzw. alte App).
-- drink_window_note: kurze Quelle bzw. Begründung (z. B. „bodegaspintia.com“, „Reserva aus Toro …“).
-- Rangfolge (im Code): manual und label werden nie automatisch überschrieben, research ersetzt
-- estimate, estimate ersetzt nichts.
alter table public.wine_vintages
  add column drink_window_source text
    check (drink_window_source in ('label', 'research', 'estimate', 'manual')),
  add column drink_window_note text
    check (drink_window_note is null or btrim(drink_window_note) <> '');

comment on column public.wine_vintages.drink_window_source is 'Herkunft des Trinkfensters: label / research / estimate / manual (NULL = kein Trinkfenster)';
comment on column public.wine_vintages.drink_window_note is 'Quelle bzw. Begründung des Trinkfensters (kurz)';

-- Bestehende Trinkfenster: mit „Haltbar bis …“ in der Notiz vom Etikett, alle anderen von Hand
-- bzw. aus der alten App.
update public.wine_vintages
set drink_window_source = case when notes ilike '%Haltbar bis%' then 'label' else 'manual' end
where drink_from_year is not null or drink_until_year is not null;
