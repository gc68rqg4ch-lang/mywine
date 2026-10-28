-- Bot-Gedächtnis: Nachrichten älter als 30 Tage täglich löschen (in den Prompt gehen ohnehin nur 12 Std.)
select cron.schedule('cleanup-telegram-chat-messages', '20 3 * * *',
  $$delete from public.telegram_chat_messages where created_at < now() - interval '30 days'$$);
