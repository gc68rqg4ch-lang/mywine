-- pg_net für HTTP-Aufrufe aus pg_cron (Recherche-Worker /api/research/worker).
create extension if not exists pg_net with schema extensions;
