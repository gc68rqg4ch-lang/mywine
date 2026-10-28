// Gleichzeitige Hintergrund-Suchen nach dem Einbuchen (Geschmacksprofil + Trinkfenster) für einen
// neuen Jahrgang: beide legen den Jahrgang über dieselbe sichere Stelle an (ensureVintage →
// DB-Funktion ensure_wine_vintage, ohne Migration: lesen/anlegen/bei 23505 nochmals lesen) und
// schreiben danach nur ihre eigenen Felder. Der eindeutige Index wine_vintages_uq
// (wine_id, COALESCE(vintage_year, 0)) ist hier nachgebildet. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { autoDrinkWindow } from "@/lib/research/drink-window-auto";
import { autoTasteProfile } from "@/lib/research/taste-auto";
import { ensureVintage } from "@/lib/cellar/vintage-row";

const W = "08ffca98-0554-4014-bdf2-b31c9c43b63d";
const key = (r: Record<string, unknown>) => `${r.wine_id}|${r.vintage_year ?? 0}`;
const net: Net = {
  tables: {}, telegram: [], rpc: {}, storage: new Map(),
  claude: (body) => {
    const tools = ((body.tools as { name: string }[]) ?? []).map((t) => t.name);
    if (tools.includes("report_drink_window")) {
      return claudeTool("report_drink_window", {
        matches_wine: false, same_vintage: false, drink_from: 0, drink_until: 0, sources: [], quote: "",
        estimate_from: 2026, estimate_until: 2028, estimate_reason: "Prosecco ohne Jahrgang trinkt man jung.",
      });
    }
    if (tools.includes("report_taste_profile")) {
      return claudeTool("report_taste_profile", { matches_wine: false, same_vintage: false, sources: [], fields: {}, aromas: [], evidence: [], contradictions: [], style_summary: "", food_pairing: [] });
    }
    throw new Error(`unerwarteter Claude-Aufruf: ${tools.join(",")}`);
  },
};
installNet(net);
const db = createAdminClient();

// Eindeutiger Index (wie in der DB): zweites Anlegen desselben Jahrgangs → 23505.
net.fail = (method, table, body) => {
  if (method !== "POST" || table !== "wine_vintages") return null;
  const row = (Array.isArray(body) ? body[0] : body) as Record<string, unknown>;
  return net.tables.wine_vintages.some((r) => key(r) === key(row))
    ? { status: 409, body: { code: "23505", message: 'duplicate key value violates unique constraint "wine_vintages_uq"' } }
    : null;
};
// DB-Funktion ensure_wine_vintage (atomar: INSERT … ON CONFLICT DO NOTHING, dann SELECT).
const ensureRpc = (args: Record<string, unknown>) => {
  const row = { wine_id: args.p_wine_id, vintage_year: args.p_vintage_year ?? null };
  let found = net.tables.wine_vintages.find((r) => key(r) === key(row));
  if (!found) {
    found = { id: `vv-${net.tables.wine_vintages.length + 1}`, ...row, drink_from_year: null, drink_until_year: null };
    net.tables.wine_vintages.push(found);
  }
  return found.id;
};

function reset(withMigration: boolean) {
  net.tables = {
    wines: [{ id: W, name: "Save Water Drink Prosecco", producer: "Il Colle", type: "sparkling", country: "Italien", region: "Veneto", appellation: null, alcohol_content: 11, grapes: ["Glera"] }],
    wine_vintages: [], wine_taste_profiles: [], wine_grape_shares: [], wine_media: [], research_suggestions: [],
  };
  if (withMigration) net.rpc.ensure_wine_vintage = ensureRpc;
  else delete net.rpc.ensure_wine_vintage;
}

/**
 * Wie in Produktion: beide Suchen lesen „kein Jahrgang da“, bevor einer ihn anlegt. Dafür wartet
 * jede Anfrage etwas, das Anlegen (POST wine_vintages bzw. die DB-Funktion) deutlich länger.
 */
async function interleaved<T>(fn: () => Promise<T>) {
  const base = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input instanceof Request ? input.url : input)).pathname;
    const creates = (init?.method === "POST" && path.endsWith("/wine_vintages")) || path.endsWith("/rpc/ensure_wine_vintage");
    await new Promise((r) => setTimeout(r, creates ? 40 : 2));
    return base(input, init);
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = base;
  }
}

for (const withMigration of [true, false]) {
  for (const year of [null, 2022]) {
    test(`Profil- und Trinkfenster-Suche gleichzeitig (${year ?? "NV"}, ${withMigration ? "mit DB-Funktion" : "ohne Migration"}) → beide erfolgreich, ein Eintrag, beide Ergebnisse`, async () => {
      reset(withMigration);
      const logged: string[] = [];
      const original = console.error;
      console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
      let results: [string, string];
      try {
        results = await interleaved(() => Promise.all([autoTasteProfile(db, W, year), autoDrinkWindow(db, W, year)]));
      } finally {
        console.error = original;
      }
      assert.deepEqual(results, ["none", "set"], logged.join("\n"));
      assert.equal(net.tables.wine_vintages.length, 1, "ein einziger Eintrag");
      const row = net.tables.wine_vintages[0];
      assert.equal(row.vintage_year ?? null, year);
      assert.ok(row.taste_profile_checked_at, "Profilsuche vermerkt");
      assert.deepEqual([row.drink_from_year, row.drink_until_year, row.drink_window_source], [2026, 2028, "estimate"], "Trinkfenster gespeichert");
      assert.ok(!logged.some((l) => /23505|failed/.test(l)), logged.join("\n"));
    });
  }
}

test("ensureVintage: viele gleichzeitige Aufrufe → dieselbe id, ein Eintrag (auch ohne Migration)", async () => {
  for (const withMigration of [true, false]) {
    reset(withMigration);
    const ids = await interleaved(() => Promise.all(Array.from({ length: 5 }, () => ensureVintage(db, W, null))));
    assert.equal(new Set(ids).size, 1, String(withMigration));
    assert.equal(net.tables.wine_vintages.length, 1);
  }
});
