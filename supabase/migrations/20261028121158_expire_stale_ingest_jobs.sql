create extension if not exists pg_cron;

-- Offene Bot-Rückfragen (Kauf und Verkostet) laufen nach 30 Minuten ohne Antwort ab
create or replace function public.expire_stale_ingest_jobs()
returns integer
language sql
set search_path to ''
as $$
  with expired as (
    update public.ingest_jobs
       set status = 'discarded',
           error = coalesce(error, 'abgelaufen: 30 Min. ohne Antwort')
     where status in ('received', 'processing', 'needs_review')
       and updated_at < now() - interval '30 minutes'
    returning 1
  )
  select count(*)::int from expired;
$$;

revoke all on function public.expire_stale_ingest_jobs() from public, anon, authenticated;
grant execute on function public.expire_stale_ingest_jobs() to service_role;

select cron.schedule('expire-stale-ingest-jobs', '*/5 * * * *', $$select public.expire_stale_ingest_jobs()$$);
