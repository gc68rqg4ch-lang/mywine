import "server-only";

// Spirituosen bei der Erfassung durch Antoine: Art bestimmen (bei Unsicherheit „Wein oder
// Spirituose?“), Kategorie nur aus den bestehenden (passt die Hauptkategorie nicht sicher: Auswahl
// der bestehenden; neue legt der Chat direkt in der DB an). Beim Speichern die Angaben (Kategorie,
// Alter, Fass, Destilliert, Abgefüllt) in wines – Bestehendes bleibt.

import type { Database } from "@/lib/database.types";
import { T } from "@/lib/bot/texts";
import { mainCategories, subCategories, toSpiritFields, type SpiritCategory } from "@/lib/spirits/categories";
import { draftFromLabel, planCategory, withCategory, type SpiritLabel } from "@/lib/spirits/draft";
import { loadSpiritCategories } from "@/lib/spirits/load";
import type { AdminClient } from "@/lib/supabase/admin";
import { sendMessage } from "@/lib/telegram/api";
import { advanceJob, jobState, type IngestJob } from "./jobs";
import { categoryKeyboard } from "./messages";
import type { IngestState, WineProposal } from "./schema";

type KnownWine = { type: string | null; [key: string]: unknown } | null;

/**
 * Nach der Erkennung: Spirituose? Dann Art „spirit“, keine Rebsorten, 0,7 l als Standard und die
 * Kategorie planen. Unsicher (und kein bekannter Wein): nachfragen (kind_unsure).
 */
export async function spiritStart(
  db: AdminClient,
  proposal: WineProposal,
  label: SpiritLabel | null | undefined,
  known: KnownWine,
): Promise<{ proposal: WineProposal; patch: Partial<IngestState>; spirit: boolean; unsure: boolean }> {
  const spirit = proposal.type === "spirit" || known?.type === "spirit";
  if (spirit) {
    const categories = await loadSpiritCategories(db).catch(() => [] as SpiritCategory[]);
    const knownFields = known ? toSpiritFields(known as Record<string, unknown>) : null;
    const draft = draftFromLabel(label);
    // Bekannte Spirituose: gespeicherte Angaben gelten, das Etikett ergänzt nur.
    const merged = knownFields
      ? {
          ...draft,
          ageYears: knownFields.ageYears ?? draft.ageYears,
          cask: knownFields.cask ?? draft.cask,
          distilledYear: knownFields.distilledYear ?? draft.distilledYear,
          bottledYear: knownFields.bottledYear ?? draft.bottledYear,
        }
      : draft;
    return {
      proposal: { ...proposal, type: "spirit", grape_shares: [], bottle_size_ml: proposal.bottle_size_ml ?? 700 },
      patch: { spirit: planCategory(categories, merged, knownFields?.categoryId) },
      spirit: true,
      unsure: false,
    };
  }
  if (label?.kind === "unsure" && !known) {
    return { proposal, patch: { kind_unsure: true, spirit: draftFromLabel(label) }, spirit: false, unsure: true };
  }
  return { proposal, patch: {}, spirit: false, unsure: false };
}

/** Antwort auf „Wein oder Spirituose?“. */
export async function kindPatch(db: AdminClient, state: IngestState, kind: "wine" | "spirit"): Promise<Partial<IngestState>> {
  if (kind === "wine") {
    // Wein: höchstens 25 % vol – ein höherer Wert vom Etikett gilt nicht.
    const alcohol = state.proposal.alcohol_content;
    return {
      kind_unsure: false,
      proposal: { ...state.proposal, type: state.proposal.type === "spirit" ? null : state.proposal.type, alcohol_content: alcohol != null && alcohol > 25 ? null : alcohol },
    };
  }
  const categories = await loadSpiritCategories(db).catch(() => [] as SpiritCategory[]);
  return {
    kind_unsure: false,
    proposal: { ...state.proposal, type: "spirit", grape_shares: [], bottle_size_ml: state.proposal.bottle_size_ml ?? 700 },
    drink_from_year: null,
    drink_until_year: null,
    grape_source: null,
    spirit: planCategory(categories, state.spirit ?? draftFromLabel(null)),
  };
}

/** Hauptkategorie nicht sicher erkannt: die bestehenden Hauptkategorien als Knöpfe. */
export async function mainOptions(db: AdminClient) {
  return mainCategories(await loadSpiritCategories(db));
}

/** Hauptkategorie gewählt: mit Unterkategorien → diese als Knöpfe, sonst fertig. */
export async function chooseMainCategory(db: AdminClient, job: IngestJob, chatId: number, index: number, advance: (patch: Partial<IngestState>) => Promise<unknown>) {
  const state = jobState(job)!;
  const id = state.category_options?.[index];
  const categories = await loadSpiritCategories(db);
  const main = categories.find((c) => c.id === id && c.parentId == null);
  if (!main || !state.spirit) return;
  const subs = subCategories(categories, main.id);
  if (!subs.length) {
    await advance({ spirit: withCategory(state.spirit, categories, main.id), category_options: [] });
    return;
  }
  const next = await advanceJob(db, job, ["category_main"], { step: "category_sub", category_options: [main.id, ...subs.map((c) => c.id)] });
  if (next) await sendMessage(chatId, T.chooseSubCategory(main.name), categoryKeyboard(job.id, subs.map((c) => c.name), "sub", main.name));
}

/** Unterkategorie gewählt (bzw. „Nur Hauptkategorie“): fertig. category_options[0] = Hauptkategorie. */
export async function chooseSubCategory(db: AdminClient, job: IngestJob, index: number | null, advance: (patch: Partial<IngestState>) => Promise<unknown>) {
  const state = jobState(job)!;
  const [mainId, ...subIds] = state.category_options ?? [];
  const id = index == null ? mainId : subIds[index];
  const categories = await loadSpiritCategories(db);
  if (!id || !state.spirit || !categories.some((c) => c.id === id)) return;
  await advance({ spirit: withCategory(state.spirit, categories, id), category_options: [] });
}

/** Beim Speichern: Angaben der Spirituose in wines – nur Leeres füllen (Bestehendes bleibt). */
export async function storeSpiritFields(db: AdminClient, wineId: string, state: IngestState) {
  if (state.proposal.type !== "spirit" || !state.spirit) return;
  try {
    const { data: wine, error } = await db.from("wines").select("*").eq("id", wineId).maybeSingle();
    if (error) throw error;
    if (!wine) return;
    const now = toSpiritFields(wine as unknown as Record<string, unknown>);
    const d = state.spirit;
    const patch: Database["public"]["Tables"]["wines"]["Update"] = {};
    if (wine.type !== "spirit") patch.type = "spirit";
    if (now.categoryId == null && d.categoryId) patch.spirit_category_id = d.categoryId;
    if (now.ageYears == null && d.ageYears) patch.age_years = d.ageYears;
    if (now.cask == null && d.cask) patch.cask = d.cask;
    if (now.distilledYear == null && d.distilledYear) patch.distilled_year = d.distilledYear;
    if (now.bottledYear == null && d.bottledYear) patch.bottled_year = d.bottledYear;
    if (Object.keys(patch).length) {
      const { error: updateError } = await db.from("wines").update(patch).eq("id", wineId);
      if (updateError) throw updateError;
    }
  } catch (error) {
    // Die Flasche ist gespeichert; die Angaben lassen sich über Antoine nachtragen.
    console.error("storing spirit fields failed", error);
  }
}
