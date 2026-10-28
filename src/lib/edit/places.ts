// Ort-Regel (App und Bot): Allgemeine Wörter wie „Restaurant“, „Bar“, „zuhause bei Freunden“
// oder „Weingut“ ohne Namen sind kein Ort – höchstens die Art. Nur echte Namen („Kronenhalle“,
// „Napa Grill“) werden Orte. Rein, ohne DB.

import type { PlaceKind } from "./types";

const KIND_OF: Record<string, PlaceKind> = {
  restaurant: "restaurant",
  beiz: "restaurant",
  beizli: "restaurant",
  lokal: "restaurant",
  hotel: "restaurant",
  cafe: "restaurant",
  bistro: "restaurant",
  bar: "bar",
  weinbar: "bar",
  vinothek: "bar",
  weingut: "weingut",
  winzer: "weingut",
  kellerei: "weingut",
  freunden: "privat",
  freunde: "privat",
  familie: "privat",
  zuhause: "privat",
  hause: "privat",
  privat: "privat",
  party: "privat",
  fest: "privat",
  geburtstag: "privat",
  messe: "messe",
  degustation: "messe",
};

/** Füllwörter, die allein nichts Eigenes bezeichnen. */
const FILLER = new Set(["im", "in", "der", "die", "das", "dem", "den", "ein", "eine", "einem", "einer", "einen", "auf", "bei", "zu", "zum", "zur", "am", "an", "unserem", "unserer", "irgendeinem", "kleinen", "kleines", "netten", "nettes", "schönen", "guten", "italienischen", "französischen", "von", "mit", "und"]);

const norm = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Nur ein allgemeines Wort (bzw. Wörter) ohne Namen? Dann die Art des Orts, sonst null
 * (= ein echter Name, z. B. „Kronenhalle“ oder „Restaurant Kronenhalle“).
 */
export function genericPlaceKind(text: string): PlaceKind | null {
  const words = norm(text).filter((w) => !FILLER.has(w));
  if (!words.length) return null;
  let kind: PlaceKind | null = null;
  for (const w of words) {
    const k = KIND_OF[w];
    if (!k) return null; // ein eigenes Wort → Name
    kind ??= k;
  }
  return kind;
}

/** Text → Ort: echter Name (mit Art, falls erkennbar) oder nur die Art. */
export function placeFromText(text: string): { name: string | null; kind: PlaceKind | null } {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return { name: null, kind: null };
  const generic = genericPlaceKind(t);
  if (generic) return { name: null, kind: generic };
  // „Restaurant Kronenhalle“: Art merken, Name ganz lassen.
  const first = norm(t).find((w) => !FILLER.has(w));
  return { name: t, kind: first ? (KIND_OF[first] ?? null) : null };
}
