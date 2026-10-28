-- Protokoll der Cron-Läufe klein halten: Einträge älter als 7 Tage täglich löschen
select cron.schedule('cleanup-cron-run-details', '15 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
