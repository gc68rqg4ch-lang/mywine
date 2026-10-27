# MyWine

Persönliche Weinkeller-App – Next.js (App Router, TypeScript) mit Supabase (`@supabase/ssr`), Deployment auf Vercel.

## Funktionen (Meilenstein 1)

- **Login per Magic Link** (`/login` → Mail → `/auth/confirm`)
- **Lagerort-Wahl** oben rechts (Alle / Räume aus `storage_locations`): filtert alle Listen und Zahlen,
  gemerkt im Cookie `mywine_lagerort`. Offene Flaschen ohne Lagerort erscheinen nur unter „Alle“.
- **Bestand** (`/`): ein Eintrag pro Wein (`cellar_wine_summary` + `cellar_wines`) mit Flaschenzahl und
  Jahrgängen, Suche und Gruppierung nach Weintyp, Land (mit Flagge), Rebsorte, Jahrgang oder Preisklasse
  (bis 30 / 30–60 / 60–100 / 100–200 / über 200 CHF). Bei Jahrgang und Preisklasse steht ein Wein in jeder
  passenden Gruppe mit deren Flaschenzahl, bei Rebsorte Cuvées unter jeder Traube. Gruppen laden zugeklappt
  (Titel, Symbol bzw. Flagge, Flaschenzahl); bei aktiver Suche gehen die Gruppen mit Treffern auf. Kacheln: Bestand
  (Flaschen, Weine, Jahrgänge, Kellerwert bezahlt/normal), offene Flaschen (Tage seit Öffnen), Käufe des
  Jahres (aus dem Journal `inventory_events`) und Trinkreife. Weintypen als Trauben-Symbole
  (`src/components/wine-type-icon.tsx`); Logik in `src/lib/cellar/overview.ts`.
- **Offen** (`/offen`) und **Getrunken** (`/getrunken`) sind wie der Bestand aufgebaut und nutzen dieselben
  Komponenten (`src/components/cellar/`: Suche/Gruppierung, einklappbare Gruppen, Weinkarte) und dieselbe
  Gruppierungslogik (`groupWines` über `Groupable`-Einträge, `src/lib/cellar/lists.ts`); die Lagerort-Wahl gilt.
  - Offen: eine Karte pro offener Flasche mit Füllstand und Tagen seit dem Öffnen; Kacheln: Anzahl offen, am
    längsten offen, Ø Füllstand.
  - Getrunken: ein Eintrag pro Wein mit Anzahl, letztem Trinkdatum (`drunk_at`) und neuester Bewertung je Person
    (sonst die alte Import-Bewertung); zusätzliche Gruppierung „Getrunken am“ (Jahr, darin Monate). Kacheln:
    getrunken dieses Jahr, Lieblingsweine (beste Bewertungen), zuletzt getrunken.
  - Flaschen ohne Lagerort (Import) erscheinen nur unter „Alle“; die Kachel nennt ihre Anzahl.
- **Weinseite** (`/wein/[id]?jahrgang=2019`): eine Seite pro Wein, Ziel aller Klicks aus Bestand, Offen und
  Getrunken (`wineHref` in `src/lib/cellar/wine-page.ts`). Jahrgang-Umschalter oben bei mehreren Jahrgängen
  (`ohne` = ohne Jahrgang); alles Jahrgangsabhängige folgt der Auswahl. Kacheln in einem Raster mit bis zu
  3 Spalten (breit: Öffnen, Verkostungen, Rebsorten; schmal: Bewertung, Preise, Lagerorte, Trinkreife,
  Stammdaten, Getrunken); `tileSpans()` verteilt die Breiten so, dass keine Lücken bleiben. iPhone: 1 Spalte.
  - **Öffnen & offene Flaschen:** Lagerort bzw. Charge wählen → `public.open_bottle()` mit deren
    `inventory_item`-ID; offene Flaschen mit Füllstand ändern und **Ausgetrunken** (`drunk_at` setzt die DB)
  - **Lagerorte** je Charge mit Flaschenzahl und Preis; **Preise** je Charge bearbeitbar (Rabatt in CHF und %)
  - **Rebsorten** mit Prozentanteil aus `wine_grape_shares` (jahrgangsspezifisch, sonst „alle Jahrgänge“),
    bearbeitbar (`source = manual`) und per **Nachrecherchieren** neu recherchierbar
  - **Bewertung** pro Person (`persons`) mit halben Sternen 0–5 in `wine_ratings`; angezeigt wird die
    neueste je Person (`latest_wine_ratings`). Pro Person und Tag eine Bewertung, ältere bleiben als Verlauf.
  - **Verkostungen (WSET)**, **Trinkreife** (Fenster aus `wine_vintages`, dazu die letzte Verkostung),
    Stammdaten mit Fotos, getrunkene Flaschen
  - Jahrgangsbezogene Aktionen hängen an einer Flasche des Jahrgangs (offen vor ungeöffnet vor getrunken).
  - `/flasche/[id]` leitet auf die Weinseite mit dem Jahrgang der Flasche weiter (Bot-Links, Lesezeichen).
- **Weintyp-Filter:** in Bestand, Offen und Getrunken bei den Gruppierungen Land, Rebsorte, Jahrgang,
  Preisklasse (und „Getrunken am“): Alle / Rot / Weiss / … mit Trauben-Symbolen, nur vorhandene Typen
  (`?typ=`), zusätzlich zur Lagerort-Wahl.
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
  lib/chat/                     Chat-Modus und Menüs: Werkzeuge, Knöpfe, Vorschläge mit Ja/Nein, Verlauf
  lib/telegram/                 Telegram Bot API (fetch), Konfiguration
  lib/cellar/overview.ts        Bestandsübersicht: Weine, Lagerort-Filter, Gruppen, Kennzahlen
  lib/location.ts               Lagerort-Auswahl (Cookie) und Query-Filter
  lib/grapes/                   Rebsorten-Anteile: Helfer, Recherche, Speichern (wine_grape_shares)
supabase/migrations/            Migrationen, die zusätzlich zum Import-Schema angelegt wurden
```

## Telegram-Bot (Foto-Erfassung und Chat)

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

### Menüs (Knöpfe)

- **Menüleiste unten** (Reply-Keyboard, kommt mit `/start` bzw. `/help`): 🍷 Offen · 📦 Bestand · ⏰ Trinkreif ·
  📷 Neuer Wein. Bestand zeigt zuerst die Weintypen, dann die Weine des Typs.
- **Listen:** pro Wein eine Zeile mit Emoji statt Weintyp (🍷 Rot, 🥂 Weiss, 🌸 Rosé, 🍾 Schaumwein,
  🍯 Süss/Likör, 🟠 Orange), z. B. „🍷 Palermo 2022 · 50 % · seit 216 T.“; Produzent bzw. Lagerort nur, wenn nötig
  zur Unterscheidung. Darunter je Wein ein Knopf (8 pro Seite, dann „Mehr…“).
- **Pro Wein:** offen → 🥃 1 Glas, 🥃🥃 2 Gläser, Füllstand %, ✅ Ausgetrunken (fragt einmal nach); ungeöffnet →
  🍾 Öffnen (bei mehreren Lagerorten Ort wählen); immer ⭐ Bewertung je Person (1–5 in halben Schritten) und
  📱 In der App öffnen. Das Antippen ist die Bestätigung, es gibt keine zusätzliche Ja/Nein-Frage.
- Menüs ersetzen die bestehende Nachricht (`editMessageText`) statt neue zu stapeln. Der Zustand steckt
  vollständig im `callback_data` (Format in `src/lib/chat/menu-view.ts`).
- Nennt eine Chat-Antwort Weine, hängt Claude über `attach_wine_buttons` dieselben Knöpfe an.

### Verkostung per Bot

Im Wein-Menü „📝 Verkostung“:
- **💬 Erzählen:** Eindrücke als Freitext (auch diktiert). Claude (`claude-haiku-5-5`, bei Bedarf
  `claude-sonnet-5-5`) ordnet sie per strukturierter Ausgabe den Feldern und exakten Optionswerten aus
  `src/lib/tasting/sat.ts` zu (`src/lib/tasting/extract.ts`); nicht Erwähntes bleibt leer. Punkte und Qualität
  berechnet dieselbe Logik wie in der App (`autoEvaluate`). Fehlen Angaben für Länge/Intensität/Komplexität
  oder fürs Resultat (Süsse, Säure, Tannin, Körper, Trinkreife …), fragt der Bot nach: [✏️ Ergänzen]
  [💾 Trotzdem speichern]. Sonst: [💾 Speichern] [✏️ Korrigieren] [📱 In der App bearbeiten], dazu
  Person wechseln (Standard Michel) und Verwerfen.
- **📋 Vollständig:** Link auf `/flasche/<id>/verkostung` mit vorausgefülltem Wein und Jahrgang.
- Gespeichert wird in `wine_tastings` mit `source = 'bot'` und demselben `sat`-JSON wie in der App
  (`src/lib/tasting/store.ts`, von App und Bot genutzt); in der App normal bearbeitbar, die Herkunft bleibt.
- Der Entwurf liegt bis zum Speichern in `ingest_jobs` (`source = 'telegram_tasting'`, Stand in `extracted`);
  nach „Erzählen“/„Ergänzen“ geht der nächste Freitext (innerhalb einer Stunde) an die Verkostung.

### Chat-Modus (Textnachrichten)

Freier Text (wenn kein Foto-Eintrag gerade auf Anzahl, Preis usw. wartet) geht an Claude mit Werkzeugen
über die Datenbank (`src/lib/chat/`): zuerst `claude-haiku-5-5`, bei Ablehnung, Fehler oder abgeschnittener
Antwort nochmals mit `claude-sonnet-5-5`.

- **Lesen:** Bestand suchen (`cellar_wine_summary` / `cellar_wines` inkl. Lagerorte), offene Flaschen mit
  Füllstand und Tagen seit dem Öffnen, Trinkreife, Bewertungen (`latest_wine_ratings`), Verkostungen
  (`wine_tastings`), letzte Journal-Einträge (`inventory_events`).
- **Ändern – nur nach [Ja]:** Füllstand (ein Glas ≈ 150 ml, Prozent relativ zur Flaschengrösse; leer =
  ausgetrunken), Flasche öffnen über `open_bottle()` (bei mehreren Lagerorten/Grössen fragt der Bot nach),
  ausgetrunken markieren, Bewertung für Michel oder Sara. Der Vorschlag steckt vollständig im
  `callback_data` des [Ja]-Buttons und wird beim Klick gegen den aktuellen Zustand geprüft; ein zweiter Klick
  bewirkt nichts.
- **Verlauf:** die letzten 10 Nachrichten pro Chat in `telegram_chat_messages` (nur Text); `/reset` löscht ihn.
  Ohne diese Tabelle läuft der Chat ohne Gedächtnis.

| Variable (Vercel) | Zweck |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token von @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | frei gewähltes Secret (Buchstaben, Ziffern, `_`, `-`; bis 256 Zeichen) |
| `TELEGRAM_ALLOWED_USER_ID` | deine numerische Telegram-User-ID |
| `ANTHROPIC_API_KEY` | Claude API |
| `SUPABASE_SECRET_KEY` | Secret Key (`sb_secret_…`) – umgeht RLS, nur serverseitig |

**Webhook registrieren:** nach dem Deployment eingeloggt `https://<produktion>/api/telegram/setup` öffnen.
