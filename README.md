# MyWine

Persönliche Weinkeller-App – Next.js (App Router, TypeScript) mit Supabase (`@supabase/ssr`), Deployment auf Vercel.

## Funktionen (Meilenstein 1)

- **Login per Magic Link** (`/login` → Mail → `/auth/confirm`)
- **Lagerort-Wahl** oben rechts (Alle / Räume aus `storage_locations`): filtert alle Listen und Zahlen,
  gemerkt im Cookie `mywine_lagerort`. Offene Flaschen ohne Lagerort erscheinen nur unter „Alle“.
- **Bestand** (`/`): ein Eintrag pro Wein (`cellar_wine_summary` + `cellar_wines`) mit Flaschenzahl und
  Jahrgängen, Suche und Gruppierung nach Weintyp, Land (mit Flagge), Rebsorte, Jahrgang oder Preisklasse
  (bis 30 / 30–60 / 60–100 / 100–200 / über 200 CHF). Bei Jahrgang und Preisklasse steht ein Wein in jeder
  passenden Gruppe mit deren Flaschenzahl, bei Rebsorte Cuvées unter jeder Traube. Kacheln: Bestand
  (Flaschen, Weine, Jahrgänge, Kellerwert bezahlt/normal), offene Flaschen (Tage seit Öffnen), Käufe des
  Jahres (aus dem Journal `inventory_events`) und Trinkreife. Weintypen als Trauben-Symbole
  (`src/components/wine-type-icon.tsx`); Logik in `src/lib/cellar/overview.ts`.
- **Weinseite** (`/wein/[id]`): Aufteilung nach Jahrgang (Flaschen, Ø Preis, Preisklasse, Trinkreife,
  Bewertungen) und nach Lagerort, dazu alle Flaschen – immer ungefiltert.
- **Offene Flaschen** (`/offen`): älteste zuerst, mit Füllstand
- **Getrunken** (`/getrunken`): neueste zuerst nach `drunk_at`, mit persönlicher Bewertung; importierte Zeilen ohne `drunk_at` folgen alphabetisch
- **Detailseite** (`/flasche/[id]`) mit Aktionen:
  - **Öffnen** (ungeöffnet): ruft `public.open_bottle()` auf
  - **Füllstand ändern** (offen)
  - **Ausgetrunken** (offen): `status = drunk`, Füllstand 0; `drunk_at` setzt ein DB-Trigger
  - Getrunkene Flaschen: nur Anzeige, keine Aktionen
  - **Preise** (alle Status): bezahlter Preis und Normalpreis bearbeitbar, Rabatt in CHF und %
  - **Rebsorten** mit Prozentanteil aus `wine_grape_shares` (jahrgangsspezifisch, sonst „alle Jahrgänge“),
    bearbeitbar (`source = manual`) und per **Nachrecherchieren** neu recherchierbar
  - **Bewertung** pro Person (`persons`) mit halben Sternen 0–5 in `wine_ratings`; angezeigt wird die
    neueste je Person (`latest_wine_ratings`). Pro Person und Tag eine Bewertung, ältere bleiben als Verlauf.
  - **Verkostungen (WSET)**: Liste für Wein + Jahrgang, „Neue Verkostung“ öffnet das Formular
- **WSET-Verkostung** (`/flasche/[id]/verkostung`, bearbeiten mit `?t=<id>`): Nachbau des
  [Verkostungs-Tools](https://gc68rqg4ch-lang.github.io/WSET-Verkostungs-tool/) mit gleichen Feldern, Optionen,
  Aromen-Lexikon und Punkte-Logik (`src/lib/tasting/sat.ts`). Gespeichert in `wine_tastings`: Stil, Qualität,
  Punkte (in halben Schritten) und Trinkreife als Spalten, das komplette Formular als JSON in `sat`
  (Schlüssel wie im Tool).
- **Rebsorten nachrecherchieren** (`/recherche`): Sammellauf für alle Weine + Jahrgänge ohne Prozentangaben, mit
  Fortschrittsanzeige; manuell gepflegte Angaben werden übersprungen. `wines.grapes` bleibt vorerst bestehen.

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
  app/(cellar)/                 geschützter Bereich: Bestand, Offen, Getrunken, Detail, Server Actions
  app/api/telegram/             Webhook (route.ts) und Webhook-Registrierung (setup/route.ts)
  lib/ingest/                   Bot-Logik: Album/Jobs, Claude-Erkennung, Abgleich, Speichern
  lib/telegram/                 Telegram Bot API (fetch), Konfiguration
  lib/cellar/overview.ts        Bestandsübersicht: Weine, Lagerort-Filter, Gruppen, Kennzahlen
  lib/location.ts               Lagerort-Auswahl (Cookie) und Query-Filter
  lib/grapes/                   Rebsorten-Anteile: Helfer, Recherche, Speichern (wine_grape_shares)
supabase/migrations/            Migrationen, die zusätzlich zum Import-Schema angelegt wurden
```

## Telegram-Bot (Foto-Erfassung)

Ablauf: Vorder- und Rückseite als Album schicken → Fotos landen im privaten Bucket `wine-photos`
(`telegram/<job-id>/<message-id>.jpg`) und in einer Zeile in `ingest_jobs` → Erkennung → Vorschlag mit
**[Speichern] [Korrigieren] [Verwerfen]** → Lagerort (Weinkeller / Wohnzimmer), Anzahl, bezahlter Preis,
Normalpreis (**[Gleich wie bezahlt] [Überspringen]**), Händler (Buttons aus `vendors`, **[Neuer Händler]**
per Freitext oder **[Überspringen]**) → Wein anlegen oder wiederverwenden, `inventory_items` mit
`status = sealed`, `purchased_at = heute`, `vendor_id` und den Fotos anlegen, Job auf `confirmed`.
Das Journal (`inventory_events`) schreibt die DB per Trigger – der Bot schreibt keine eigenen Einträge.

- **Erkennung:** `claude-haiku-5-5` mit beiden Bildern und strukturierter JSON-Ausgabe; bei Konfidenz < 0.7
  nochmals mit `claude-sonnet-5-5` (mit serverseitigem Fallback bei Ablehnungen).
- **Abgleich:** danach gegen bestehende Weine (Name + Produzent, ohne Gross-/Kleinschreibung). Bekannte Weine
  werden wiederverwendet und ihre Stammdaten übernommen.
- **Websuche:** nur für unbekannte Weine mit fehlenden Feldern (Land, Region, Appellation, Typ, Trauben,
  Alkohol) – `claude-sonnet-5-5` mit `web_search`. Name, Produzent und Jahrgang kommen immer vom Etikett.
- **Rebsorten:** Prozentanteile vom Etikett (`source = label`); fehlen sie, recherchiert `claude-sonnet-5-5` per
  `web_search` die Anteile für den konkreten Jahrgang (`source = research`, gleiche Logik wie `/recherche`).
  Ohne belegte Prozente werden nur die Rebsorten gespeichert. Manuelle Angaben werden nie überschrieben.
  Gespeichert wird atomar über `public.replace_grape_shares(wine_id, vintage_year, shares)` – auch von der
  Detailseite und vom Sammellauf.
- **Korrigieren:** Freitext-Antwort, die per `claude-haiku-5-5` in den Vorschlag übernommen wird.
- **Album:** Telegram schickt jedes Foto einzeln. Alle Fotos eines Albums landen über eine aus
  `media_group_id` abgeleitete Job-ID im selben Job; erkannt wird nach 3 s Ruhe, genau einmal.
- **Sicherheit:** Webhook prüft `X-Telegram-Bot-Api-Secret-Token`, verarbeitet nur Updates von
  `TELEGRAM_ALLOWED_USER_ID`. `SUPABASE_SECRET_KEY` wird nur in `src/lib/supabase/admin.ts` (server-only) gelesen.

| Variable (Vercel) | Zweck |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token von @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | frei gewähltes Secret (Buchstaben, Ziffern, `_`, `-`; bis 256 Zeichen) |
| `TELEGRAM_ALLOWED_USER_ID` | deine numerische Telegram-User-ID |
| `ANTHROPIC_API_KEY` | Claude API |
| `SUPABASE_SECRET_KEY` | Secret Key (`sb_secret_…`) – umgeht RLS, nur serverseitig |

**Webhook registrieren:** nach dem Deployment eingeloggt `https://<produktion>/api/telegram/setup` öffnen.
