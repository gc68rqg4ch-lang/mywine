// Hinweis zu recherchierten Preisen (rein): aus inventory_items.price_note.

/** Weinseite: „Preis recherchiert: Mövenpick, 29.10.2026“ bzw. „… Drinks (3 Händler), 29.10.2026“ aus price_note. */
export function priceNoteHint(note: string | null | undefined) {
  if (!note) return null;
  const parts = note.split(" · ");
  const date = parts.find((p) => /^\d{2}\.\d{2}\.\d{4}$/.test(p));
  const count = parts.find((p) => /^\d+ Händler$/.test(p));
  return `Preis recherchiert: ${[count ? `${parts[0]} (${count})` : parts[0], date].filter(Boolean).join(", ")}`;
}
