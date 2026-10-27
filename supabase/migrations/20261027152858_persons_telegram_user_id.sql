alter table public.persons
  add column telegram_user_id bigint unique;

comment on column public.persons.telegram_user_id is
  'Telegram-User-ID dieser Person; nur so eingetragene Personen dürfen den Bot nutzen. Der Bot ordnet Bewertungen und Verkostungen automatisch dieser Person zu.';
