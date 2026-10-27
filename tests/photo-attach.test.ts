// Integrationstest: „📷 Foto“ im Wein-Menü des Bots – Album zuordnen (Vorder-/Rückseite mit
// Vorschaubild, keine neue Charge), Einzelfoto mit Seitenwahl, Ersetzen nach Rückfrage,
// Abbrechen. Telegram, Supabase (inkl. Storage) per fetch-Stub. Ausführen: npm test
import assert from "node:assert/strict";
import sharp from "sharp";
import { installNet, type Net } from "./stub-net";

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "https://stub.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "stub",
  SUPABASE_SECRET_KEY: "stub",
  TELEGRAM_BOT_TOKEN: "stub",
  TELEGRAM_WEBHOOK_SECRET: "stub",
  TELEGRAM_ALLOWED_USER_ID: "111",
  ANTHROPIC_API_KEY: "stub",
});

const W = "11111111-1111-4111-8111-111111111111";
const I = "22222222-2222-4222-8222-222222222222";
const net: Net = {
  tables: {
    persons: [{ id: "86c222d0-3a8c-4d5f-9564-f5654769ecd6", name: "Michel", sort_order: 0, telegram_user_id: null }],
    wines: [{ id: W, name: "Pintia", producer: "Vega Sicilia", type: "red" }],
    inventory_items: [{ id: I, wine_id: W, vintage_year: 2019, status: "sealed", quantity: 3, photo_urls: [] }],
    ingest_jobs: [],
    wine_media: [],
  },
  telegram: [],
  rpc: {},
  claude: () => {
    throw new Error("unerwarteter Claude-Aufruf");
  },
  storage: new Map(),
};
installNet(net);

const cb = (data: string) => ({
  update_id: 2,
  callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data, message: { message_id: 9, chat: { id: 111, type: "private" }, date: 0 } },
});
const texts = () => net.telegram.map((t) => String(t.body.text ?? ""));
const lastText = () => texts().at(-1) ?? "";
const media = () => net.tables.wine_media as { id: string; kind: string; storage_path: string; thumb_path: string | null; vintage_year: number; wine_id: string; inventory_item_id: string | null }[];
const jobs = () => net.tables.ingest_jobs as { id: string; status: string; source: string; extracted: { step: string }; photo_paths: string[]; updated_at: string }[];
const label = (color: string) => sharp({ create: { width: 600, height: 900, channels: 3, background: color } }).jpeg().toBuffer();

(async () => {
  const { handleUpdate } = await import("@/lib/ingest/bot");
  const { findAttachJob, processAttach } = await import("@/lib/ingest/attach");

  /** „📷 Foto“ antippen, Fotos in den Ordner des Jobs legen, Ruhezeit simulieren, verarbeiten. */
  async function attach(colors: string[]) {
    await handleUpdate(cb(`M:v${W}.2019:-`));
    assert.match(lastText(), /Fotos für <b>Vega Sicilia – Pintia 2019<\/b>/);
    const job = await findAttachJob((await import("@/lib/supabase/admin")).createAdminClient(), 111);
    assert.ok(job, "Job wartet auf Fotos");
    for (const [i, color] of colors.entries()) {
      net.storage!.set(`wine-photos/telegram/${job.id}/${10 + i}.jpg`, { bytes: await label(color), type: "image/jpeg" });
    }
    jobs().find((j) => j.id === job.id)!.updated_at = new Date(Date.now() - 10_000).toISOString();
    await processAttach(job.id, 111);
    return job.id;
  }

  // A) Album mit zwei Fotos: Vorder- und Rückseite, je mit Vorschaubild; keine neue Charge
  const a = await attach(["#802040", "#404040"]);
  assert.deepEqual(media().map((m) => [m.kind, m.vintage_year, m.wine_id]), [["label_front", 2019, W], ["label_back", 2019, W]]);
  for (const m of media()) {
    assert.ok(m.thumb_path && net.storage!.has(`wine-photos/${m.thumb_path}`), "Vorschaubild liegt im Bucket");
    const meta = await sharp(net.storage!.get(`wine-photos/${m.thumb_path}`)!.bytes).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, 160);
  }
  assert.equal(net.tables.inventory_items.length, 1);
  assert.equal(jobs().find((j) => j.id === a)!.status, "confirmed");
  assert.match(lastText(), /✅ Gespeichert: Vorderseite, Rückseite · Vega Sicilia – Pintia 2019/);
  const [oldFront, oldBack] = media();

  // B) Einzelfoto: Seite wählen; Vorderseite gibt es schon → Rückfrage → ersetzen
  const b = await attach(["#206080"]);
  assert.equal(jobs().find((j) => j.id === b)!.extracted.step, "side");
  assert.match(lastText(), /Vorderseite oder die Rückseite/);
  await handleUpdate(cb(`A:f:${b}`));
  assert.match(lastText(), /gibt es schon: Vorderseite\. Durch die neuen Fotos ersetzen\?/);
  assert.equal(media().length, 2, "vor der Antwort bleibt alles");
  await handleUpdate(cb(`A:r:${b}`));
  assert.deepEqual(media().map((m) => m.kind).sort(), ["label_back", "label_front"]);
  assert.ok(!media().some((m) => m.id === oldFront.id), "alte Vorderseite ersetzt");
  assert.ok(media().some((m) => m.id === oldBack.id), "Rückseite bleibt");
  assert.ok(!net.storage!.has(`wine-photos/${oldFront.storage_path}`) && !net.storage!.has(`wine-photos/${oldFront.thumb_path}`), "Datei und Vorschaubild gelöscht");
  assert.match(lastText(), /✅ Ersetzt: Vorderseite/);
  // Doppelter Tipp ändert nichts mehr
  await handleUpdate(cb(`A:r:${b}`));
  assert.equal(media().length, 2);

  // C) Abbrechen: hochgeladene Fotos werden gelöscht, nichts zugeordnet
  const c = await attach(["#aa3333"]);
  await handleUpdate(cb(`A:x:${c}`));
  assert.equal(jobs().find((j) => j.id === c)!.status, "discarded");
  assert.ok(![...net.storage!.keys()].some((k) => k.includes(c)), "Fotos des Abbruchs gelöscht");
  assert.equal(media().length, 2);

  // D) Ohne wartenden Job gibt es nichts zuzuordnen
  assert.equal(await findAttachJob((await import("@/lib/supabase/admin")).createAdminClient(), 111), null);
  console.log("photo-attach ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
