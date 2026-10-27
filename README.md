# MyWine

Persönliche Weinsammlungs-App – Next.js (App Router, TypeScript) mit Supabase (`@supabase/ssr`), Deployment auf Vercel.

## Funktionen (Meilenstein 1)

- **Login per Magic Link** (`/login` → Mail → `/auth/confirm`). Die angemeldete Person kommt aus
  `persons.user_id` (oben im Kopf angezeigt); Bewertungen und Verkostungen sind für sie vorausgewählt, die
  andere Person bleibt wählbar. Angemeldet, aber nicht in `app_members` → Seite „Kein Zugang“ (`/kein-zugang`).
- **Lagerort-Wahl** oben rechts (Alle / Räume aus `storage_locations`): filtert alle Listen und Zahlen,
  gemerkt im Cookie `mywine_lagerort`. Offene Flaschen ohne Lagerort erscheinen nur unter „Alle“.
- **Bestand** (`/`): ein Eintrag pro Wein (`cellar_wine_summary` + `cellar_wines`) mit Flaschenzahl und
  Jahrgängen, Suche und Gruppierung nach Weintyp, Land (mit Flagge), Rebsorte, Jahrgang, Preisklasse
  (bis 30 / 30–60 / 60–100 / 100–200 / über 200 CHF) oder Trinkreife. Bei Jahrgang, Preisklasse und Trinkreife steht ein Wein in jeder
  passenden Gruppe mit deren Flaschenzahl, bei Rebsorte Cuvées unter jeder Traube. Gruppen laden zugeklappt
  (Titel, Symbol bzw. Flagge, Flaschenzahl); bei aktiver Suche gehen die Gruppen mit Treffern auf. Kacheln: Bestand
  (Flaschen, Weine, Jahrgänge, Bestandswert bezahlt/normal), offene Flaschen (Tage seit Öffnen), Käufe des
  Jahres (aus dem Journal `inventory_events`) und Trinkreife. Weintypen als Trauben-Symbole
  (`src/components/wine-type-icon.tsx`); Logik in `src/lib/cellar/overview.ts`.
- **Trinkreife** (App und Bot gleich, `drinkStatus` in `src/lib/cellar/overview.ts`, aus dem Trinkfenster des
  jeweiligen Jahrgangs, nicht aus der View-Spalte `drink_status`): „Über dem Höhepunkt“ (bis < aktuelles Jahr),
  „Jetzt trinken“ (bis = aktuelles Jahr), „Trinkreif“ (ab ≤ aktuelles Jahr < bis), „Noch lagern“
  (ab > aktuelles Jahr), „Unbekannt“ (kein Trinkfenster). Jede Karte in Bestand und Offen zeigt klein den Status
  mit Fenster („Trinkreif · 2024–2032“, bei verschiedenen Jahrgängen eine Zeile je Jahrgang). Ein Tipp darauf
  (auch auf der Weinseite und in der Kachel Trinkreife) öffnet den Bestand nach Trinkreife gruppiert
  (`/?gruppe=trinkreife&reife=…#gruppe-trinkreife-…`), diese Gruppe aufgeklappt und angesprungen.
- **Offen** (`/offen`) und **Getrunken** (`/getrunken`) sind wie der Bestand aufgebaut und nutzen dieselben
  Komponenten (`src/components/cellar/`: Suche/Gruppierung, einklappbare Gruppen, Weinkarte) und dieselbe
  Gruppierungslogik (`groupWines` über `Groupable`-Einträge, `src/lib/cellar/lists.ts`); die Lagerort-Wahl gilt.
  - Offen: eine Karte pro offener Flasche mit Füllstand und Tagen seit dem Öffnen; Kacheln: Anzahl offen, am
    längsten offen, Ø Füllstand.
  - Getrunken: ein Eintrag pro Wein mit Anzahl, letztem Trinkdatum (`drunk_at`) und neuester Bewertung je Person
    (sonst die alte Import-Bewertung); zusätzliche Gruppierung „Getrunken am“ (Jahr, darin Monate). Kacheln:
    getrunken dieses Jahr, Lieblingsweine (beste Bewertungen), zuletzt getrunken.
  - Flaschen ohne Lagerort (Import) erscheinen nur unter „Alle“; die Kachel nennt ihre Anzahl.
  - **Etikettfotos:** links auf der Karte das Vorschaubild der Vorderseite (`wine_media.kind = label_front`,
    gewählter bzw. neuester Jahrgang; ohne Foto das Trauben-Symbol). Pro Seite eine Abfrage und ein
    `createSignedUrls`-Aufruf (`loadLabelPhotos` in `src/lib/media/store.ts`). Antippen des Bilds öffnet das
    Overlay (Vorderseite, wischen zur Rückseite, schliessen per Tippen, X oder Escape); der Rest der Karte
    führt wie bisher zur Weinseite.
- **Weinseite** (`/wein/[id]?jahrgang=2019`): eine Seite pro Wein, Ziel aller Klicks aus Bestand, Offen und
  Getrunken (`wineHref` in `src/lib/cellar/wine-page.ts`). Kopf über die volle Breite: Name, Produzent,
  Jahrgang-Umschalter (`ohne` = ohne Jahrgang), Flaschenzahl. Darunter drei feste Spalten (iPad quer); hochkant
  links Öffnen mit Bewertungen darunter, rechts „Zum Wein“; iPhone eine Spalte (Öffnen, Zum Wein, Bewertungen).
  Alles Jahrgangsabhängige folgt der Auswahl.
  1. **Flasche öffnen** (gibt es offene Flaschen, steht die Kachel „Offen“ darüber): Chargen mit Lagerort, Anzahl, bezahltem Preis, Normalpreis und Rabatt in % (je Charge
     im Bearbeiten-Modus); Füllstand, Datum, Knopf → `public.open_bottle()` mit der `inventory_item`-ID der Charge.
     Darunter offene Flaschen (Füllstand, **Ausgetrunken**; `drunk_at` setzt die DB) und getrunkene Flaschen,
     jeweils mit Preis. Ohne ungeöffnete Flasche fehlt nur der Öffnen-Bereich.
  2. **Zum Wein** (eine Kachel, Abschnitte mit Trennlinie): Stammdaten (Typ, Land, Region, Appellation, Alkohol, Fotos), Rebsorten mit Prozentanteil aus
     `wine_grape_shares` (jahrgangsspezifisch, sonst „alle Jahrgänge“), bearbeitbar (`source = manual`) und per
     **Nachrecherchieren** neu recherchierbar; Trinkreife (Fenster aus `wine_vintages`, dazu die letzte Verkostung).
     **Fotos** des Jahrgangs als Vorschau mit demselben Overlay; **📷 Foto hinzufügen** (Vorderseite, Rückseite,
     Weiteres): der Browser verkleinert auf max. 2000 px JPEG (auch HEIC vom iPhone), der Server legt das Original
     unter `wine-photos/app/<wine-id>/…` ab, erzeugt das Vorschaubild und schreibt `wine_media`.
     **Dokumente** (PDF, `wine_media.kind = document`, privater Bucket `wine-documents`) des Jahrgangs und ohne
     Jahrgang mit 📄 und Dateiname; Antippen öffnet das PDF über eine signierte URL in einem neuen Tab. Im
     Bearbeiten-Modus hochladen (max. 10 MB; der Browser lädt direkt in den Bucket, weil Vercel nur 4.5 MB pro
     Request annimmt – der Server prüft danach Ort, Typ und Grösse und trägt das Dokument ein) und löschen mit
     Rückfrage (Datei serverseitig mitgelöscht). **Nachrecherchieren** (ergänzt alle leeren Angaben des Weins,
     ohne Rückfrage) und der Link zum Sammellauf (`/recherche`) stehen auch in der normalen Ansicht; `/recherche` ist zudem in der Navigation (🔎). Je Foto
     **Ersetzen** und **Löschen** mit Rückfrage; eine neue Vorder-/Rückseite ersetzt die vorhandene (ebenfalls
     nach Rückfrage). Gelöscht werden Zeile, Original und Vorschaubild – die Dateien über den Admin-Client
     (Mitglieder dürfen im Bucket nur lesen und hochladen), erst nach Prüfung der Mitgliedschaft.
  3. **Bewertungen:** subjektiv je Person mit halben Sternen 0–5 in `wine_ratings` (neueste je Person aus
     `latest_wine_ratings`; pro Person und Tag eine, ältere als Verlauf) sowie objektiv die WSET-Verkostungen mit
     „Neue Verkostung“ und Liste.
  - Jahrgangsbezogene Aktionen hängen an einer Flasche des Jahrgangs (offen vor ungeöffnet vor getrunken).
  - **✏️ Bearbeiten** (`?bearbeiten=1`): Formulare statt Anzeige, jedes mit Speichern/Abbrechen – Wein (Name,
    Produzent, Typ, Land, Region, Appellation, Alkohol; gleicher Name + Produzent wie ein anderer Wein wird
    abgelehnt), Jahrgang (über `public.change_vintage()`, ganzer Jahrgang samt Bewertungen, Verkostungen,
    Rebsorten, Fotos; bestehender Ziel-Jahrgang → Rückfrage und Zusammenführen) und Trinkfenster, je Charge
    Anzahl, Flaschengrösse, Lagerort (auch nur ein Teil der Flaschen), Kaufdatum, Händler, Geschenk, Preise,
    Jahrgang nur dieser Charge und Löschen (Rückfrage); offene Flasche: Füllstand, „Geöffnet am“; getrunkene:
    „Getrunken am“, zurück auf offen. Rebsorten (Bearbeiten, Nachrecherchieren), Fotos (hinzufügen, ersetzen,
    löschen) und Bewertungen löschen gibt es nur hier; in der Anzeige bleiben Öffnen, Füllstand und Sterne.

### Gemeinsames Bearbeiten-Modul (App und Bot)

`src/lib/edit/`: Jede Änderung ist ein `Edit` (`types.ts`, JSON-tauglich). `prepareEdit` prüft gegen den
aktuellen Stand und liefert vorher → nachher plus Hinweise; `applyEdit` prüft nochmals und führt aus – mit
derselben Meldung („2 Flaschen ins Wohnzimmer verschoben“) in App und Bot. Die App liest ihre Formulare über
`form.ts` und speichert über eine Server Action (`edit-actions.ts`); der Bot schlägt über Chat-Tools vor.
Verschieben (ganz oder teilweise) läuft nur über `public.move_bottles()`: atomar, führt mit einer gleichen
Charge am Ziel zusammen und schreibt genau einen Journal-Eintrag „verschoben“. Wird „Getrunken am“ geändert,
zieht ein Trigger den Journal-Eintrag „getrunken“ mit.
  - `/flasche/[id]` leitet auf die Weinseite mit dem Jahrgang der Flasche weiter (Bot-Links, Lesezeichen).
- **Weintyp-Filter:** in Bestand, Offen und Getrunken bei den Gruppierungen Land, Rebsorte, Jahrgang,
  Preisklasse (und „Getrunken am“): Alle / Rot / Weiss / … mit Trauben-Symbolen, nur vorhandene Typen
  (`?typ=`), zusätzlich zur Lagerort-Wahl.
- **WSET-Verkostung** (`/flasche/[id]/verkostung`, bearbeiten mit `?t=<id>`): Nachbau des
  [Verkostungs-Tools](https://gc68rqg4ch-lang.github.io/WSET-Verkostungs-tool/) mit gleichen Feldern, Optionen,
  Aromen-Lexikon und Punkte-Logik (`src/lib/tasting/sat.ts`). Gespeichert in `wine_tastings`: Stil, Qualität,
  Punkte (in halben Schritten) und Trinkreife als Spalten, das komplette Formular als JSON in `sat`
  (Schlüssel wie im Tool).
- **Recherche** (`/recherche`, 🔎 in der Navigation – öffnet nur die Seite, startet nie etwas): zuerst die
  Übersicht, wie viele Weine welche Lücke haben (Rebsorten ohne %, Rebsorten fehlen, Alkohol, Trinkfenster,
  Region/Appellation) – jeweils „im Bestand“ (ungeöffnete oder offene Flaschen, egal welcher Lagerort) und „alle, auch ausgetrunkene“ – mit der Liste der
  Weine. Umfang wählbar: „Nur Weine im Bestand“ (Standard) oder „Alle Weine, auch ausgetrunkene“. Start nur nach Bestätigung („Ich recherchiere jetzt X Weine. Das
  dauert etwa Y Minuten. Starten?“), dann Fortschritt „7 von 20“ mit Abbrechen (Gefundenes bleibt gespeichert)
  und eine Zusammenfassung. Die Zeitschätzung beginnt mit 60 s pro Wein und nimmt danach den gemessenen Schnitt.
  Option „Auch vollständige Weine prüfen“ (`?vollstaendig=1`, Standard aus): dann alle Weine der Auswahl, auch
  ohne Lücken – Abweichungen werden Vorschläge, nichts wird überschrieben. Die Bestätigung nennt beide Zahlen
  („2 Weine mit Lücken, 2 vollständige zur Kontrolle“) und die geschätzte Dauer. `wines.researched_at` wird nach
  jeder erfolgreichen Recherche gesetzt (Nachrecherchieren, Sammellauf, Bot), auch ohne Fund; Option „In den
  letzten 7 Tagen geprüfte überspringen“ (Standard an, `?kuerzlich=1` schaltet aus) – die Bestätigung nennt die
  Zahl der übersprungenen. Die Weinseite zeigt „Zuletzt recherchiert am …“ beim Nachrecherchieren.
- **Recherche pro Wein, immer vollständig** (`src/lib/research/`): ein Durchgang mit `claude-sonnet-5-5` +
  `web_search` (`researchWineWeb`) für alle leeren Angaben – Produzent, Land, Region, Appellation, Typ, Alkohol,
  Trinkfenster je Jahrgang, Rebsorten mit %. Vorhandenes wird nie überschrieben (Stammdaten nur wenn leer,
  Trinkfenster nur leere Teile, Rebsorten nur ohne % bzw. ganz fehlend, manuelle bleiben); Rebsorten mit
  `source = research`. Gilt für 🔎 Nachrecherchieren auf der Weinseite (ohne Rückfrage, alle Jahrgänge mit
  Flaschen), den Sammellauf und die Erfassung im Bot. `wines.grapes` bleibt vorerst bestehen.
- **API-Fehler** (`src/lib/ai/api-errors.ts`): Das Nutzungslimit (400 „reached your specified API usage
  limits“) wird erkannt – der Sammellauf stoppt sofort und meldet „Das monatliche API-Limit ist erreicht. Wieder
  verfügbar am …“ (Datum aus der Meldung), ebenso Nachrecherchieren auf der Weinseite und der Bot in der Ich-Form
  (Recherche, Chat, Erfassung, Verkostung; kein zweiter Versuch mit Sonnet). Andere API-Fehler: Der Sammellauf
  hält nach 3 Fehlern in Folge an und zeigt den Fehler. Bereits Gefundenes bleibt gespeichert.
- **Abweichungen = Vorschläge** (`research_suggestions`): Die Recherche liefert immer alle Angaben. Leeres
  wird direkt gefüllt; weicht ein gefundener Wert vom gespeicherten ab, wird nichts überschrieben, sondern ein
  Vorschlag angelegt (Felder wie in der Check-Liste der Tabelle, `grapes` als `[{grape, percent}]`). Toleranzen:
  Alkohol ±0.2, Rebsorten-% ±2 pro Sorte, Texte ohne Gross-/Kleinschreibung und Akzente. Ein offener Vorschlag
  fürs gleiche Feld wird aktualisiert (erst lesen, kein Upsert – Ausdrucks-Index); früher abgelehnte Werte kommen
  nicht wieder. Rebsorten ohne % mit gleichen Sorten bekommen die % direkt. Entscheiden: auf der Weinseite
  (Box „Ich habe Abweichungen gefunden“ in „Zum Wein“), oben auf `/recherche` („Offene Vorschläge (N)“, nach Wein
  gruppiert) und im Bot. [Übernehmen] schreibt über das gemeinsame Bearbeiten-Modul (Rebsorten über
  `replace_grape_shares`, `source = research`) und setzt `status`, `decided_at`, `decided_by`; [Behalten] lehnt ab.
  Code: `src/lib/research/compare.ts` (Vergleich), `suggestions.ts` (Speichern/Entscheiden).
- **Strict-Schemas:** Die Recherche meldet ihr Ergebnis über ein strict-Tool. Strict kennt keine Grenzen wie
  `minimum`/`maximum` (entstehen auch durch `z.number().int()`), `minLength`/`maxLength`, `maxItems` usw. –
  Wertebereiche (Alkohol 0–25 %, Jahre 1800–2100, Prozente 0–100) prüft der Code nach der Antwort und verwirft
  Ungültiges. `strictSchemaProblems` (`src/lib/ai/schema-limits.ts`) prüft das vor jedem Aufruf und im Test.

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

### Tests

`npm test` führt alle Tests unter `tests/` aus (`node:test` über `tsx`). Sie brauchen weder eine echte
Datenbank noch API-Schlüssel und legen nichts in der Produktions-DB an:

- `tests/env.ts` setzt Platzhalter für alle Umgebungsvariablen (jede Testdatei importiert es zuerst).
- `tests/stub-net.ts` ersetzt `fetch`: Telegram, Claude API (auch Fehlerantworten wie das Nutzungslimit),
  PostgREST und Supabase Storage als kleine Nachbildung im Speicher – für Abläufe über den Admin-Client.
- `tests/fake-db.ts` ist ein Supabase-Client im Speicher für Funktionen, die den Client übergeben bekommen
  (Menüs, Details, Verkostung), inkl. eingebetteter Beziehungen wie `wine:wines(…)`.

Abgedeckt: Bot-Zugang und `/id` (`access`), Bewerten (`rating`), Wein-Menü (`wine-menu`), Details (`details`),
Erfassung per Foto, Text, Nachkauf und Jahrgang-Pflicht (`photo-ingest`, `text-ingest`, `ingest-helpers`),
Fotos nachreichen (`photo-attach`, `media-*`), Bearbeiten-Modul inkl. `move_bottles` und `change_vintage`
(`edit`), Weinseite (`wine-page`), Übersicht, Typ-Filter und Gruppierungen inkl. Trinkreife (`overview`,
`lists`, `drink-status`), Verkostung (`tasting`), Recherche mit Lücken, Vorschlägen und Limit-Stopp
(`research`, `api-errors`) sowie die Schema-Grenzen der Claude API (`schema-limits`).

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
Die Bestätigung („Ich habe 6 Flaschen Pintia 2019 im Weinkeller eingebucht. Möchtest du gleich eine öffnen oder
bewerten?“) bringt gleich das Wein-Menü dieses Jahrgangs mit (`savedWineKeyboard`): 🍾 Öffnen mit der eben
gespeicherten Charge vorausgewählt (über `open_bottle()` wie im normalen Menü), ⭐ Bewerten, ⭐ für die andere
Person, 📝 Verkostung, ℹ️ Details, 📷 Foto, ✏️ Bearbeiten und der Link in die App – auch bei Text-Erfassung
und Nachkauf.
Das Journal (`inventory_events`) schreibt die DB per Trigger – der Bot schreibt keine eigenen Einträge.

- **Fotos → `wine_media`:** beim Speichern je Foto eine Zeile mit `wine_id`, `vintage_year`,
  `inventory_item_id` und `kind` (`label_front`/`label_back`, weitere `photo`). Welche Seite welches Foto ist,
  sagt die Erkennung (`image_sides`), sonst gilt: erstes Foto Vorderseite, zweites Rückseite. Dazu ein
  Vorschaubild (160 px breit, WebP, `sharp`) neben dem Original (`….thumb.webp`) in `thumb_path`. Schlägt das
  fehl, wird die Flasche trotzdem gespeichert; die Pfade stehen weiterhin auch in `inventory_items.photo_urls`.

- **Erkennung:** `claude-haiku-5-5` mit beiden Bildern und strukturierter JSON-Ausgabe; bei Konfidenz < 0.7
  nochmals mit `claude-sonnet-5-5` (mit serverseitigem Fallback bei Ablehnungen).
- **Abgleich:** danach gegen bestehende Weine (Name + Produzent, ohne Gross-/Kleinschreibung). Bekannte Weine
  werden wiederverwendet und ihre Stammdaten übernommen.
- **Websuche:** ein Durchgang für alles, was fehlt – auch bei bekannten Weinen: Produzent, Land, Region,
  Appellation, Typ, Alkohol, Trinkfenster des Jahrgangs und Rebsorten mit % (`enrichFromWeb` über
  `researchWineWeb`, dieselbe Recherche wie `/recherche`). Name und Jahrgang kommen immer vom Etikett bzw. Text;
  bei bekannten Weinen werden beim Speichern nur leere Stammdaten ergänzt.
- **Rebsorten:** Prozentanteile vom Etikett (`source = label`); sonst gespeicherte des bekannten Weins; sonst die
  aus der Recherche (`source = research`).
  Ohne belegte Prozente werden nur die Rebsorten gespeichert. Manuelle Angaben werden nie überschrieben.
  Gespeichert wird atomar über `public.replace_grape_shares(wine_id, vintage_year, shares)` – auch von der
  Detailseite und vom Sammellauf.
- **Korrigieren:** Freitext-Antwort, die per `claude-haiku-5-5` in den Vorschlag übernommen wird.
- **Album:** Telegram schickt jedes Foto einzeln. Alle Fotos eines Albums landen über eine aus
  `media_group_id` abgeleitete Job-ID im selben Job; erkannt wird nach 3 s Ruhe, genau einmal.
- **Zugang:** Webhook prüft `X-Telegram-Bot-Api-Secret-Token`. Freigeschaltet sind alle Telegram-User, deren ID in
  `persons.telegram_user_id` steht; `TELEGRAM_ALLOWED_USER_ID` gilt als Rückfall für Michel. Unbekannte bekommen im
  Einzelchat nur „Ich kenne dich noch nicht – deine Telegram-ID ist …“, sonst nichts. `/id` zeigt die eigene ID.
- **ℹ️ Details** nennt vorhandene Dokumente und offene Recherche-Vorschläge mit Link zur Weinseite.
- **🔎 Nachrecherchieren** (unter ✏️ Bearbeiten im Wein-Menü oder per Chat, Tool `research_wine`): ich
  recherchiere in ~1 Minute, melde, was ich ergänzt habe, und frage bei jeder Abweichung einzeln nach („Ich habe
  beim Alkohol 14.5 % gefunden, bei dir steht 15 %. Übernehmen?“ [Ja] [Nein], Knöpfe `rs:<id>:y|n`).
- **Wer schreibt:** Der Bot spricht die Person mit Namen an; Bewertungen und Verkostungen gehen an sie. Im Menü
  heisst das „⭐ Bewerten“; für die andere Person („⭐ für Sara“) fragt er vor dem Speichern nach. Der
  Gesprächsverlauf ist pro Chat getrennt. `SUPABASE_SECRET_KEY` wird nur in `src/lib/supabase/admin.ts` (server-only) gelesen.

### Fotos zu einem Wein nachreichen (📷 Foto)

Im Wein-Menü (Jahrgang bzw. offene Flasche) **📷 Foto** → Vorder- und Rückseite als Album schicken (Vorderseite
zuerst). Ablauf in `src/lib/ingest/attach.ts`, `ingest_jobs.source = 'telegram_attach'`, Knöpfe `A:<aktion>:<job>`:
- Die Fotos gehen an den gewählten Wein und Jahrgang (bei einer offenen Flasche auch an sie) als `wine_media` mit
  Vorschaubild – keine neue Charge. Fotos innerhalb von 30 Minuten nach dem Tipp gehören dazu, danach wieder zur
  normalen Erfassung.
- Album: erstes Foto Vorderseite, zweites Rückseite. Einzelfoto: Frage [Vorderseite] [Rückseite].
- Gibt es die Seite für den Jahrgang schon: Rückfrage [🔁 Ersetzen] [✖️ Abbrechen]. Ersetzen speichert erst die
  neuen Fotos und löscht dann die alten samt Dateien. Abbrechen löscht die geschickten Fotos.

### Jahrgang ist Pflicht (Foto und Text)

Fehlt der Jahrgang oder hat die Erkennung ihn nicht sicher gelesen (`vintage_certain`), fragt der Bot vor den
Kaufangaben nach: Jahreszahl schreiben, „✅ 2019 stimmt“ oder „Ohne Jahrgang (NV)“. Der Jahrgang steht immer
im Vorschlag bzw. in der Zusammenfassung.

### Erfassung per Text (ohne Foto)

Freitext wie „Pintia 2019, 6 Flaschen, Weinkeller, 66 Franken bei Mövenpick“ – im Chat (Claude erkennt den Kauf
und ruft `start_wine_entry` auf) oder nach „📷 Neuer Wein“ (die nächste Textnachricht innerhalb von 30 Minuten).
Ablauf in `src/lib/ingest/flow.ts`, `ingest_jobs.source = 'text'`:
- Erkennen (`parseTextEntry`, Haiku/Sonnet, Schema `TextEntrySchema` mit Kaufangaben), dann wie bei Fotos: Abgleich
  mit bestehenden Weinen (ohne Produzent über einen eindeutigen Namen), sonst Websuche (Produzent, Herkunft, Typ,
  Alkohol, Trinkfenster des Jahrgangs) und Rebsorten mit %.
- Liegt der Wein mit dem Jahrgang schon im Bestand: „Nachkauf zu bestehendem Wein?“ → nur eine neue Charge.
- Danach nur, was im Text fehlt: Lagerort, Anzahl, Preis, Normalpreis, Händler (`nextPurchaseStep`); zum Schluss
  eine Zusammenfassung mit [Ja] [Nein]. Der Händler aus dem Text wird erst beim Speichern angelegt.
- Das Trinkfenster wird in `wine_vintages` übernommen, wenn dort noch keines steht (auch bei der Foto-Erfassung).

### Menüs (Knöpfe)

- **Menüleiste unten** (Reply-Keyboard, kommt mit `/start` bzw. `/help`): 🍷 Offen · 📦 Bestand · ⏰ Trinkreif ·
  📷 Neuer Wein. Bestand zeigt zuerst die Weintypen, dann die Weine des Typs. ⏰ Trinkreif nutzt dieselbe
  Einteilung wie die App (⚠️ über dem Höhepunkt, ⏰ jetzt trinken, ✅ trinkreif, ⏳ noch lagern, ❔ unbekannt).
- **Listen:** pro Wein eine Zeile mit Emoji statt Weintyp (🍷 Rot, 🥂 Weiss, 🌸 Rosé, 🍾 Schaumwein,
  🍯 Süss/Likör, 🟠 Orange), z. B. „🍷 Palermo 2022 · 50 % · seit 216 T.“; Produzent bzw. Lagerort nur, wenn nötig
  zur Unterscheidung. Darunter je Wein ein Knopf (8 pro Seite, dann „Mehr…“).
- **ℹ️ Details** im Wein-Menü: kompakte Nachricht zum Jahrgang (Name, Produzent, Herkunft mit Flagge, Rebsorten
  mit %, Alkohol, Trinkreife, Flaschen je Lagerort, offene Flaschen mit Füllstand, Preise mit Rabatt, Bewertungen,
  letzte Verkostung, Link auf die Weinseite); leere Angaben fallen weg (`src/lib/chat/details.ts`). Darunter
  dieselben Knöpfe wie im Wein-Menü.
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
  `src/lib/tasting/sat.ts` zu (`src/lib/tasting/extract.ts`); nicht Erwähntes bleibt leer. Das Schema kommt ohne
  nullable-/Union-Felder aus (Enum-Wert „nicht_erwähnt“, leere Liste bzw. leerer String) – die API erlaubt höchstens
  16 davon pro Schema (`src/lib/ai/schema-limits.ts`). Punkte und Qualität
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
- **Ändern – nur nach [Ja]:** Flasche öffnen über `open_bottle()`, ausgetrunken markieren, Bewertung (kurze
  Vorschläge stecken ganz im `callback_data`) sowie alles, was die App bearbeiten kann – über das gemeinsame
  Modul (`edit-tools.ts`: `get_wine_details`, `list_batches`, `propose_wine_edit`, `propose_vintage_change`,
  `propose_drink_window`, `propose_batch_edit`, `propose_move`, `propose_delete_batch`,
  `propose_open_bottle_edit` (auch Gläser à 150 ml), `propose_drunk_bottle_edit`, `propose_grapes`,
  `propose_delete_rating`, `propose_tasting_edit`, `propose_delete_tasting`). Diese Vorschläge zeigen vorher →
  nachher und liegen bis zur Antwort in `ingest_jobs` (`source = telegram_edit`, Knöpfe `ce:`/`cn:<job>`).
  Beim Klick wird gegen den aktuellen Stand geprüft; ein zweiter Klick bewirkt nichts. Passen mehrere Weine
  oder Chargen, fragt Antoine nach. Jahrgänge in den Tools: 0 = ohne Jahrgang (keine nullable-Felder).
- **✏️ Bearbeiten im Wein-Menü:** fragt nach dem Bereich (Wein, Jahrgang & Trinkfenster, Chargen & Lagerort,
  Rebsorten, Bewertungen, Verkostungen), zeigt den aktuellen Stand und erwartet die Änderung als Text.
- **Ich-Form:** Der Bot heisst Antoine, spricht in der Ich-Form und duzt („Ich habe 2 Flaschen verschoben“).
- **Verlauf:** die letzten 10 Nachrichten pro Chat in `telegram_chat_messages` (nur Text); `/reset` löscht ihn.
  Ohne diese Tabelle läuft der Chat ohne Gedächtnis.

| Variable (Vercel) | Zweck |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token von @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | frei gewähltes Secret (Buchstaben, Ziffern, `_`, `-`; bis 256 Zeichen) |
| `TELEGRAM_ALLOWED_USER_ID` | optional: Rückfall-Zugang (gilt als Michel); sonst `persons.telegram_user_id` |
| `ANTHROPIC_API_KEY` | Claude API |
| `SUPABASE_SECRET_KEY` | Secret Key (`sb_secret_…`) – umgeht RLS, nur serverseitig |

**Webhook registrieren:** nach dem Deployment eingeloggt `https://<produktion>/api/telegram/setup` öffnen.
