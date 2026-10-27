-- Vorschlag (noch nicht eingespielt): quality_points in halben Schritten speichern.
-- Die Punkte-Logik des WSET-Tools vergibt je Kriterium 0 / 0.5 / 1, die Summe kann
-- also z. B. 2.5 sein – das passt nicht in smallint. Bis diese Migration eingespielt
-- ist, speichert die App bei halben Summen quality_points = null (der genaue Wert
-- steht immer in sat.fields).
alter table public.wine_tastings drop constraint wine_tastings_quality_points_check;
alter table public.wine_tastings alter column quality_points type numeric(2,1);
alter table public.wine_tastings add constraint wine_tastings_quality_points_check
  check (quality_points between 0 and 4 and quality_points * 2 = round(quality_points * 2));
