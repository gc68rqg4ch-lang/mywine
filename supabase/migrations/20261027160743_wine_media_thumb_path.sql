alter table public.wine_media add column thumb_path text;

comment on column public.wine_media.thumb_path is
  'Pfad eines kleinen Vorschaubilds (ca. 160 px breit, WebP/JPEG) im selben Bucket; für Listen-Thumbnails. Leer = noch keins erzeugt.';
