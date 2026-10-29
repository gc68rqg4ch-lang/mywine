// Alle Texte von Antoine an einem Ort – wie ein freundlicher Sommelier: Ich-Form, du,
// Schweizer Schreibweise (ss statt ß), kurz und warm, keine technischen Meldungen, Emojis
// sparsam. Häufige Meldungen gibt es in Varianten (zufällig gewählt), damit es nicht immer
// gleich klingt. Texte sind HTML für Telegram: Werte vorher mit escapeHtml (e) entschärfen.

import { DOCUMENT_TOO_BIG } from "@/lib/media/document-limits";
import { emptiedRest } from "@/lib/spirits/tag";

const e = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Eine Variante zufällig wählen (für Tests: eigene Zufallsquelle). */
export function pick<T>(variants: readonly T[], random: () => number = Math.random): T {
  return variants[Math.min(variants.length - 1, Math.floor(random() * variants.length))];
}

/** Häufige Meldungen in Varianten. */
export const VARIANTS = {
  photosReceived: [
    "Danke für die Fotos – ich schaue kurz nach …",
    "Einen Moment, ich schaue mir das Etikett an …",
    "Schönes Etikett! Ich lese es kurz …",
  ],
  photoReceived: [
    "Danke für das Foto – ich schaue kurz nach …",
    "Einen Moment, ich schaue mir das Etikett an …",
    "Schönes Etikett! Ich lese es kurz …",
  ],
  saved: ["Gespeichert.", "Ist notiert.", "Erledigt – ist gespeichert."],
  priceZero: [
    "0 Franken? Falls es ein Geschenk war, tippe einfach 🎁 – sonst schreib mir den Preis pro Flasche, z. B. <i>24.50</i>.",
    "War er geschenkt? Dann tippe 🎁. Sonst brauche ich einen Betrag über 0, z. B. <i>24.50</i>.",
  ],
  quantityOther: [
    "Gerne – wie viele Flaschen sind es? Schreib mir einfach die Zahl, z. B. <i>24</i>.",
    "Wie viele sind es denn? Eine Zahl genügt, z. B. <i>24</i>.",
    "Schreib mir die Anzahl Flaschen, z. B. <i>24</i>.",
  ],
  quantityRetry: [
    "Hm, das verstehe ich nicht ganz – wie viele Flaschen sind es? Eine ganze Zahl ab 1 genügt, z. B. <i>3</i>.",
    "Magst du mir die Anzahl als ganze Zahl schreiben? Z. B. <i>3</i> oder <i>24</i>.",
    "Wie viele Flaschen sind es? Bitte eine ganze Zahl ab 1, z. B. <i>24</i>.",
  ],
  giftValue: [
    "Weisst du ungefähr, was eine Flasche normalerweise kostet?",
    "Und was ist eine Flasche ungefähr wert?",
    "Kennst du den Normalpreis pro Flasche?",
  ],
  giftValueRetry: [
    "Den Betrag verstehe ich nicht ganz – was kostet eine Flasche normalerweise?",
    "Magst du mir den Normalpreis als Betrag schreiben?",
    "Bitte einen Betrag über 0.",
  ],
  giftFrom: ["🎁 Wie schön, ein Geschenk! Von wem?", "🎁 Ein Geschenk – schön! Von wem ist er?", "🎁 Wie nett! Von wem hast du ihn bekommen?"],
  done: ["Wunderbar, dann ist alles notiert.", "Schön – alles festgehalten.", "Perfekt, ich habe alles."],
  cancelled: ["Gut, dann lassen wir das – ich habe nichts gespeichert.", "Kein Problem, ich habe nichts gespeichert.", "Alles klar, ich lasse es bleiben."],
  keepAsIs: ["Gut, ich lasse alles, wie es ist.", "Alles klar, dann bleibt alles beim Alten.", "Okay, ich ändere nichts."],
  working: ["Einen Moment …", "Ich schaue kurz nach …", "Gleich da …"],
} as const;

export type VariantKey = keyof typeof VARIANTS;
export const say = (key: VariantKey, random?: () => number) => pick(VARIANTS[key], random);

/** Fehler ohne Technik – nichts ist halb gespeichert. */
export const ERROR = "Da ist mir leider etwas schiefgegangen – ich habe nichts gespeichert. Versuchst du es nochmals?";
export const ERROR_NOTHING_CHANGED = "Da ist mir leider etwas schiefgegangen – ich habe nichts geändert. Versuchst du es nochmals?";

/** Ein angefangener Ablauf (für „lasse ich beiseite“, „den Pintia lasse ich weg“). */
export type FlowSubject =
  | { kind: "wine"; wine: string }
  | { kind: "newWine" }
  | { kind: "entry" }
  | { kind: "tasting"; wine: string | null }
  | { kind: "photos" }
  | { kind: "document"; file: string | null }
  | { kind: "proposal"; text: string };

export function subjectText(s: FlowSubject) {
  switch (s.kind) {
    case "wine":
      return `den angefangenen ${e(s.wine)}`;
    case "newWine":
      return "den angefangenen neuen Wein";
    case "entry":
      return "den angefangenen Eintrag";
    case "tasting":
      return s.wine ? `die angefangene Verkostung von ${e(s.wine)}` : "die angefangene Verkostung";
    case "photos":
      return "das Zuordnen der Fotos";
    case "document":
      return s.file ? `das Dokument „${e(s.file)}“` : "das Dokument";
    case "proposal":
      return `meinen Vorschlag „${e(s.text)}“`;
  }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Hinweis bei der Frage „bezahlt“: den Betrag eintippen (nicht nur Knöpfe). */
/** Antwortmöglichkeiten bei den Preisfragen: Betrag, „–“ für leer, 🤷 sucht (search false: ohne 🤷). */
const priceHint = (search: boolean, gift = false) =>
  `Betrag schreiben (z. B. <i>29.90</i>), «–» für leer${gift ? ", 🎁 Geschenk" : ""}${search ? ", 🤷 dann suche ich ihn" : ""}.`;

export const T = {
  // --- Allgemein
  unknownUser: (id: number) => `Ich kenne dich leider noch nicht – deine Telegram-ID ist <code>${id}</code>.`,
  unknownUserToast: (id: number) => `Ich kenne dich leider noch nicht – deine Telegram-ID ist ${id}.`,
  yourId: (id: number, name: string) => `Deine Telegram-ID ist <code>${id}</code> (${e(name)}).`,
  hello: (name: string, help: string) => `Hallo ${e(name)}!\n\n${help}`,
  newMenu: "Unten in der Menüleiste heisst der Knopf jetzt <b>📷 Neue Flasche</b> – für Wein und Spirituosen.",
  chatForgotten: "Gut, ich habe unser bisheriges Gespräch vergessen.",
  chatLookFirst: "Da schaue ich lieber zuerst nach, bevor ich etwas Falsches sage – frag mich bitte nochmals.",
  alreadyDone: "Das ist schon erledigt.",
  error: ERROR,
  errorNothingChanged: ERROR_NOTHING_CHANGED,
  apiPaused: (until: string | null) =>
    `Ich mache gerade eine kleine Pause – mein Kontingent für diesen Monat ist aufgebraucht. ${until ? `Ab ${until} bin ich wieder ganz für dich da.` : "Bald bin ich wieder ganz für dich da."}`,
  apiUnavailable: "Ich komme gerade nicht an meine Unterlagen – ich habe nichts gespeichert. Versuchst du es in ein paar Minuten nochmals?",
  /** 429/529: vorübergehend (Varianten). */
  apiBusy: (random?: () => number) =>
    pick(["Ich bin gerade etwas überlaufen – versuchst du es in ein paar Minuten nochmals?", "Gerade ist viel los bei mir. Magst du es in ein paar Minuten nochmals versuchen?"], random),
  /** Kontingent aufgebraucht beim Etikett: die Erfassung bleibt offen, Text geht weiter. */
  apiLimitPhoto: (until: string | null, random?: () => number) =>
    `${pick(["Mein Kontingent für heute ist aufgebraucht – ich kann das Etikett gerade nicht lesen.", "Oje, mein Kontingent ist aufgebraucht – das Etikett kann ich gerade nicht lesen."], random)} Beschreib mir den Wein als Text oder versuch es später${until ? ` (ab ${until} geht es wieder)` : ""}. Deine Fotos behalte ich.`,
  /** Kontingent aufgebraucht bei der Beschreibung: die Erfassung bleibt offen. */
  apiLimitText: (until: string | null, random?: () => number) =>
    `${pick(["Mein Kontingent für heute ist aufgebraucht – ich kann den Wein gerade nicht nachschlagen.", "Oje, mein Kontingent ist aufgebraucht – nachschlagen kann ich gerade nicht."], random)} Versuch es später nochmals${until ? ` (ab ${until} geht es wieder)` : ""} – ich habe nichts gespeichert.`,
  thinkingResearch: "🔎 Ich recherchiere den Wein und melde mich gleich.",
  /** Login-Code für die App (nicht im Gesprächsgedächtnis). */
  // --- Spirituosen (offene Flasche)
  /** Nach „leer“: getrunken gebucht, keine Flasche rückt nach. */
  spiritEmptied: (name: string, sealed: number, open: number) => `${e(name)} ${emptiedRest(sealed, open)}`,
  /** Füllstand einer offenen Flasche gesetzt. */
  spiritFillSet: (name: string, percent: number) => `${e(name)}: offene Flasche noch ${percent} %.`,
  /** Öffnen, obwohl schon eine offen ist. */
  spiritAlreadyOpen: (fill: number | null) => `Es ist schon eine offen${fill != null ? ` (~${fill} %)` : ""}. Trotzdem eine weitere öffnen?`,
  // --- Spirituosen (Erfassung)
  /** Erkennung unsicher: Wein oder Spirituose? */
  kindAsk: (random?: () => number) =>
    pick(["Ist das ein Wein oder eine Spirituose?", "Hilf mir kurz: Wein oder Spirituose?", "Da bin ich nicht ganz sicher – Wein oder Spirituose?"], random),
  chooseCategory: "In welche Kategorie gehört sie?",
  chooseSubCategory: (main: string) => `Und genauer – welche Art ${e(main)}?`,
  categoryUnavailable: "Die Kategorien kann ich gerade nicht laden – ich speichere die Spirituose vorerst ohne Kategorie.",
  loginCode: (code: string, random?: () => number) =>
    `${pick(["🔑 Dein Code für die Anmeldung in der App:", "🔑 Hier ist dein Code für MyWine:", "🔑 Damit kommst du in die App:"], random)} <b><code>${e(code)}</code></b>\nEr gilt 10 Minuten. Hast du das nicht angefordert? Dann ignoriere die Nachricht.`,
  /** Recherche im Hintergrund: Sammellauf fertig (zusammen mit den Zahlen aus job-text.ts). */
  researchRunDone: (counts: string, extra: string | null, random?: () => number) =>
    `🔎 Recherche fertig: ${counts}.${extra ? ` (${extra})` : ""} ${pick(["Die Vorschläge findest du in der App unter „Recherche“.", "Schau dir die Vorschläge in Ruhe in der App an.", "Was abweicht, liegt in der App unter „Recherche“ für dich bereit."], random)}`,
  /** 🔎 für einen Wein fertig. */
  researchSingleDone: (name: string, found: string | null, random?: () => number) =>
    found
      ? `🔎 Recherche fertig: <b>${e(name)}</b> – ${e(found)}.`
      : `🔎 Recherche fertig: <b>${e(name)}</b> – ${pick(["ich habe nichts Neues gefunden.", "deine Angaben stimmen mit dem überein, was ich gefunden habe.", "Neues habe ich keines gefunden."], random)}`,
  researchSingleFailed: (name: string) => `🔎 Bei <b>${e(name)}</b> bin ich mit der Recherche leider nicht durchgekommen. Versuch es später nochmals mit 🔎 auf der Weinseite.`,
  /** Kontingent aufgebraucht: Lauf angehalten, Rest bleibt offen. */
  researchPaused: (open: string, random?: () => number) =>
    `${pick(["Mein Kontingent ist aufgebraucht – ich habe die Recherche angehalten.", "Oje, mein Kontingent ist aufgebraucht – die Recherche ruht vorerst."], random)} Noch ${open} offen; auf der Seite „Recherche“ kannst du später fortsetzen.`,
  /** Monatsbudget der API erreicht (höchstens einmal pro Tag). */
  budgetReached: (spent: string, budget: string, held: string) =>
    `💸 Das Monatsbudget für meine Recherchen ist erreicht (USD ${spent} von ${budget}). ${held} warten, bis du das Budget auf der Seite „Recherche“ erhöhst oder der neue Monat beginnt. Fotos, Chat und Tagestext laufen weiter.`,
  here: "Bitte schön:",

  // --- Offene Rückfragen
  laidAside: (s: FlowSubject) => `${cap(subjectText(s))} lasse ich mal beiseite.`,
  cancelledList: (subjects: FlowSubject[]) =>
    subjects.length ? `Gut, ${subjects.map(subjectText).join(", ")} lasse ich bleiben.` : "Es ist gerade nichts offen.",
  proposalExpired: (text: string) => `Meinen Vorschlag „${e(text)}“ lasse ich mal beiseite – frag mich einfach nochmals.`,
  proposalExpiredToast: "Das ist schon eine Weile her – frag mich bitte nochmals.",
  menuExpired: "Dieses Menü ist schon eine Weile offen – tipp einfach unten auf die Menüleiste, dann zeige ich dir alles frisch.",
  menuExpiredToast: "Das Menü ist schon etwas älter.",
  proposalInvalid: "Das kann ich leider nicht mehr ausführen.",

  // --- Fotos
  photoOnly: "Schick mir bitte ein Foto vom Etikett (am besten JPEG oder PNG).",
  /** Ablaufdatum in der Zusammenfassung (Wert schon HTML-sicher). */
  bestBeforeLine: (date: string, expired: boolean) => `📆 Haltbar bis ${date}${expired ? " – <i>schon abgelaufen</i>" : ""}`,
  bestBeforeKeepsUntil: (until: number, date: string) =>
    `<i>Bei dir steht die Trinkreife bis ${until} – die lasse ich so (Etikett: haltbar bis ${date}).</i>`,
  bestBeforeKeepsFrom: (from: number, date: string) =>
    `<i>Bei dir steht die Trinkreife ab ${from} – „bis“ lasse ich deshalb leer (Etikett: haltbar bis ${date}).</i>`,
  /** Foto kam kurz nach der ersten Frage: gehört noch zum selben Wein (Varianten). */
  photoAdded: (random?: () => number) =>
    pick(["📷 Danke, das Foto lege ich zum selben Wein.", "📷 Das Foto nehme ich gleich zu diesem Wein dazu."], random),
  photoNotAssigned: "Dieses Foto konnte ich leider keinem Wein zuordnen – magst du es mir nochmals schicken?",
  photoTooLate: "Dieses Foto kam etwas spät – ich bin mit den anderen schon dran. Schick mir das Album sonst einfach nochmals.",
  photoTooLateAttach: "Dieses Foto kam etwas spät – ich ordne die anderen schon zu.",
  photosReceived: (n: number, random?: () => number) => say(n === 1 ? "photoReceived" : "photosReceived", random),
  photoError: "Da ist mir beim Etikett leider etwas schiefgegangen – ich habe nichts gespeichert. Schickst du mir die Fotos nochmals?",
  textError: "Da ist mir leider etwas schiefgegangen – ich habe nichts gespeichert. Schreibst du es mir nochmals?",
  saveError: "Beim Speichern ist mir leider etwas schiefgegangen – ich habe nichts gespeichert. Versuchst du es nochmals?",

  // --- Kauf-Erfassung
  missingName: "Mir fehlt noch der Name des Weins – magst du ihn kurz korrigieren?",
  whatToFix: "Was soll ich ändern? Schreib es mir einfach, z. B. <i>Jahrgang 2019, Region Rioja, 14 %</i>.",
  fixing: "Gerne, ich passe das an …",
  fixFailed: "Das habe ich leider nicht ganz verstanden. Magst du es nochmals anders formulieren?",
  dropped: (random?: () => number) => say("cancelled", random),
  savingToast: "Ich speichere …",
  vintageGuess: (year: number) => `📅 Ich lese den Jahrgang <b>${year}</b>, bin mir aber nicht ganz sicher. Stimmt das? Sonst schreib mir einfach die richtige Jahreszahl.`,
  vintageAsk: "📅 Welcher Jahrgang ist es? Schreib mir die Jahreszahl – oder tippe „Ohne Jahrgang (NV)“.",
  vintageRetry: "Welcher Jahrgang ist es? Eine Jahreszahl wie <i>2019</i> genügt – oder tippe „Ohne Jahrgang (NV)“.",
  whereStored: "Wo lagerst du die Flaschen?",
  howMany: (room: string) => `${e(room)} – schön. Wie viele Flaschen sind es?`,
  howManyRetry: "Wie viele Flaschen sind es?",
  sizeAsk: "Wie gross ist die Flasche? Auf dem Etikett habe ich keine Grösse sicher gelesen.",
  sizeOther: "Wie viel enthält die Flasche? Z. B. «50 cl», «0,5 l» oder «1,5 l».",
  sizeRetry: "Das habe ich nicht verstanden. Wie gross ist die Flasche – z. B. «50 cl» oder «0,7 l»?",
  /** „✏️ Andere Zahl“: Bitte um die Zahl als Text (Varianten). */
  quantityOther: (random?: () => number) => say("quantityOther", random),
  /** Keine gültige Anzahl (0, -3, „zwei“, 2.5): freundlich nochmals fragen (Varianten). */
  quantityRetry: (random?: () => number) => say("quantityRetry", random),
  /** Frage a: bezahlter Preis pro Flasche (→ purchase_price). */
  pricePaid: (bottles: string, random?: () => number, search = true) =>
    `${e(bottles)}. 💰 ${pick(["Was hast du pro Flasche bezahlt?", "Und was hast du pro Flasche bezahlt?", "Sag mir noch: Was hast du pro Flasche bezahlt?"], random)} ${priceHint(search, true)}`,
  priceRetry: (search = true) => `Den Betrag verstehe ich nicht ganz – was hast du pro Flasche bezahlt? ${priceHint(search, true)}`,
  /** Geschenk: „Von wem?“ (Varianten). */
  giftFromAsk: (random?: () => number) => say("giftFrom", random),
  /** Geschenk: Normalpreis (Wert) pro Flasche? (Varianten) */
  giftValueAsk: (random?: () => number, search = true) => `${say("giftValue", random)} ${priceHint(search)}`,
  /** Kein gültiger Betrag (0, negativ, kein Betrag): freundlich nochmals fragen (Varianten). */
  giftValueRetry: (random?: () => number, search = true) => `${say("giftValueRetry", random)} ${priceHint(search)}`,
  /** Statt Preis: „🎁 Geschenk von Marc“ bzw. „🎁 Geschenk“. */
  giftLine: (from: string | null) => (from ? `🎁 Geschenk von ${e(from)}` : "🎁 Geschenk"),
  /** Frage b: Normalpreis pro Flasche (→ regular_price). */
  /** Nach einem bezahlten Betrag: „✅ Ja, gleich“, sonst anderen Betrag tippen, „–“ oder 🤷. */
  sameAsRegular: (random?: () => number, search = true) =>
    `${pick(["Ist das auch der Normalpreis?", "Danke! Ist das auch der Normalpreis?", "Notiert. Ist das auch der Normalpreis?"], random)} Sonst ${priceHint(search)}`,
  /** „✏️ Anderer Betrag“: um den Normalpreis bitten. */
  regularOther: "Gerne – was kostet eine Flasche normalerweise? Schreib mir einfach den Betrag, z. B. <i>45</i>.",
  /** Ohne bezahlten Betrag (z. B. alter Knopf „skipprice“): nach dem Normalpreis fragen. */
  regularPrice: (random?: () => number, search = true) =>
    `${pick(["Weisst du, was eine Flasche normalerweise kostet?", "Und weisst du, was eine Flasche normalerweise kostet?"], random)} ${priceHint(search)}`,
  regularPriceRetry: (search = true) => `Den Betrag verstehe ich nicht ganz – was kostet eine Flasche normalerweise? ${priceHint(search)}`,
  // --- Preissuche (🤷 (Preis suchen)) – label: die Flasche (HTML, aus bottleLabel)
  /** Treffer (gleicher Jahrgang, gleiche Grösse) – gespeichert. details: „Mövenpick, 2019, 75 cl“. */
  priceFound: (label: string, money: string, details: string, regularOnly: boolean) =>
    `${label}\n💰 ${regularOnly ? "Normalpreis" : "Preis"} gefunden: ${e(money)} pro Flasche (${e(details)}) – gespeichert.`,
  /** Nur anderer Jahrgang bzw. andere Grösse: „Nur Jahrgang 2020 gefunden: CHF 64.00 (Mövenpick). Übernehmen?“ */
  priceOther: (label: string, what: string, money: string, merchant: string) => `${label}\nNur ${e(what)} gefunden: ${e(money)} (${e(merchant)}). Übernehmen?`,
  /** Zusatz wie Riserva nur auf einer Seite: „Gefunden: CHF 70.05 (Trinkgenuss) – Angebot ohne Riserva. Übernehmen?“ */
  priceSizeCheck: (label: string, money: string, size: string, merchant: string) => `${label}\nGefunden: ${e(money)} für ${e(size)} (${e(merchant)}) – stimmt die Grösse? Übernehmen?`,
  priceOtherProduct: (label: string, why: string, money: string, merchant: string) => `${label}\nGefunden: ${e(money)} (${e(merchant)}) – ${e(why)}. Übernehmen?`,
  /** Nichts gefunden: nur eine Meldung (ohne Knöpfe) – ein getippter Betrag wird noch gespeichert. */
  priceNotFound: (label: string) => `${label}\nKeinen Preis bei Schweizer Händlern gefunden – bleibt leer. Wenn du ihn weisst, schreib mir einfach den Betrag.`,
  regularNotFound: (label: string) => `${label}\nKeinen Normalpreis bei Schweizer Händlern gefunden – bleibt leer. Wenn du ihn weisst, schreib mir einfach den Betrag.`,
  /** 🤷 bei einer Preis-Rückfrage zu einer gespeicherten Flasche: Suche gestartet. */
  priceSearching: (label: string, regularOnly: boolean) => `${label}\n🔎 ${regularOnly ? "Normalpreis" : "Preis"}: wird gesucht …`,
  /** Rückfrage beantwortet: Preise der Charge gespeichert. */
  priceSaved: (label: string, line: string | null) => `${label}\n${line ? `✅ Gespeichert: ${e(line)}.` : "✅ Gut, der Preis bleibt leer."}`,
  /** Zurückgehaltene Preis-Rückfrage nach 24 Std. verworfen. */
  priceHeldExpired: (label: string) => `Preis für ${label} noch leer – du kannst ihn jederzeit in der App oder hier nachtragen.`,
  priceLeftEmpty: "Gut, der Preis bleibt leer.",
  priceOfferRetry: "Tippe bitte einen Knopf: Übernehmen, Selbst eingeben oder Leer lassen.",
  /** Kaufpreis „0“: dafür gibt es „🎁 Geschenk“ (Varianten). */
  priceZero: (random?: () => number) => say("priceZero", random),
  vendorAsk: (hasVendors: boolean) => (hasVendors ? "Wo hast du ihn gekauft?" : "Wo hast du ihn gekauft? Schreib mir den Namen – oder tippe „Überspringen“."),
  vendorName: "Wie heisst der Händler?",
  vendorAll: (page: number, pages: number) => (pages > 1 ? `Alle Händler (Seite ${page + 1} von ${pages}):` : "Alle Händler:"),
  vendorSimilar: (existing: string, typed: string) => `Meinst du <b>${existing}</b>? Oder soll ich «${typed}» als neuen Händler anlegen?`,
  vendorRetry: "Wie heisst der Händler? Schreib mir einfach den Namen – oder tippe „Überspringen“.",
  producerAsk: "Von welchem Weingut ist er?",
  producerRetry: "Von welchem Weingut ist er? Der Name genügt.",
  restockAsk: "Diesen Wein mit diesem Jahrgang hast du schon im Bestand. Hast du nachgekauft?",
  restockAskOrRename: "Diesen Wein mit diesem Jahrgang hast du schon im Bestand. Hast du nachgekauft? (Sonst schreib ihn mir mit genauerem Namen.)",
  noWineInText: "Darin habe ich leider keinen Wein gefunden. Schreib mir z. B. <i>Pintia 2019, 6 Flaschen, Weinkeller, 66 Franken bei Mövenpick</i>.",
  readingText: "Gerne – ich schaue mir den Wein an und ergänze, was fehlt …",
  boughtContinue: "Schön, dann buche ich ihn ein – ich ergänze noch kurz die Angaben …",

  // --- Verkostet
  boughtOrTasted: "Hast du ihn gekauft oder nur verkostet?",
  boughtOrTastedSpirit: "Hast du sie gekauft oder nur verkostet?",
  boughtOrTastedText: "Hast du den Wein gekauft oder nur verkostet?",
  armed: "Wie schön! Schick mir ein Foto vom Etikett oder schreib mir den Wein – ich notiere ihn als verkostet.",
  readingTasted: "Wie schön – ich schaue mir den Wein kurz an …",
  noWineInTasted: "Darin habe ich leider keinen Wein gefunden. Schreib mir z. B. <i>Heute im Kronenhalle den Pintia 2019 probiert, 4,5 Sterne</i>.",
  labelUnreadable: "Den Namen auf dem Etikett kann ich leider nicht lesen. Schreibst du mir den Wein? Z. B. <i>Pintia 2019 probiert, 4 Sterne</i>.",
  // --- Ähnlicher bestehender Wein (andere Schreibweise)
  /** Ein Treffer: „Meinst du <Name> (<Produzent>)?“ – Werte schon entschärft (HTML). */
  similarOne: (wine: string, random?: () => number) =>
    pick([`Den kenne ich vielleicht schon: Meinst du <b>${wine}</b>?`, `Meinst du <b>${wine}</b>? Den habe ich schon bei dir.`, `Ich glaube, den gibt es schon – meinst du <b>${wine}</b>?`], random),
  similarMany: (random?: () => number) =>
    pick(["Ich habe ähnliche Weine bei dir gefunden – meinst du einen davon?", "Den kenne ich vielleicht schon. Meinst du einen von diesen?"], random),
  similarYes: "✅ Ja, dieser",
  similarNo: "➕ Nein, neuer Wein",
  whichWine: (name: string) => `Es gibt mehrere Weine „${e(name)}“. Welcher ist es?`,
  tastedVintage: (wine: string, year: number | null) =>
    year != null ? `🍷 <b>${wine}</b>\nIst es der Jahrgang <b>${year}</b>? Sonst schreib mir die Jahreszahl.` : `🍷 <b>${wine}</b>\nWelcher Jahrgang war es? Schreib mir die Jahreszahl – oder tippe „Ohne Jahrgang (NV)“.`,
  howManyStars: (wine: string, name: string) => `Und wie hat er dir geschmeckt, ${e(name)}? Wie viele Sterne gibst du dem ${wine}?`,
  starsRetry: "Tippe einfach die Sterne an – oder schreib mir eine Zahl von 0 bis 5, z. B. <i>4,5</i>.",
  knownWine: "Diesen Wein kenne ich schon – ich hänge den Eintrag dort an.",
  newWine: "Diesen Wein lege ich neu an.",
  summaryQuestion: "Soll ich das so notieren?",
  tastedSaved: (wine: string, stars: string | null, random?: () => number) =>
    `${pick(["Wunderbar!", "Schön!", "Sehr gut!"], random)} Ich habe ${wine} als verkostet notiert${stars ? ` – mit ${stars}` : ""}.`,
  addMore: "Möchtest du noch etwas ergänzen?",
  tastedDone: (wine: string, random?: () => number) =>
    `${pick(["Wunderbar", "Schön", "Perfekt"], random)} – ${wine} steht jetzt unter „Verkostet“.`,
  extra: {
    place: "📍 Wo wart ihr? Schreib mir den Namen des Restaurants, der Bar oder bei wem.",
    /** „im Restaurant“ ohne Namen: gezielt nachfragen. */
    placeKind: {
      restaurant: "📍 In welchem Restaurant wart ihr?",
      bar: "📍 In welcher Bar wart ihr?",
      weingut: "📍 Auf welchem Weingut wart ihr?",
      privat: "📍 Bei wem wart ihr?",
      messe: "📍 An welcher Messe wart ihr?",
      sonstiges: "📍 Wo genau wart ihr?",
    },
    placeRecent: "Tippe einen der letzten Orte an oder schreib mir den Namen.",
    price: "💰 Was hat er gekostet? Z. B. <i>120</i>, <i>14 Glas</i> oder <i>90 EUR</i>.",
    /** Kein gültiger Betrag (0, negativ, ohne Zahl): freundlich nochmals fragen. */
    priceRetry: "💰 Den Preis verstehe ich nicht ganz – bitte einen Betrag über 0, z. B. <i>120</i>, <i>14 Glas</i> oder <i>90 EUR</i>.",
    occasion: "🎉 Was war der Anlass?",
    companions: "👥 Mit wem warst du da?",
    note: "📝 Was möchtest du dir zum Wein notieren?",
  },
  otherStars: (name: string) => `⭐ Wie viele Sterne gibt ${e(name)}?`,
  otherStarsSaved: (name: string, stars: string) => `⭐ ${e(name)}: ${stars} – notiert.`,
  wantToBuyOn: "🛒 Vorgemerkt",
  wantToBuyOff: "Merker entfernt",
  savedNothing: (reason: string) => `${e(reason)} Ich habe nichts gespeichert.`,

  // --- Chat und Vorschläge
  proposalDone: "Das habe ich schon erledigt.",
  editQuestion: "Soll ich das so ändern?",
  deleteQuestion: "Wirklich löschen?",
  didIt: (done: string) => `Ich habe ${done}.`,

  // --- Fotos zuordnen
  attachSaveError: "Die Fotos konnte ich leider nicht speichern. Versuchst du es nochmals über „📷 Foto“?",
  attachDone: "📷 Erledigt.",
  attachCancelled: (wine: string) => `📷 Gut, ich lasse ${e(wine)}, wie es ist.`,
  attachReplacing: "📷 Ich ersetze die Fotos …",
  attachWhichSide: "📷 Ist das die Vorder- oder die Rückseite?",

  // --- Menüs: Offen, Trinkreif und Blättern
  openTitle: (bottles: number) => `<b>🍷 Offene Flaschen (${bottles})</b>`,
  openEmpty: "🍷 Gerade ist keine Flasche offen.",
  readyIntro: (bottles: number) => `⏰ <b>Trinkreife</b> · ${bottles} Fl.\nWelche Flaschen möchtest du sehen?`,
  readyEmpty: "⏰ Im Bestand liegt gerade keine ungeöffnete Flasche.",
  readyWhichType: (stage: string, bottles: number) => `${stage} · ${bottles} Fl.\nWelchen Typ möchtest du sehen?`,
  readyNoneLeft: "Hier liegt gerade nichts mehr – such dir eine andere Auswahl aus.",
  pageOf: (page: number, pages: number) => `Seite ${page} von ${pages}`,

  // --- Dokumente (PDF)
  docWhichWine: (file: string) => `📎 Danke für „${e(file)}“. Zu welchem Wein gehört das?`,
  docWhichWineNone: (file: string) =>
    `📎 Danke für „${e(file)}“. Zu welchem Wein gehört das? Ich habe auf Anhieb keinen passenden gefunden – tipp auf „🔎 Anderen Wein suchen“.`,
  docSearchAsk: "🔎 Wie heisst der Wein? Schreib mir einfach den Namen, z. B. <i>The Hype 2020</i>.",
  docSearchResults: "Welcher ist es?",
  docSearchNone: (query: string) => `Zu „${e(query)}“ finde ich keinen Wein. Versuch es mit einem anderen Namen – oder tippe ✖️ Abbrechen.`,
  docWaiting: (wine: string) => `📎 Schick mir das PDF für <b>${e(wine)}</b> – ich lege es direkt dort ab.`,
  docSaved: (wine: string) => `📎 Ich habe das Dokument beim ${e(wine)} abgelegt.`,
  docCancelled: "Gut, dann lege ich das Dokument nirgends ab.",
  docOnlyPdf: "Ich nehme nur PDFs an – Fotos vom Etikett natürlich auch.",
  docTooBig: DOCUMENT_TOO_BIG,
  docSaveError: "Das Dokument konnte ich leider nicht ablegen – ich habe nichts gespeichert. Schickst du es mir nochmals?",
  docGone: "Dieses Dokument ist nicht mehr bei mir – schick es mir einfach nochmals.",
  openInApp: (url: string) => `<a href="${url}">In der App öffnen</a>`,

  // --- Hilfe und Erfassung
  help: [
    "Ich bin Antoine, dein Sommelier. 🍷",
    "Unten findest du das Menü: <b>🍷 Offen</b>, <b>📦 Bestand</b>, <b>⏰ Trinkreif</b>, <b>🍽 Verkostet</b>, <b>📷 Neue Flasche</b>.",
    "Tipp auf einen Wein – dann kümmere ich mich um Gläser, Füllstand, Öffnen, Bewertungen, Fotos und Dokumente.",
    "",
    "📷 Neue Flasche: Schick mir Vorder- und Rückseite als Album – oder beschreib sie mir. Ich frage dich, ob du sie gekauft oder nur verkostet hast.",
    "🍽 Nur probiert? Schreib mir z. B. <i>Heute im Kronenhalle den Pintia 2019 probiert, 4,5 Sterne</i> – oder schick ein Foto mit dem Bildtext „verkostet“.",
    "📎 Datenblätter und andere PDFs kannst du mir einfach schicken – ich frage dich, zu welchem Wein sie gehören.",
    "💬 Oder schreib mir einfach, z. B. <i>Welche Rioja habe ich noch?</i>, <i>Sara gibt dem Pintia 4,5 Sterne</i> oder <i>Verschieb 2 Flaschen Pintia ins Wohnzimmer</i>.",
    "Mit /reset vergesse ich unser bisheriges Gespräch, /id zeigt dir deine Telegram-ID.",
  ].join("\n"),
  describe: [
    "📷 Schick mir <b>Vorder- und Rückseite</b> der Flasche als Album – oder",
    "✍️ beschreib mir den Wein, z. B. <i>„Pintia 2019, 6 Flaschen, Weinkeller, 66 Franken bei Mövenpick“</i>.",
    "Was fehlt, recherchiere ich oder frage dich.",
  ].join("\n"),
  /** Nach dem Einbuchen: „Wunderbar – ich habe 6 Flaschen Pintia 2019 im Weinkeller eingebucht.“ */
  booked: (b: { bottles: string; wine: string; room: string; restock: boolean }, random?: () => number) =>
    `✅ ${pick(["Wunderbar", "Schön", "Perfekt"], random)} – ich habe ${e(b.bottles)} ${b.wine} ${e(b.room)} ${b.restock ? "nachgekauft und " : ""}eingebucht.`,
  bookedFollowUp: (n: number) => (n === 1 ? "Möchtest du sie gleich öffnen oder bewerten?" : "Möchtest du gleich eine öffnen oder bewerten?"),

  // --- Recherche
  researchWineGone: "Diesen Wein finde ich leider nicht mehr.",
  researchStart: (wine: string) => `🔎 Ich recherchiere ${e(wine)} – das dauert etwa eine Minute, ich melde mich.`,
  researchError: "Die Recherche hat leider nicht geklappt. Versuchst du es später nochmals?",
  researchKept: "Gut, deine Angabe bleibt, wie sie ist.",

  // --- WSET-Verkostung
  tastingNotUnderstood: "Das konnte ich leider nicht zuordnen. Schreibst du es mir nochmals – oder tippst du ✖️ Abbrechen?",
  tastingDiscarded: (title: string) => `📝 ${e(title)}: gut, ich lasse die Verkostung bleiben.`,
  tastingStale: "Dieser Knopf ist schon etwas älter – magst du nochmals von vorne beginnen?",
  tastingClosed: "Diese Verkostung ist schon abgeschlossen.",
} as const;

/**
 * Alle festen Texte (ohne Werte) – für Tests, dass keine technischen Meldungen drinstehen.
 * Funktionen werden mit Beispielwerten aufgerufen.
 */
/**
 * Startseite: Ersatztext von Antoine, wenn kein Tagestext von Claude da ist. Reiner Text
 * (kein HTML); Weine als Platzhalter {{W1}} … (die App macht Links daraus). Jeder Satz nur,
 * wenn die Daten ihn hergeben.
 */
const fl = (n: number) => (n === 1 ? "1 Flasche" : `${n} Flaschen`);
export const HOME_TEXTS = {
  /**
   * Begrüssung vor Antoines Text – setzt die App beim Anzeigen nach der aktuellen Uhrzeit
   * (Europe/Zurich): 05–11 Morgen, 11–17 Tag, 17–22 Abend, 22–05 spät. Der Text selbst (Claude
   * und Ersatztext) hat keine Begrüssung und keine Tageszeit.
   */
  greeting: {
    morning: [(name: string) => `Guten Morgen, ${name}.`, (name: string) => `Schönen guten Morgen, ${name}!`],
    day: [(name: string) => `Guten Tag, ${name}.`, (name: string) => `Guten Tag, ${name} – schön, dass du reinschaust.`],
    evening: [(name: string) => `Guten Abend, ${name}.`, (name: string) => `Schönen guten Abend, ${name}!`],
    late: [(name: string) => `Hallo, ${name}.`, (name: string) => `Hallo, ${name} – schön, dass du noch reinschaust.`],
  },
  greetingAnonymous: {
    morning: ["Guten Morgen."],
    day: ["Guten Tag."],
    evening: ["Guten Abend."],
    late: ["Hallo."],
  },
  stock: [
    (bottles: number, wines: number) => `Im Keller liegen gerade ${fl(bottles)} von ${wines === 1 ? "einem Wein" : `${wines} Weinen`}.`,
    (bottles: number, wines: number) => `${bottles === 1 ? "Im Keller wartet 1 Flasche" : `Im Keller warten ${bottles} Flaschen`} – ${wines === 1 ? "ein Wein" : `${wines} verschiedene Weine`}.`,
  ],
  stockEmpty: ["Im Keller ist gerade nichts eingelagert – vielleicht Zeit für einen Einkauf?", "Der Keller ist im Moment leer."],
  overdueOne: [
    (w: string) => `${w} hat seinen Höhepunkt schon hinter sich – den würde ich bald öffnen.`,
    (w: string) => `Bei ${w} würde ich nicht mehr lange warten, er ist über dem Höhepunkt.`,
  ],
  overdueMany: [
    (n: number, w: string) => `${fl(n)} sind über dem Höhepunkt – ich würde mit ${w} anfangen.`,
    (n: number, w: string) => `${fl(n)} haben ihren Höhepunkt schon hinter sich, zum Beispiel ${w}.`,
  ],
  now: [
    (w: string) => `Gerade in seiner besten Zeit ist ${w}.`,
    (w: string) => `Wenn du heute etwas öffnen magst: ${w} ist genau jetzt schön zu trinken.`,
    (w: string) => `Mein Vorschlag für heute: ${w} – er ist jetzt trinkreif.`,
  ],
  openOld: [
    (w: string, days: number) => `${w} ist seit ${days === 1 ? "einem Tag" : `${days} Tagen`} offen – den solltest du bald austrinken.`,
    (w: string, days: number) => `Denk an ${w}: die Flasche ist seit ${days === 1 ? "einem Tag" : `${days} Tagen`} offen.`,
  ],
  recent: [(w: string) => `Neu im Keller ist ${w}.`, (w: string) => `Zuletzt dazugekommen ist ${w}.`],
  drunkMonth: [
    (n: number) => `Diesen Monat ${n === 1 ? "ist schon 1 Flasche" : `sind schon ${n} Flaschen`} leer geworden.`,
    (n: number) => `Diesen Monat ${n === 1 ? "wurde 1 Flasche" : `wurden ${n} Flaschen`} getrunken.`,
  ],
  suggestions: [
    (n: number) => `Auf der Recherche-Seite ${n === 1 ? "wartet ein Vorschlag" : `warten ${n} Vorschläge`} von mir aufs Prüfen.`,
    (n: number) => `Ich habe ${n === 1 ? "einen Vorschlag" : `${n} Vorschläge`} zum Prüfen für dich – unter Recherche.`,
  ],
  closing: ["Zum Wohl!", "Ich freue mich auf dein nächstes Glas.", "Santé!", "Lass es dir schmecken."],
} as const;

export function allBotTexts(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") {
      const fn = v as (...a: unknown[]) => unknown;
      const subject = { kind: "wine", wine: "Pintia 2019" };
      for (const args of [["Pintia 2019", "Michel", () => 0], [subject], [[subject]], [2, () => 0]]) {
        try {
          out.push(String(fn(...args)));
          break;
        } catch {
          // nächste Beispielwerte versuchen
        }
      }
    }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(T);
  walk(VARIANTS);
  walk(HOME_TEXTS);
  return out;
}
