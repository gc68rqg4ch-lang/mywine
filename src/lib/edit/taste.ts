import "server-only";

// Geschmacksprofil bearbeiten (✏️ in der Karte „Geschmacksprofil“) bzw. einen
// Recherche-Vorschlag übernehmen. Von Hand gilt danach source = manual – die Recherche
// überschreibt es nicht mehr (nur noch Vorschlag).

import { satTypeForWine } from "@/lib/tasting/sat";
import { TASTE_FIELDS, TASTE_KEYS, UNKNOWN, aromaGroups, tasteOptions, type TasteProfileData } from "@/lib/taste/profile";
import { loadExactTasteProfile, saveTasteProfile } from "@/lib/taste/store";
import { DASH, clean, diff, fail, loadWine, ready, wineTitle, type Db, type PreparedEdit } from "./helpers";
import type { Edit, EditChange } from "./types";

const aromaText = (aromas: Record<string, string[]>) => Object.values(aromas).flat().join(", ") || DASH;
const show = (v: string | null | undefined) => (v && v !== UNKNOWN ? v : DASH);

export async function prepareTasteProfile(db: Db, edit: Extract<Edit, { kind: "tasteProfile" }>): Promise<PreparedEdit> {
  const wine = await loadWine(db, edit.wineId);
  if (!wine) return fail("Diesen Wein gibt es nicht mehr.");
  const p = edit.profile;
  for (const f of TASTE_FIELDS) {
    const v = p.values[f.key] ?? UNKNOWN;
    if (v !== UNKNOWN && !tasteOptions(f.key).includes(v)) return fail(`${f.label}: ungültiger Wert.`);
  }
  const lexicon = aromaGroups(satTypeForWine(wine.type));
  const aromas: Record<string, string[]> = {};
  for (const [group, list] of Object.entries(p.aromas)) {
    const ok = [...new Set(list)].filter((a) => lexicon.get(group)?.includes(a));
    if (ok.length !== new Set(list).size) return fail("Unbekanntes Aroma – bitte aus der Liste wählen.");
    if (ok.length) aromas[group] = ok;
  }
  const styleSummary = clean(p.styleSummary)?.slice(0, 400) ?? null;
  const foodPairing = [...new Set(p.foodPairing.map((f) => clean(f)).filter((f): f is string => !!f))].slice(0, 8);

  const current = await loadExactTasteProfile(db, edit.wineId, p.vintageYear);
  const values = Object.fromEntries(TASTE_KEYS.map((k) => [k, p.values[k] ?? UNKNOWN])) as TasteProfileData["values"];
  const changes: EditChange[] = [];
  for (const f of TASTE_FIELDS) diff(changes, f.label, show(current?.values[f.key]), show(values[f.key]));
  diff(changes, "Aromen", aromaText(current?.aromas ?? {}), aromaText(aromas));
  diff(changes, "Beschreibung", current?.styleSummary ?? DASH, styleSummary ?? DASH);
  diff(changes, "Passt zu", current?.foodPairing.join(", ") || DASH, foodPairing.join(", ") || DASH);

  // Von Hand: Belege nur für unverändert gebliebene Angaben behalten.
  let profile: TasteProfileData = { ...p, values, aromas, styleSummary, foodPairing };
  if (edit.source === "manual") {
    const old = current?.evidence ?? {};
    const keep = new Set<string>([
      ...TASTE_KEYS.filter((k) => values[k] !== UNKNOWN && current?.values[k] === values[k]),
      ...Object.values(aromas).flat().filter((a) => Object.values(current?.aromas ?? {}).flat().includes(a)),
      ...(styleSummary && styleSummary === current?.styleSummary ? ["style_summary"] : []),
    ]);
    const evidence = Object.fromEntries(Object.entries(old).filter(([k]) => keep.has(k)));
    profile = { ...profile, evidence, sources: current?.sources ?? [], confidence: null, sourceNote: current?.sourceNote ?? null };
  }
  if (!changes.length && current?.source === edit.source) return fail("Nichts zu ändern – die Angaben sind schon so.");

  return ready(
    {
      title: wineTitle(wine, p.vintageYear),
      action: "Geschmacksprofil ändern",
      changes,
      notes: p.vintageYear == null ? ["Gilt für alle Jahrgänge ohne eigenes Profil."] : [],
    },
    edit.wineId,
    async () => {
      await saveTasteProfile(db, { wineId: edit.wineId, profile, source: edit.source });
      return "das Geschmacksprofil gespeichert";
    },
    p.vintageYear,
  );
}
