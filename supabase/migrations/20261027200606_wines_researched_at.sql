alter table public.wines add column researched_at timestamptz;
comment on column public.wines.researched_at is
  'Zeitpunkt der letzten erfolgreichen Recherche (Nachrecherchieren, Sammellauf, Bot); für „kürzlich geprüfte überspringen“.';
