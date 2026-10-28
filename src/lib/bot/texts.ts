// Alle Texte von Antoine an einem Ort – wie ein freundlicher Sommelier: Ich-Form, du,
// Schweizer Schreibweise (ss statt ß), kurz und warm, keine technischen Meldungen, Emojis
// sparsam. Häufige Meldungen gibt es in Varianten (zufällig gewählt), damit es nicht immer
// gleich klingt. Texte sind HTML für Telegram: Werte vorher mit escapeHtml (e) entschärfen.

import { DOCUMENT_TOO_BIG } from "@/lib/media/document-limits";

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

export const T = {
  // --- Allgemein
  unknownUser: (id: number) => `Ich kenne dich leider noch nicht – deine Telegram-ID ist <code>${id}</code>.`,
  unknownUserToast: (id: number) => `Ich kenne dich leider noch nicht – deine Telegram-ID ist ${id}.`,
  yourId: (id: number, name: string) => `Deine Telegram-ID ist <code>${id}</code> (${e(name)}).`,
  hello: (name: string, help: string) => `Hallo ${e(name)}!\n\n${help}`,
  newMenu: "Unten in der Menüleiste gibt es jetzt auch <b>🍽 Verkostet</b>.",
  chatForgotten: "Gut, ich habe unser bisheriges Gespräch vergessen.",
  chatLookFirst: "Da schaue ich lieber zuerst nach, bevor ich etwas Falsches sage – frag mich bitte nochmals.",
  alreadyDone: "Das ist schon erledigt.",
  error: ERROR,
  errorNothingChanged: ERROR_NOTHING_CHANGED,
  apiPaused: (until: string | null) =>
    `Ich mache gerade eine kleine Pause – mein Kontingent für diesen Monat ist aufgebraucht. ${until ? `Ab ${until} bin ich wieder ganz für dich da.` : "Bald bin ich wieder ganz für dich da."}`,
  apiUnavailable: "Ich komme gerade nicht an meine Unterlagen – ich habe nichts gespeichert. Versuchst du es in ein paar Minuten nochmals?",
  thinkingResearch: "🔎 Ich recherchiere den Wein und melde mich gleich.",
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
  pricePaid: (bottles: string) => `${e(bottles)}. Was hast du pro Flasche bezahlt?`,
  priceRetry: "Was hast du pro Flasche bezahlt? Z. B. <i>24.50</i> – oder tippe „Überspringen“.",
  regularPrice: "Und was kostet er normalerweise?",
  regularPriceRetry: "Was kostet er normalerweise? Z. B. <i>29.90</i> – oder tippe einen Knopf.",
  vendorAsk: (hasVendors: boolean) => (hasVendors ? "Wo hast du ihn gekauft?" : "Wo hast du ihn gekauft? Schreib mir den Namen – oder tippe „Überspringen“."),
  vendorName: "Wie heisst der Händler?",
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
  boughtOrTastedText: "Hast du den Wein gekauft oder nur verkostet?",
  armed: "Wie schön! Schick mir ein Foto vom Etikett oder schreib mir den Wein – ich notiere ihn als verkostet.",
  readingTasted: "Wie schön – ich schaue mir den Wein kurz an …",
  noWineInTasted: "Darin habe ich leider keinen Wein gefunden. Schreib mir z. B. <i>Heute im Kronenhalle den Pintia 2019 probiert, 4,5 Sterne</i>.",
  labelUnreadable: "Den Namen auf dem Etikett kann ich leider nicht lesen. Schreibst du mir den Wein? Z. B. <i>Pintia 2019 probiert, 4 Sterne</i>.",
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
    "Unten findest du das Menü: <b>🍷 Offen</b>, <b>📦 Bestand</b>, <b>⏰ Trinkreif</b>, <b>🍽 Verkostet</b>, <b>📷 Neuer Wein</b>.",
    "Tipp auf einen Wein – dann kümmere ich mich um Gläser, Füllstand, Öffnen, Bewertungen, Fotos und Dokumente.",
    "",
    "📷 Neuer Wein: Schick mir Vorder- und Rückseite als Album – oder beschreib ihn mir. Ich frage dich, ob du ihn gekauft oder nur verkostet hast.",
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
  return out;
}
