create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter function public.is_member() set schema private;
