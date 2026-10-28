-- Offene Bot-Rückfragen laufen schon nach 10 Minuten ohne Antwort ab
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
    returning 1
  )
  select count(*)::int from expired;
$$;

select cron.alter_job((select jobid from cron.job where jobname = 'expire-stale-ingest-jobs'), schedule := '*/2 * * * *');
