-- Höchstens ein Foto-Ablauf pro Chat, der noch Fotos sammelt (status 'received').
-- Kommen zwei Fotos desselben Chats gleichzeitig an (zwei Webhook-Aufrufe, auch auf
-- verschiedenen Vercel-Instanzen), kann so nur einer einen neuen Ablauf anlegen; der andere
-- bekommt einen Unique-Fehler (23505) und hängt sein Foto an diesen Ablauf. Alben, Text,
-- „📷 Foto“ (telegram_attach) und Abläufe in Bearbeitung sind nicht betroffen.
create unique index if not exists ingest_jobs_one_received_photo_job
  on public.ingest_jobs (telegram_chat_id)
  where source = 'telegram' and status = 'received';
