-- Kurzer Gesprächsverlauf für den Chat-Modus des Telegram-Bots (nur Text, keine Tool-Details).
-- Der Bot liest die letzten Nachrichten pro Chat und löscht ältere selbst.
create table public.telegram_chat_messages (
  id          bigint generated always as identity primary key,
  chat_id     bigint not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null check (length(content) between 1 and 8000),
  created_at  timestamptz not null default now()
);
create index telegram_chat_messages_chat_idx on public.telegram_chat_messages (chat_id, id desc);

alter table public.telegram_chat_messages enable row level security;
create policy telegram_chat_messages_members_all on public.telegram_chat_messages
  for all to authenticated using (private.is_member()) with check (private.is_member());
