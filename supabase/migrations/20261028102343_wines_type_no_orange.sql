-- Orange wird nicht verwendet: in der DB sperren (Enum-Wert bleibt aus technischen Gründen bestehen)
alter table public.wines
  add constraint wines_type_not_orange check (type <> 'orange');
