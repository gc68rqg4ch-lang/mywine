-- Foto-Erfassung (Telegram-Bot): Entwürfe bis zur Bestätigung
create type public.ingest_status as enum ('received','processing','needs_review','confirmed','discarded','failed');

create table public.ingest_jobs (
  id                uuid primary key default gen_random_uuid(),
  source            text not null default 'telegram',
  telegram_chat_id  bigint,
  telegram_message_ids bigint[] not null default '{}',
  photo_paths       text[] not null default '{}',
  status            public.ingest_status not null default 'received',
  extracted         jsonb,
  confidence        numeric(3,2) check (confidence between 0 and 1),
  matched_wine_id   uuid references public.wines(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index ingest_jobs_status_idx on public.ingest_jobs (status, created_at desc);
create index ingest_jobs_matched_wine_idx on public.ingest_jobs (matched_wine_id);
create index ingest_jobs_inventory_item_idx on public.ingest_jobs (inventory_item_id);

create trigger ingest_jobs_set_updated_at
  before update on public.ingest_jobs
  for each row execute function public.set_updated_at();

alter table public.ingest_jobs enable row level security;
create policy ingest_jobs_members_all on public.ingest_jobs
  for all to authenticated using (private.is_member()) with check (private.is_member());

-- Privater Speicher für Etikettenfotos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wine-photos', 'wine-photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

create policy wine_photos_members_read on storage.objects
  for select to authenticated using (bucket_id = 'wine-photos' and private.is_member());
create policy wine_photos_members_write on storage.objects
  for insert to authenticated with check (bucket_id = 'wine-photos' and private.is_member());
