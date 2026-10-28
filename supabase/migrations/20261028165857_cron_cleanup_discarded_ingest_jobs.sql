select cron.schedule(
  'cleanup-discarded-ingest-jobs',
  '25 3 * * *',
  $$delete from public.ingest_jobs where status = 'discarded' and updated_at < now() - interval '30 days'$$
);
