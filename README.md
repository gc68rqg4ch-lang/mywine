# MyWine

Persönliche Weinkeller-App – Next.js (App Router, TypeScript) mit Supabase (`@supabase/ssr`), Deployment auf Vercel.

## Funktionen (Meilenstein 1)

- **Login per Magic Link** (`/login` → Mail → `/auth/confirm`)
- **Bestand** (`/`): ungeöffnete Positionen mit Suche, Typfilter und Kennzahlen
- **Offene Flaschen** (`/offen`): älteste zuerst, mit Füllstand
- **Getrunken** (`/getrunken`): neueste zuerst nach `drunk_at`, mit persönlicher Bewertung; importierte Zeilen ohne `drunk_at` folgen alphabetisch
- **Detailseite** (`/flasche/[id]`) mit Aktionen:
  - **Öffnen** (ungeöffnet): ruft `public.open_bottle()` auf
  - **Füllstand ändern** (offen)
  - **Ausgetrunken** (offen): `status = drunk`, Füllstand 0; `drunk_at` setzt ein DB-Trigger
  - Getrunkene Flaschen: nur Anzeige, keine Aktionen

### Lebenszyklus einer Flasche

`public.open_bottle(p_item_id, p_fill_level_percent, p_date_opened)` läuft atomar in einer Transaktion
(siehe `supabase/migrations/20261027113004_open_bottle_function.sql`):

- Charge mit `quantity > 1` → `quantity - 1`, plus neue Position (`quantity 1`, `status open`) mit den Daten der Charge
- Charge mit `quantity = 1` → die Position selbst wird `open` (es bleibt keine Zeile mit 0 Flaschen zurück)
- In beiden Fällen wird `open_bottle_details` mit Füllstand und Öffnungsdatum angelegt

Die Funktion ist `security invoker`, d. h. die RLS-Policies (`private.is_member()`) greifen wie bei direkten Zugriffen.

## Lokale Entwicklung

```bash
cp .env.example .env.local   # Publishable Key eintragen
npm install
npm run dev
```

| Variable | Zweck |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ckwwttimhhogyzekvlad.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable Key (`sb_publishable_…`) aus Supabase → Settings → API Keys |
| `NEXT_PUBLIC_SITE_URL` | optional; Basis-URL für den Magic-Link-Redirect. Ohne Wert wird der Host des Requests verwendet (passt für Vercel-Previews). |

Schemaänderungen kommen als Datei nach `supabase/migrations/` und werden nicht von Agenten eingespielt (siehe `AGENTS.md`).

DB-Typen neu generieren nach Schemaänderungen: `npx supabase gen types typescript --project-id ckwwttimhhogyzekvlad > src/lib/database.types.ts`

## Einrichtung Supabase / Vercel

1. **Redirect-URLs erlauben:** Supabase → Authentication → URL Configuration
   - Site URL: die Produktions-URL (z. B. `https://mywine.vercel.app`)
   - Redirect URLs: `http://localhost:3000/**`, `https://<produktion>/**`, `https://*-<team>.vercel.app/**` (Previews)
2. **Erster Login, dann Mitglied eintragen:** Nach dem ersten Login zeigt die App die eigene User-ID an. Diese einmalig eintragen:
   ```sql
   insert into public.app_members (user_id)
   select id from auth.users where email = 'du@example.ch';
   ```
3. **Danach Registrierung schliessen** (empfohlen): Authentication → Sign In / Providers → „Allow new users to sign up“ deaktivieren.
   Nicht-Mitglieder sehen wegen RLS ohnehin keine Daten, so entstehen aber auch keine fremden Accounts.
4. **Vercel:** Projekt aus dem GitHub-Repo importieren und die beiden `NEXT_PUBLIC_SUPABASE_*`-Variablen setzen.

Der Magic Link nutzt standardmässig den PKCE-Flow (`?code=…`) und muss deshalb im selben Browser geöffnet werden, in dem er angefordert wurde.
Alternativ kann die Mailvorlage auf `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink` umgestellt werden; `/auth/confirm` unterstützt beide Varianten.

## Struktur

```
src/
  proxy.ts                      Session-Refresh + Login-Redirect (Next 16: ehem. middleware)
  lib/supabase/                 Server- und Proxy-Client
  lib/auth.ts                   getSession() inkl. Mitgliedschaftsprüfung
  app/login/                    Magic-Link-Formular
  app/auth/confirm/route.ts     Callback (PKCE-Code oder token_hash)
  app/(cellar)/                 geschützter Bereich: Bestand, Offen, Detail, Server Actions
supabase/migrations/            Migrationen, die zusätzlich zum Import-Schema angelegt wurden
```

## Ausblick

Telegram-Bot: Front- und Rückseiten-Foto → Weinerkennung über die Claude API → Bestätigung per Inline-Buttons → Eintrag in `wines`/`inventory_items`.
