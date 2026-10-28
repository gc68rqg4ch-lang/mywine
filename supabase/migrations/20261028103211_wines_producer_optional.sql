-- Produzent darf fehlen (schnelles Erfassen von Verkostungen); leere Strings bleiben verboten
alter table public.wines alter column producer drop not null;
