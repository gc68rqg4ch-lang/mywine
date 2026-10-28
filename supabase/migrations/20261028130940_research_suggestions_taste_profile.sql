-- Vorschläge auch für das Geschmacksprofil erlauben (wenn ein Profil von Hand erfasst wurde)
alter table public.research_suggestions drop constraint research_suggestions_field_check;
alter table public.research_suggestions add constraint research_suggestions_field_check
  check (field = any (array['producer','country','region','appellation','type','alcohol_content',
                            'drink_from_year','drink_until_year','grapes','taste_profile']));
