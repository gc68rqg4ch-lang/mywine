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
- **Verkostet** (`/verkostet`, Reiter zwischen Getrunken und Recherche): Weine, die wir irgendwo probiert
  haben (`wine_encounters`) – unabhängig vom Bestand; ein Wein bleibt hier, auch wenn er gekauft wird. Gleicher
  Aufbau wie die anderen Listen (Kacheln, Suche, Weintyp-Filter, Gruppierung nach Weintyp, Land, Rebsorte,
  Jahrgang, Preisklasse, dazu Ort, „Verkostet am“ und „Kaufen?“), ohne Lagerort-Wahl. Preisklasse nur für
  Flaschenpreise in CHF. Karte: letzter Ort und Datum, Bewertungen je Person, 🛒 beim Merker, „im Bestand: N“.
  - Erfassen (`/verkostet/neu`, Knopf oben) – schnell: Pflicht sind nur Name und Jahrgang (NV möglich). Reihenfolge:
    Name (mit Vorschlägen bestehender Weine) → Jahrgang → Bewertung(en) → Notiz; „Mehr Angaben“ (zugeklappt):
    Produzent, Weintyp, Land/Region, Ort (bestehend oder neu mit Art und Stadt), Preis pro Flasche/Glas in CHF, AED
    oder EUR, Anlass, Begleitung, Merker „Kaufen?“, Datum (Standard heute). Reihenfolge und Pflichtfelder in
    `src/lib/edit/encounter-form.ts`. Abgleich: mit Produzent über Name + Produzent; ohne Produzent nur über den
    Namen – ein Treffer wird genommen, bei mehreren erscheint eine Auswahl (oder „Neuen Wein anlegen“).
  - Speichern ist „alles oder nichts“: Wein (falls neu), Ort (falls neu), Eintrag und Bewertungen; schlägt ein Schritt
    fehl, wird das Angelegte wieder entfernt (Log „encounter save failed“), Meldung „Speichern ist fehlgeschlagen –
    nichts geändert.“ Fehlende Angaben später im ✏️-Modus der Weinseite oder per „🔎 Nachrecherchieren“ (füllt
    leere Felder, auch den Produzenten).
  - **Produzent ist freiwillig** (DB: `wines.producer` darf NULL sein). Fehlt er, wird er überall weggelassen
    (`wineName` in `src/lib/format.ts`); sortiert wird dann nach dem Namen. Im Bot genügt zum Speichern der Name;
    „gibt es den Wein schon“ ohne Produzent über einen eindeutigen Namen.
  - Weinseite, Spalte 3: Abschnitt „Verkostet“ mit allen Einträgen (neuester zuerst), im ✏️-Modus bearbeiten
    und löschen (samt den Bewertungen des Eintrags; WSET-Verkostungen bleiben). Merker „Kaufen?“ umschaltbar
    (die DB setzt ihn zurück, sobald ungeöffnete Flaschen eingebucht werden). Nur verkostete Jahrgänge sind in
    der Jahrgangswahl („verk.“).
  - WSET-Verkostung aus einem Eintrag: `/verkostet/[id]/wset` (ohne Flasche, `encounter_id` gesetzt).
  - Logik im gemeinsamen Modul (`src/lib/edit/encounters.ts`, Bearbeitungen `addEncounter`, `encounter`,
    `deleteEncounter`, `wantToBuy`), damit der Bot sie später nutzt; Liste in `src/lib/cellar/tasted.ts`.
- **Weinseite** (`/wein/[id]?jahrgang=2019`): eine Seite pro Wein, Ziel aller Klicks aus Bestand, Offen und
  Getrunken (`wineHref` in `src/lib/cellar/wine-page.ts`). Kopf über die volle Breite: Name, Produzent,
  Jahrgang-Umschalter (`ohne` = ohne Jahrgang), Flaschenzahl und darunter die **Büroklammer** für Dokumente.
  Darunter drei feste Spalten (iPad quer); hochkant links Flaschen mit Bewertungen darunter, rechts „Zum Wein“;
  iPhone eine Spalte. Alles Jahrgangsabhängige folgt der Auswahl.
  1. **Flaschen:** „Offen“ (Füllstand, **Ausgetrunken**), „Im Bestand“ (je Charge Lagerort, Anzahl, bezahlt,
     Normalpreis, Rabatt in %), „Flasche öffnen“ (Füllstand, Datum → `public.open_bottle()`) und „Getrunken“.
     Ohne Flaschen dieses Jahrgangs ein kurzer Hinweis und „＋ Flaschen erfassen“ – öffnet den Chat mit Antoine
     (`https://t.me/antoine_winebot`; anderer Name über `TELEGRAM_BOT_USERNAME`).
  2. **Zum Wein** (eine Kachel, Reihenfolge `WINE_DETAIL_FIELDS`/`WINE_SECTIONS` in
     `src/lib/cellar/wine-units.ts`): eine Tabelle mit Typ, Land, Region, Appellation, Alkohol, Flasche,
     **Rebsorten** („Cabernet Sauvignon 95 % · Malbec 5 %“, ohne Prozent nur die Namen; aus `wine_grape_shares`,
     jahrgangsspezifisch, sonst „alle Jahrgänge“) und **Trinkreife** (Status antippbar · Fenster aus
     `wine_vintages`); leere Zeilen fallen weg. Als letzte Zeile, ohne Überschrift, die **Fotos** des Jahrgangs
     (Vorschaubilder, Antippen öffnet gross). Hochladen (Vorderseite, Rückseite, Weiteres – der Browser verkleinert
     auf max. 2000 px JPEG, auch HEIC; der Server legt das Original unter `wine-photos/app/<wine-id>/…` ab und
     erzeugt das Vorschaubild), Ersetzen und Löschen (Rückfrage; Dateien über den Admin-Client nach Prüfung der
     Mitgliedschaft) als eigener Block am Ende des ✏️-Formulars „Zum Wein“ – das gilt sofort.
     **Recherche im Kopf:** dezentes 🔎 neben dem Weinnamen (`research-head.tsx`) öffnet ein kleines Feld mit
     „Nachrecherchieren“ (gewählter Jahrgang, inkl. Geschmacksprofil, ohne Rückfrage) und „Zuletzt recherchiert
     am …“; während der Recherche dreht sich das 🔎, danach eine kurze Meldung („3 Angaben ergänzt“, „1 Abweichung
     zum Prüfen“, „Nichts Neues gefunden“; `src/lib/research/summary.ts`). Abweichungen erscheinen wie bisher in
     „Zum Wein“; der Sammellauf bleibt auf `/recherche`. Das ✏️ von „Zum Wein“ öffnet ein Formular – zuoberst Name (Pflicht, getrimmt) und Produzent (leer → NULL); gibt es
     den Wein mit gleichem Namen und Produzenten schon (Gross-/Kleinschreibung egal), wird nichts gespeichert: „Diesen
     Wein gibt es schon …“ mit Link zum bestehenden Wein, kein Zusammenführen –, dazu Stammdaten, Rebsorten mit %
     und Trinkfenster des Jahrgangs zusammen (`kind = wineCard` in `src/lib/edit/form.ts` → Bearbeitungen `wine`,
     `grapes` nur wenn geändert, `drinkWindow`, zuletzt `vintage`); unter „Mehr“ Appellation, Alkohol und Jahrgang
     umbenennen.
  3. **Bewertungen:** subjektiv je Person mit halben Sternen 0–5 in `wine_ratings` (Sterne antippen speichert
     sofort; neueste je Person aus `latest_wine_ratings`, ältere als Verlauf), objektiv die WSET-Verkostungen mit
     „Neue Verkostung“ und Liste (Untertitel „WSET“), darunter „Verkostet“: ohne Einträge nur Titel und „＋ Erfassen“,
     sonst je Eintrag eine Zeile „2022 · 28.10.2026 · Kronenhalle · ★ 4“ (Fehlendes fällt weg), dahinter
     „🛒 kaufen“ beim Merker. Den Merker „Kaufen?“ setzt man beim Erfassen und im ✏️-Formular eines Eintrags.
  - Jahrgangsbezogene Aktionen hängen an einer Flasche des Jahrgangs (offen vor ungeöffnet vor getrunken).
  - **Bearbeiten direkt in der Karte** (`src/components/edit-unit.tsx`, Logik in `src/lib/cellar/wine-units.ts`):
    kein eigener Modus mehr. Jede Einheit hat oben rechts ein kleines ✏️ – Zum Wein (Stammdaten, Rebsorten mit %,
    Trinkfenster; unter „Mehr“ Appellation, Alkohol, Jahrgang umbenennen über `public.change_vintage()`, bestehender
    Ziel-Jahrgang → Rückfrage und Zusammenführen; am Ende die Fotos), jede Charge (Anzahl, Lagerort auch teilweise,
    bezahlt, Händler, Kaufdatum; unter „Mehr“ Normalpreis, Flaschengrösse, Jahrgang nur dieser Charge, Geschenk mit freiwilligem „von <Name>“ – `inventory_items.gift_from`, leer bzw. ohne Häkchen NULL; Anzeige „🎁 Geschenk von Anna“ unter der Preiszeile),
    jede offene (dazu Füllstand, „Geöffnet am“) und getrunkene Flasche („Getrunken am“; unter „Mehr“ zurück auf
    offen), Bewertungen (auch löschen, mit Rückfrage) und jeder Verkostet-Eintrag. Antippen macht nur diese Einheit
    zum Formular, unten genau ein „Speichern“ / „Abbrechen“ (Fotos: „Fertig“, Hochladen gilt sofort). Immer nur
    eine Einheit offen; hat sie ungespeicherte Änderungen, fragt die App vor dem Wechsel (und beim Verlassen der
    Seite). Eine Charge/Flasche ist ein Formular (`kind = batch` samt Füllstand bzw. „Getrunken am“), gespeichert
    über das gemeinsame Modul. Löschen bleibt im jeweiligen Formular. Felder im Raster mit Beschriftung darüber,
    auf dem iPhone einspaltig.
  - **Dokumente** (PDF, `wine_media.kind = document`, privater Bucket `wine-documents`) des Jahrgangs und ohne
    Jahrgang als **Büroklammer** im Kopf, rechtsbündig: je Dokument eine Zeile mit dem vollen Namen (notfalls
    umgebrochen) und 📎 ganz rechts; Antippen des Namens öffnet das PDF (signierte URL, neuer Tab). Ohne Dokument nur
    „📎“. Das 📎 öffnet ein kleines Feld: 🗑 löscht mit Rückfrage, „＋ Dokument hinzufügen“ lädt hoch (max. 20 MB; der
    Browser lädt direkt in den Bucket, weil Vercel nur 4.5 MB pro Request annimmt – der Server prüft danach Ort, Typ
    und Grösse und trägt das Dokument ein).
  - **🗑 Wein löschen**: dezenter roter Link ganz unten (siehe „Unwiderruflich löschen“).

### Gemeinsames Bearbeiten-Modul (App und Bot)

`src/lib/edit/`: Jede Änderung ist ein `Edit` (`types.ts`, JSON-tauglich). `prepareEdit` prüft gegen den
aktuellen Stand und liefert vorher → nachher plus Hinweise; `applyEdit` prüft nochmals und führt aus – mit
derselben Meldung („2 Flaschen ins Wohnzimmer verschoben“) in App und Bot. Die App liest ihre Formulare über
`form.ts` und speichert über eine Server Action (`edit-actions.ts`); der Bot schlägt über Chat-Tools vor.
Verschieben (ganz oder teilweise) läuft nur über `public.move_bottles()`: atomar, führt mit einer gleichen
Charge am Ziel zusammen und schreibt genau einen Journal-Eintrag „verschoben“. Wird „Getrunken am“ geändert,
zieht ein Trigger den Journal-Eintrag „getrunken“ mit.

### Unwiderruflich löschen (falsch erfasst)

Löschen heisst „falsch erfasst“, nicht „getrunken“ (`src/lib/edit/delete.ts`, Texte in `delete-text.ts`):

- **Flaschen** (`deleteBottles`): bei jeder Charge, offenen und getrunkenen Flasche „🗑 Flaschen löschen“, bei
  Chargen > 1 mit wählbarer Anzahl (Standard 1). Läuft über `public.delete_bottles(p_item_id, p_quantity)` (NULL
  oder ≥ Anzahl = ganze Position) mit genau einem Journal-Eintrag „deleted“. Die letzte Flasche weg → der Wein
  bleibt mit Bewertungen und Verkostungen. Auch das Chat-Tool `propose_delete_bottles` geht diesen Weg.
- **Ganzer Wein** (`deleteWine`): „🗑 Wein löschen“ ganz unten auf der Weinseite öffnet die rote Bestätigung. Die
  Rückfrage zeigt, was alles verschwindet („7 Flaschen …, 3 Bewertungen, …, 4 Fotos, 1 PDF“), darunter in Rot „Alles
  wird endgültig gelöscht und lässt sich nicht wiederherstellen.“ – dann „Abbrechen“ / „Endgültig löschen“ (ohne
  Namenseingabe). `public.delete_wine(p_wine_id)` löscht alles ohne
  Journal und liefert die Storage-Pfade; danach werden Originale und Vorschaubilder aus den Buckets entfernt
  (Admin-Client, serverseitig). Anschliessend zurück zur Liste (Zustand erhalten).
- **Bot:** unter ✏️ Bearbeiten „🗑 Flaschen löschen“ (Position wählen, Anzahl, Rückfrage „🗑 Löschen“ /
  „Abbrechen“) und „🗑 Wein löschen“ (Übersicht, dann „Ja, endgültig löschen“ / „Abbrechen“). Im Chat-Modus nur als
  Vorschlag (`propose_delete_bottles`, `propose_delete_wine`) mit Ja/Nein, nie direkt.
  - `/flasche/[id]` leitet auf die Weinseite mit dem Jahrgang der Flasche weiter (Bot-Links, Lesezeichen).
- **Listen allgemein** (Bestand, Offen, Getrunken, Verkostet – gemeinsame Ansicht `src/components/cellar/list-view.tsx`):
  - **Weintypen:** Rot, Weiss, Rosé, Schaumwein, Süsswein, Likörwein (`WINE_TYPES` in `src/lib/format.ts`). Orange gibt es
    nicht mehr (DB: Check-Constraint `wines_type_not_orange`; alte Werte gelten als „Unbekannt“).
  - **Gruppierung „Weintyp“:** grosse Knöpfe statt aufklappbarer Zeilen, darunter direkt die Liste des gewählten Typs
    (Standard Rot). Alle sechs Typen immer sichtbar, leere mit 0 und blass; Anzahl Flaschen (Verkostet: Weine).
    „Unbekannt“ nur, wenn es solche Weine gibt. In den anderen Gruppierungen bleibt der Weintyp-Filter (Alle + sechs Typen).
  - **Filter** (Knopf neben der Suche, Anzahl aktiver Filter am Knopf, „Zurücksetzen“): Land, Region (bei gewähltem
    Land nur dessen Regionen), Rebsorte (eine davon), Jahrgang von–bis, Preisklasse, Trinkreife, Bewertung ab x Sternen
    (Michel / Sara / eine von beiden), Händler. Nur Werte aus der aktuellen Liste. Jahrgang, Preisklasse, Trinkreife und
    Händler wirken je Flasche (ein Wein zeigt nur die passenden Flaschen). Reine Funktionen in `src/lib/cellar/filters.ts`.
  - **Zustand in der URL** (`src/lib/cellar/list-params.ts`): `gruppe`, `q`, `typ`, aufgeklappte Gruppen `auf`, Filter
    `land`, `region`, `traube`, `jv`/`jb`, `preis`, `reife`, `sterne`/`von_person`, `haendler`. „← Bestand“ (bzw. Offen,
    Getrunken, Verkostet) auf der Weinseite und die Browser-Zurück-Taste führen genau dorthin zurück, inkl.
    Scroll-Position (sessionStorage, `ListMemory`/`BackLink`). Der Lagerort bleibt im Cookie.
  - **Karten:** Inhalt oben ausgerichtet (Trinkreife direkt unter Jahrgang/Land), Platzhalter ohne Foto so gross wie ein
    Vorschaubild, lange Namen umbrechen. Spalten: iPhone 1, iPad hochkant 2, iPad quer 3.
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
  jeder erfolgreichen Recherche der Stammdaten gesetzt (Nachrecherchieren, Sammellauf, Bot), auch ohne Fund; Option
  „In den letzten 12 Monaten recherchierte überspringen“ (Standard an, `?kuerzlich=1` schaltet aus) – die Übersicht
  nennt „übersprungen, weil in den letzten 12 Monaten recherchiert: N“. Weiterhin werden nur leere Felder gefüllt.
  **Geschmacksprofil:** jede Profilsuche setzt `wine_vintages.taste_profile_checked_at` (auch ohne Fund; Sammellauf,
  automatische Suche nach Einbuchen/Verkostet, Nachrecherchieren). „Geschmacksprofil fehlt“ und der Sammellauf
  überspringen Jahrgänge, die in den letzten 12 Monaten gesucht wurden (gleiche Option), und suchen je Wein den
  neuesten Jahrgang ohne Profil; Jahrgänge mit Profil nie. Die automatische Suche überspringt kürzlich erfolglos
  gesuchte Jahrgänge. 🔎 „Nachrecherchieren“ auf der Weinseite (und „🔎 Geschmacksprofil recherchieren“ in der Karte)
  ignoriert die Regel. Regeln in `src/lib/research/gaps.ts` (`withinRecentMonths`, `tasteTargets`).
- **Recherche pro Wein, immer vollständig** (`src/lib/research/`): ein Durchgang mit `claude-sonnet-5-5` +
  `web_search` (`researchWineWeb`) für alle leeren Angaben – Produzent, Land, Region, Appellation, Typ, Alkohol,
  Trinkfenster je Jahrgang, Rebsorten mit %. Vorhandenes wird nie überschrieben (Stammdaten nur wenn leer,
  Trinkfenster nur leere Teile, Rebsorten nur ohne % bzw. ganz fehlend, manuelle bleiben); Rebsorten mit
  `source = research`. Gilt für 🔎 Nachrecherchieren auf der Weinseite (ohne Rückfrage, alle Jahrgänge mit
  Flaschen), den Sammellauf und die Erfassung im Bot. `wines.grapes` bleibt vorerst bestehen.
  **Weine ohne Flaschen** (nur verkostet) werden auch recherchiert: Früher lieferte `wineGaps` ohne Flaschen
  `null` und die Recherche meldete „complete“, ohne zu suchen. Jetzt zählen Jahrgänge aus „Verkostet“
  (`wine_encounters`) im Umfang „alle“ wie Flaschen; ohne Flaschen und ohne Verkostet werden die Stammdaten
  und das Geschmacksprofil gesucht.
- **Geschmacksprofil aus der Recherche** (`wine_taste_profiles`, `src/lib/taste/`, `src/lib/research/taste.ts`).
  Oberstes Ziel: kein falsches Profil – lieber „unbekannt“ oder gar kein Profil als geraten. Keine Freigabe:
  Belegtes gilt sofort. Eigener strict-Tool-Aufruf (`report_taste_profile`) nach der Stammdaten-Recherche;
  Merkmale als enum mit „unbekannt“ (keine nullable Felder), Aromen als enum aus dem Lexikon des Weintyps.
  `validateTasteProfile` prüft vor dem Speichern: nur Quellen zu genau diesem Wein; jedes Merkmal, Aroma,
  Beschreibung und Speiseempfehlung braucht ein Zitat (≤ 25 Wörter) mit `source_url` aus den Quellen, sonst
  „unbekannt“ bzw. weg; WSET-Begriffe nur bei klarer Entsprechung; Widersprüche → „unbekannt“ plus Hinweis in
  `source_note`; nichts Belegtes → kein Profil, Bestehendes bleibt. **Nur jahrgangsgenau:** gespeichert wird nur,
  wenn die Quellen genau den Jahrgang betreffen (`vintage_year` gesetzt); Notizen zu anderen Jahrgängen zählen
  nicht („Keine Angaben zu diesem Jahrgang gefunden.“). Ausnahme: Wein ohne Jahrgang (NV) → Profil für den Wein.
  Klare Beschreibungen werden übersetzt, wenn das Zitat eindeutig ist (`CLEAR_TERMS`: „sturdy/firm/grippy
  tannins“ → Tannin hoch, „full-bodied“ → Körper voll, „crisp/fresh acidity“ → Säure hoch). Sicherheit: hoch = ≥ 2 unabhängige Quellen (Website),
  davon Weingut oder Kritik, ohne Widerspruch; mittel = eine gute Quelle; niedrig = nur Händler. Neue Recherche
  überschreibt nur Profile mit `source = research`; ein Profil von Hand (✏️ in der Karte, `source = manual`) bleibt,
  der Fund wird Vorschlag (`research_suggestions.field = 'taste_profile'`; braucht die Migration
  `research_suggestions_taste_profile`, ohne sie passiert nichts). Nachrecherchieren und Bot suchen das Profil
  immer, der Sammellauf nur bei Weinen ohne Profil; Option „Geschmacksprofil fehlt“ (`?profil=1`) sucht nur das
  Profil. Kein automatischer Lauf beim Deploy. **Automatisch nach dem Erfassen** (`src/lib/research/taste-auto.ts`):
  nach dem Einbuchen (Foto, Text, auch Nachkauf) und nach einem Verkostet-Eintrag (Bot, App, Chat) wird im
  Hintergrund (`after()`) das Profil für genau diesen Jahrgang gesucht – erst speichern und antworten, dann
  recherchieren. Gibt es schon ein Profil für den Jahrgang, wird nicht gesucht; ohne Fund oder bei Fehlern
  (auch API-Limit) keine Meldung, nur Log „taste profile auto failed“. Weinseite: Karte „Geschmacksprofil“ – iPhone und iPad hochkant direkt nach „Zum Wein“, iPad quer zuoberst in
  Spalte 3 über „Bewertungen“ (CSS `display: contents` löst die Spalte „Zum Wein“ dann auf) –, nur für den
  gewählten Jahrgang, kurz und knapp (`taste-view.tsx`): einspaltig nur bekannte Merkmale (Name · 5-Punkte-Skala ·
  Wert), eine Reihe Aromen ohne Gruppentitel (Frucht → Floral → Gewürz → Eiche → Reife, höchstens 10), ein bis
  zwei Sätze zum Stil, „Passt zu: …“. Eigene WSET-Verkostungen erscheinen als Ring auf derselben Skala (Michel/
  Sara). Quellen, Belege und Sicherheit bleiben in der DB, die App zeigt sie nicht. Ohne Profil „🔎
  Geschmacksprofil recherchieren“. Bot ℹ️ Details: eine Zeile („👅 Vollmundig, trocken, viel Tannin – Brombeere, Kaffee“). Ohne
  Fund melden App und Bot „Keine verlässlichen Angaben gefunden.“
- **Angehängte PDFs als Quelle** (`src/lib/research/documents.ts`, `pdf-text.ts`): Nachrecherchieren, „🔎
  Geschmacksprofil recherchieren“, Sammellauf und die automatische Profilsuche schicken die PDFs des Weins als
  Dokument an Claude – zusätzlich zur Websuche. Nur für den gesuchten Jahrgang: PDFs mit diesem `vintage_year`;
  PDFs ohne Jahrgang nur, wenn der Jahrgang im PDF-Text eindeutig steht („Jahrgang/Vintage/Añada 2019“ oder
  „<Weinname> 2019“) und passt; andere Jahrgänge nie. Über 5 MB oder über 10 Seiten → übersprungen. Text, der sich
  ohne Bibliothek nicht lesen lässt (z. B. CID-Schriften), gilt als „Jahrgang unklar“. Werte aus dem PDF folgen
  denselben Regeln (Zitat, Widerspruch → unbekannt, nur leere Felder, Profil von Hand → Vorschlag); Quelle
  `{ url: null, document: "<Dateiname>", title: "Dokument: <Dateiname>", kind: "document" }`, Belege mit
  `source_url = "dokument:<Dateiname>"`. **Neues PDF** (App oder Bot, `insertDocumentRow`) mit Jahrgang und ohne
  Profil dafür → Profilsuche im Hintergrund, auch innerhalb der 12 Monate (PDF ohne Jahrgang: keine automatische
  Suche). Sammellauf und automatische Suche überspringen einen kürzlich gesuchten Jahrgang nicht, wenn danach ein
  PDF für genau diesen Jahrgang angehängt wurde (`newDocumentSince`). Lade-/Lesefehler: ohne dieses PDF weiter,
  Log „research document failed“. Keine Schemaänderung.
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
Verkostet im Bot – Absicht, Schnellablauf, Freitext, Abgleich ohne Produzent, alles oder nichts, leerer Wein (`tasted-bot`),
offene Rückfragen – Ablauf nach 10 Min., neues Anliegen, Abbrechen, Bildtext, Menüleiste (`bot-pending`),
Sprache – keine technischen Texte, Varianten, Ort-Regel, Wein löschen ohne Namen (`bot-texts`),
Fotos nachreichen (`photo-attach`, `media-*`), Bearbeiten-Modul inkl. `move_bottles` und `change_vintage`
(`edit`), Weinseite mit Bearbeiten in der Karte, Büroklammer und Reihenfolge (`wine-units`), unwiderruflich löschen – Flaschen und ganzer Wein samt Dateien (`delete`), Weinseite (`wine-page`), Übersicht, Typ-Filter und Gruppierungen inkl. Trinkreife (`overview`,
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
**[Speichern] [Korrigieren] [Verwerfen]** → Lagerort (Weinkeller / Wohnzimmer), Anzahl (Knöpfe 1, 2, 3, 6, 12 und
**[✏️ Andere Zahl]**; eine ganze Zahl ab 1 lässt sich auch direkt tippen, sonst fragt Antoine freundlich nochmals;
steht die Anzahl im Bild- oder Freitext, z. B. „6 Flaschen“, entfällt die Frage), bezahlter Preis,
Normalpreis (**[Gleich wie bezahlt] [Überspringen]**), Händler (Buttons aus `vendors`, **[Neuer Händler]**
per Freitext oder **[Überspringen]**) → Wein anlegen oder wiederverwenden, `inventory_items` mit
`status = sealed`, `purchased_at = heute`, `vendor_id` und den Fotos anlegen, Job auf `confirmed`.
**Preise eintippen** (Kaufpreis, Normalpreis, Geschenk-Wert, 💰 Preis bei Verkostet): eine gemeinsame strenge Prüfung
(`parseAmount` in `src/lib/format.ts`) – Betrag über 0 in den bisherigen Schreibweisen („38“, „34.80“, „34,80“,
„CHF 38“, „38 Franken“, „38.–“, „1'250“); 0, negative Beträge und Text ohne Zahl → freundlich nochmals fragen, beim
Kaufpreis „0“ mit Hinweis auf **[🎁 Geschenk]**. Preise aus Bild-/Freitext gelten nur über 0 (`positiveAmount`).
**Geschenk:** Bei der Preisfrage gibt es **[🎁 Geschenk]** – danach fragt Antoine „Von wem?“ (Freitext, getrimmt,
oder **[Überspringen]** → `gift_from = NULL`), dann nach dem Normalpreis (Wert pro Flasche, Betrag über 0 oder
**[🤷 Weiss ich nicht]** → `regular_price = NULL`); gespeichert `is_gift = true`, `purchase_price = 0`, kein Händler. Steht im Bildtext oder Freitext schon „Geschenk von Marc“, wird es direkt übernommen (Freitext:
Schema-Felder `gift`/`gift_from`, Wert als `regular_price`; Bildtext und Rückfall: `src/lib/ingest/gift.ts`), ohne
Preisfrage; „Von wem?“ nur ohne Name, der Normalpreis nur ohne Wert („Wert ca. 40 Franken“). Zusammenfassung und
Bestätigung zeigen „🎁 Geschenk von Marc · Normalpreis CHF 38.00“ bzw. „🎁 Geschenk“ statt Preis. „Von wem?“ läuft wie alle Rückfragen nach 10 Minuten ab. Verkostet bleibt unverändert.
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

### Dokumente (PDF) über den Bot

- **PDF schicken** (Telegram-Datei, bis 20 MB): Antoine fragt „Zu welchem Wein gehört das?“ und schlägt bis zu 3
  Weine vor – abgeglichen aus Dateiname und Bildtext (`src/lib/media/doc-match.ts`, z. B.
  „2020-the-hype-cabernet….pdf“ → The Hype 2020; Jahrgang aus dem Namen, sonst der einzige des Weins, sonst für
  alle Jahrgänge). Dazu „🔎 Anderen Wein suchen“ (Namen schreiben, bis zu 5 Treffer) und „✖️ Abbrechen“.
- **„📎 Dokument“ im Wein-Menü:** das nächste PDF (innert 10 Min., gleiche Zeitgrenze wie alle Rückfragen)
  gehört ohne Rückfrage zu diesem Wein und Jahrgang.
- **Speichern wie in der App** (`storeDocument` / `insertDocumentRow` in `src/lib/media/documents.ts`, gemeinsam
  mit dem Upload der Weinseite): Bucket `wine-documents` unter `app/<wein>/<uuid>.pdf`, Eintrag in `wine_media`
  (kind document, Jahrgang, Originaldateiname). Erst nach dem Eintrag: „📎 Ich habe das Dokument beim The Hype 2020
  abgelegt.“ mit Link in die App. Andere Dateitypen: „Ich nehme nur PDFs an …“. Grenze 20 MB in App, Bot und
  Speicher (`src/lib/media/document-limits.ts`); darüber dieselbe Meldung in App und Bot („Das PDF ist leider zu
  gross (über 20 MB). Magst du es verkleinern und nochmals versuchen?“).
- Ablauf in `src/lib/ingest/document.ts` (`ingest_jobs`, source `telegram_document`, Knöpfe `dc:<job>:…`).
  ℹ️ Details zeigt „📎 1 Dokument: <Dateiname>“. Im Chat gilt die Regel „nur nach Nachschauen“ auch für Dokumente
  (`get_wine_details` liefert sie).

### Fotos zu einem Wein nachreichen (📷 Foto)

Im Wein-Menü (Jahrgang bzw. offene Flasche) **📷 Foto** → Vorder- und Rückseite als Album schicken (Vorderseite
zuerst). Ablauf in `src/lib/ingest/attach.ts`, `ingest_jobs.source = 'telegram_attach'`, Knöpfe `A:<aktion>:<job>`:
- Die Fotos gehen an den gewählten Wein und Jahrgang (bei einer offenen Flasche auch an sie) als `wine_media` mit
  Vorschaubild – keine neue Charge. Fotos innerhalb von 10 Minuten nach dem Tipp gehören dazu, danach wieder zur
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
und ruft `start_wine_entry` auf) oder nach „📷 Neuer Wein“ (die nächste Textnachricht innerhalb von 10 Minuten).
Ablauf in `src/lib/ingest/flow.ts`, `ingest_jobs.source = 'text'`:
- Erkennen (`parseTextEntry`, Haiku/Sonnet, Schema `TextEntrySchema` mit Kaufangaben), dann wie bei Fotos: Abgleich
  mit bestehenden Weinen (ohne Produzent über einen eindeutigen Namen), sonst Websuche (Produzent, Herkunft, Typ,
  Alkohol, Trinkfenster des Jahrgangs) und Rebsorten mit %.
- Liegt der Wein mit dem Jahrgang schon im Bestand: „Nachkauf zu bestehendem Wein?“ → nur eine neue Charge.
- **Vollständige Namen und andere Schreibweisen** (`src/lib/ingest/wine-names.ts`, gilt für Foto, Text, Nachkauf
  und „🍷 Nur verkostet“): Besteht der erkannte Name nur aus einer Stufe bzw. einem Gattungswort (Reserva, Gran/Grande
  Reserva, Riserva, Crianza, Reserve, Grand Vin, Cuvée, Tinto, Rosso …), kommt die Marke davor („Reserva“ + „Legaris“
  → „Legaris Reserva“; „Bodegas“ vorne fällt weg) – Regel im Extraktions-Prompt und in `normalizeProposal`.
  Findet der exakte Abgleich nichts, sucht `findSimilarWines` ähnliche Weine: Gross-/Kleinschreibung, Akzente,
  Satzzeichen, Füllwörter (de/da/la/el/di/the …) und Zusätze (Bodegas, Quinta, Château, Weingut, Winery, Cellars,
  Vineyards …) egal, Produzent im Namen oder nicht („Reserva“ + „Quinta da La Rosa“ ≈ „Quinta de la Rosa Reserva“).
  Treffer → „Meinst du <Name> (<Produzent>)?“ mit „✅ Ja, dieser“ (bucht auf den bestehenden Wein, als Nachkauf,
  wenn der Jahrgang im Bestand liegt) und „➕ Nein, neuer Wein“; mehrere → bis 3 Knöpfe. Schritt `similar`
  (läuft wie alle Rückfragen nach 10 Min. ab, ✖️ Abbrechen). Exakter Treffer: wie bisher ohne Rückfrage.
- Danach nur, was im Text fehlt: Lagerort, Anzahl, Preis, Normalpreis, Händler (`nextPurchaseStep`); zum Schluss
  eine Zusammenfassung mit [Ja] [Nein]. Der Händler aus dem Text wird erst beim Speichern angelegt.
- Das Trinkfenster wird in `wine_vintages` übernommen, wenn dort noch keines steht (auch bei der Foto-Erfassung).

### Verkostet im Bot (nur probiert, nicht im Bestand)

Ablauf in `src/lib/chat/tasted.ts` (Zustand in `ingest_jobs`, `source = 'telegram_tasted'`), gespeichert über das
gemeinsame Modul `src/lib/edit/encounters.ts` – alles oder nichts wie in der App (Wein falls neu, Ort falls neu,
Eintrag, Bewertungen; bei einem Fehler wird Angelegtes zurückgenommen und ich melde „Ich habe nichts gespeichert“).
- **Absicht zuerst** (`src/lib/chat/tasted-text.ts`): Bildtext wie „verkostet“, „probiert“, „im Restaurant“,
  „trinken gerade“ → Verkostet; „gekauft“, „6 Flaschen“, „Weinkeller“ → Kauf. Ohne klaren Hinweis (Foto, Text nach
  „📷 Neuer Wein“, Chat mit `start_wine_entry` intent `unclear`) frage ich mit „🛒 Gekauft“ / „🍷 Nur verkostet“ –
  nie ungefragt einbuchen. „Wir verkosten (gerade) einen Wein“ gilt 10 Minuten für das nächste Foto bzw. die
  nächste Nachricht.
- **Schnellablauf:** Etikett lesen (Name, Jahrgang, Produzent falls erkennbar) → Wein abgleichen (wie in der App:
  mit Produzent über Name + Produzent, ohne nur über den Namen; mehrere Treffer → Auswahl oder „➕ Neuer Wein“) →
  Jahrgang bestätigen (✅ stimmt / Zahl / NV) → ⭐ der Person, die schreibt → gespeichert. Was im Bildtext bzw. Text
  steht (z. B. „Vier von fünf Sternen“, Ort, Preis), frage ich nicht nochmals; der Jahrgang nur vom Etikett wird
  bestätigt, und ich warte auf die Antwort. Danach freiwillig per
  Knopf: 📍 Ort (mit den letzten Orten zur Auswahl), 💰 Preis (z. B. „14 Glas“, „90 EUR“, „65 AED“), 🎉 Anlass, 👥 Begleitung, 🛒 Kaufen?, ⭐ für die
  andere Person, 📝 Notiz, ✅ Fertig. Keine Fragen zu Lagerort, Anzahl oder Händler.
- **Websuche danach:** erst speichern und bewerten, dann ergänzt die Recherche leere Angaben des Weins (Stammdaten,
  Rebsorten mit %, Trinkfenster; nie überschreiben). Etikett-Fotos eines neuen Weins kommen als `wine_media` dazu.
- **Freitext in einem Schritt** (`parseTastedText`, Schema `TastedTextSchema`, ohne nullable-Felder für die
  Kaufangaben): „Heute im Kronenhalle den Pintia 2019 probiert, 120 Franken die Flasche, mit Sara, 4,5 Sterne, würd
  ich kaufen“ → nur Fehlendes fragen (Jahrgang, Sterne), dann Zusammenfassung mit Ja/Nein.
- **Menüleiste „🍽 Verkostet“:** die letzten 10 Einträge (🛒 = Merker „Kaufen?“), je ein Knopf zum Wein-Menü.
  **ℹ️ Details** nennt die letzten Verkostet-Einträge.
- **Chat-Tools** (immer als Vorschlag vorher → nachher mit Ja/Nein): `list_encounters`, `propose_add_encounter`,
  `propose_encounter_edit`, `propose_delete_encounter`, `propose_want_to_buy`.
- **Letzten Eintrag löschen:** Hat der Wein danach keine Flaschen und keine weiteren Bewertungen, Einträge oder
  WSET-Verkostungen (`wouldLeaveEmptyWine`), frage ich zusätzlich „Der Wein bleibt sonst leer zurück. Auch den Wein
  löschen?“ → „Nur Eintrag“ / „Eintrag und Wein“ / „Abbrechen“. Die App fragt beim Löschen eines Verkostet-Eintrags
  genauso.

### Antoines Sprache (alle Bot-Texte)

`src/lib/bot/texts.ts`: die Meldungen von Antoine an einem Ort – wie ein freundlicher Sommelier (Ich-Form, du,
Schweizer Schreibweise, kurz und warm, keine technischen Meldungen, Emojis sparsam). Häufige Meldungen (Foto
erhalten, gespeichert, fertig, abgebrochen) gibt es in 2–3 Varianten, zufällig gewählt (`say`, `pick`). Fehler
lauten z. B. „Da ist mir leider etwas schiefgegangen – ich habe nichts gespeichert. Versuchst du es nochmals?“,
Abgelaufenes/Verworfenes „Den angefangenen Pintia 2019 lasse ich mal beiseite.“ Knopf-Beschriftungen und Menüs
stehen weiterhin bei den Tastaturen (`messages.ts`, `menu-view.ts`, `tasted.ts`).

**Ort-Regel** (App und Bot, `src/lib/edit/places.ts`): Allgemeine Wörter wie „Restaurant“, „Bar“, „zuhause bei
Freunden“ oder „Weingut“ ohne Namen legen keinen Ort an (gemeinsames Modul: `describePlace`). Der Bot merkt sich
höchstens die Art und fragt beim 📍 Ort gezielt nach („In welchem Restaurant wart ihr?“). Nur echte Namen
(„Kronenhalle“, „Napa Grill“, „Restaurant Kronenhalle“) werden Orte.

### Offene Rückfragen (alle Abläufe im Bot)

`src/lib/chat/pending.ts` – gilt für Kauf-Erfassung (Foto/Text, „📷 Neuer Wein“), Verkostet, WSET-Verkostung,
Foto zuordnen, Chat-Vorschläge mit Ja/Nein und Blättern im Menü:
- **Zeitgrenze 10 Minuten** (`src/lib/chat/ttl.ts`), gemessen ab der letzten Antwort. **Vor jeder Nachricht und
  jedem Knopf** prüfe ich offene Rückfragen: ohne Antwort seit 10 Minuten (`updated_at`) → verworfen und kurz
  gemeldet („Den angefangenen Pintia 2019 lasse ich mal beiseite.“), dann wird die neue Nachricht normal
  verarbeitet. Jede Antwort setzt die Zeit neu. Schnelle Chat-Vorschläge (Öffnen, Füllstand, Sterne im Knopf) und
  Menüs laufen 10 Minuten nach dem letzten Senden bzw. Weiterblättern ab (`date`/`edit_date` der Nachricht). Der
  DB-Job `expire-stale-ingest-jobs` (pg_cron, alle 2 Min., Ablauf nach 10 Min.) ist nur das Sicherheitsnetz;
  `cleanup-cron-run-details` löscht Cron-Protokolle älter als 7 Tage.
- **„📷 Neuer Wein“ wartet leer** (Schritt `describe`): Ein Foto/Album bzw. eine Beschreibung ist die Antwort
  darauf – der wartende Ablauf wird still geschlossen (Album) bzw. weiterverwendet (Text), ohne „Den angefangenen
  neuen Wein lasse ich mal beiseite.“ (`isEmptyNewWine` in `pending.ts`). Gemeldet wird nur, was Inhalt hatte.
- **Neues Anliegen verwirft den alten Ablauf:** neues Foto, Menü-Knopf, Befehl oder ein Text, der nicht als Antwort
  passt und nach einem neuen Wein aussieht („Ich habe die angefangene Erfassung von … verworfen.“). Ein schon
  gespeicherter Verkostet-Eintrag (nur noch Ergänzungen offen) wird still abgeschlossen.
- **Abbrechen:** unter jeder Rückfrage „✖️ Abbrechen“, dazu der Befehl `/abbrechen`.
- **Neue Menüleiste:** ändert sie sich (`MENU_VERSION` in `src/lib/chat/menu-view.ts`), schicke ich sie jedem Chat
  bei der nächsten Antwort einmal mit (Merker in `ingest_jobs`, `source = 'telegram_menu'`).

### Menüs (Knöpfe)

- **Menüleiste unten** (Reply-Keyboard, kommt mit `/start` bzw. `/help`): 🍷 Offen · 📦 Bestand · ⏰ Trinkreif ·
  🍽 Verkostet · 📷 Neuer Wein. Bestand zeigt zuerst die Weintypen, dann die Weine des Typs. ⏰ Trinkreif zeigt
  zuerst nur die Stufen mit Anzahl Flaschen (gleiche Einteilung wie die App: ⚠️ über dem Höhepunkt, ⏰ jetzt
  trinken, ✅ trinkreif, ⏳ noch lagern, ❔ unbekannt; leere fehlen), dann die Weintypen der Stufe plus „Alle“
  (bei nur einem Typ übersprungen), dann die Liste.
- **Listen:** pro Wein eine Zeile mit Emoji statt Weintyp (🍷 Rot, 🥂 Weiss, 🌸 Rosé, 🍾 Schaumwein,
  🍯 Süsswein, 🥃 Likörwein), z. B. „🍷 Palermo 2022 · 50 % · seit 216 T.“; Produzent bzw. Lagerort nur, wenn nötig
  zur Unterscheidung. Darunter je Wein ein Knopf, 10 pro Seite. Offen, Bestand und Trinkreif blättern mit „◀︎ Vorherige“
  (nicht auf Seite 1), „Weitere ▶︎“ (nicht auf der letzten) und „↩︎ Andere Auswahl“ (Weintyp bzw. Stufe), im Text
  „Seite 2 von 11“ (Offen ohne „Andere Auswahl“); „‹ Zurück“ im Wein-Menü führt auf dieselbe Seite (Seite im
  callback_data, `L:tr.1`, `L:o.2` u. ä.). Menüs laufen wie alle Rückfragen 10 Minuten nach dem letzten Antippen ab.
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
- **Persona** (System-Prompt in `src/lib/bot/chat-prompt.ts`): Antoine ist der persönliche Sommelier von Michel
  und Sara – kurz, warm, Ich-Form, du, Schweizer Schreibweise; nie Technik („Erfassungsvorgang“, „Datenbank“,
  „Tool“). Smalltalk und Abschied kurz, ohne ungefragt alte Themen; Fehler in einem Satz eingestehen.
- **Wahrheit nur aus der Datenbank:** Aussagen über Weine, Flaschen, Bewertungen, Verkostet oder offene
  Erfassungen nur nach einem Werkzeug-Aufruf im selben Zug. Der Verlauf ist nur Gesprächskontext. Im Code
  erzwungen (`agent.ts`): Behauptet eine Antwort Status (`claimsStatus`), ohne dass in diesem Zug nachgeschaut
  wurde, wird sie nicht gesendet – zweiter Versuch mit Sonnet und ausdrücklichem Hinweis, sonst eine ehrliche
  Kurzantwort („Da schaue ich lieber zuerst nach …“). Anlass: Antoine meldete einen Pintia als „vorgemerkt“,
  obwohl nur alte Testnachrichten im Gedächtnis standen.
- **Offene Erfassungen:** `list_open_entries` und `cancel_open_entry` (`flow-tools.ts`; `ingest_jobs` des Chats mit
  status received/processing/needs_review → discarded). Weglassen ohne Ja/Nein-Rückfrage, danach kurz „Gut, den
  Pintia lasse ich weg.“ „Lösch das“, „vergiss den“, „brauchen wir nicht“ meinen die offene Erfassung bzw. den
  zuletzt besprochenen Wein.
- **Verlauf:** `telegram_chat_messages`; in den Prompt gehen nur die letzten 12 Stunden, höchstens 20 Nachrichten.
  Ältere bleiben gespeichert. `/reset` löscht den Verlauf. Ohne diese Tabelle läuft der Chat ohne Gedächtnis.

| Variable (Vercel) | Zweck |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token von @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | frei gewähltes Secret (Buchstaben, Ziffern, `_`, `-`; bis 256 Zeichen) |
| `TELEGRAM_ALLOWED_USER_ID` | optional: Rückfall-Zugang (gilt als Michel); sonst `persons.telegram_user_id` |
| `ANTHROPIC_API_KEY` | Claude API |
| `SUPABASE_SECRET_KEY` | Secret Key (`sb_secret_…`) – umgeht RLS, nur serverseitig |

**Webhook registrieren:** nach dem Deployment eingeloggt `https://<produktion>/api/telegram/setup` öffnen.
