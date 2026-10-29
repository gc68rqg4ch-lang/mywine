-- Zurückgehaltene Preis-Rückfragen (Schritt price_held: warten, bis keine andere Erfassung mehr
-- läuft) verfallen nicht nach 10 Minuten. Ihre Frist beginnt erst, wenn die Frage gesendet wird
-- (dann ist der Schritt nicht mehr price_held und updated_at neu). Obergrenze fürs Zurückhalten:
-- 24 Stunden – danach verwirft die App die Frage und meldet es einmal. Die DB räumt sie erst nach
-- 25 Stunden auf (Sicherheitsnetz, falls die App es nicht getan hat).

create or replace function public.expire_stale_ingest_jobs()
returns integer
language sql
set search_path to ''
as $$
  with expired as (
    update public.ingest_jobs
       set status = 'discarded',
           error = coalesce(error, 'abgelaufen: 10 Min. ohne Antwort')
     where status in ('received', 'processing', 'needs_review')
       and updated_at < now() - interval '10 minutes'
       and not (
         status = 'needs_review'
         and extracted->>'step' = 'price_held'
         and coalesce(
           case when (extracted->'price_followup'->>'held_at') ~ '^\d{4}-\d{2}-\d{2}T'
                then (extracted->'price_followup'->>'held_at')::timestamptz end,
           updated_at
         ) > now() - interval '25 hours'
       )
    returning 1
  )
  select count(*)::int from expired;
$$;
