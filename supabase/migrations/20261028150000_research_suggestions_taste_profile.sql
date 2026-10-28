-- Vorschläge auch fürs Geschmacksprofil (bestehendes Profil von Hand wird nicht überschrieben)
alter table public.research_suggestions drop constraint research_suggestions_field_check;
alter table public.research_suggestions add constraint research_suggestions_field_check
  check (field in ('producer','country','region','appellation','type','alcohol_content','drink_from_year','drink_until_year','grapes','taste_profile'));
