-- Preissuche: Händlernamen → Domain. Google Shopping (Serper) nennt nur den Händlernamen, keinen
-- Link; ob ein Händler Schweizer ist, entscheidet die Domain. Gelernt aus gelesenen .ch-Produktseiten
-- (og:site_name, schema.org, Titel-Zusatz „… | Drinks.ch“), dazu Startdaten (bekannte Händler) und
-- Einträge von Hand. Lesen Mitglieder, schreiben nur service_role (die App mit dem Admin-Client).
--
-- name_key: Händlername normalisiert wie merchantKey() in src/lib/research/merchant.ts – klein,
-- ohne Akzente, Satzzeichen als Leerzeichen, ohne Rechtsform (AG, GmbH, SA, Sagl …).

create table if not exists public.merchants (
  name_key text primary key,
  display_name text not null,
  domain text,
  swiss boolean not null default false,
  source text not null default 'page' check (source in ('page', 'known', 'manual')),
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.merchants enable row level security;
drop policy if exists merchants_members_read on public.merchants;
create policy merchants_members_read on public.merchants
  for select to authenticated using (private.is_member());
-- Keine Schreib-Policy: nur service_role.

-- Startdaten: bisherige Namensliste im Code (bekannte Schweizer Händler ohne Domain im Namen).
insert into public.merchants (name_key, display_name, domain, swiss, source) values
  ('casa poli', 'Casa Poli', 'casapoli.ch', true, 'known'),
  ('galaxus', 'Galaxus', 'galaxus.ch', true, 'known'),
  ('digitec', 'Digitec', 'digitec.ch', true, 'known'),
  ('brack', 'Brack', 'brack.ch', true, 'known'),
  ('coop', 'Coop', 'coop.ch', true, 'known'),
  ('denner', 'Denner', 'denner.ch', true, 'known'),
  ('manor', 'Manor', 'manor.ch', true, 'known'),
  ('globus', 'Globus', 'globus.ch', true, 'known'),
  ('gerstl', 'Gerstl', 'gerstl.ch', true, 'known'),
  ('gerstl weinselektionen', 'Gerstl Weinselektionen', 'gerstl.ch', true, 'known'),
  ('movenpick', 'Mövenpick', 'moevenpick-wein.com', true, 'known'),
  ('movenpick wein', 'Mövenpick Wein', 'moevenpick-wein.com', true, 'known'),
  ('caratello weine', 'Caratello Weine', 'caratello.ch', true, 'known'),
  ('feldschlosschen getranke shop', 'Feldschlösschen Getränke Shop', 'feldschloesschen.swiss', true, 'known')
on conflict (name_key) do nothing;
