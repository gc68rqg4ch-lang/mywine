"use client";

import Link from "next/link";
import { useLiveSearch } from "@/components/cellar/live-search";
import { listHref, type ListState } from "@/lib/cellar/list-params";
import { liveCount } from "@/lib/cellar/search";
import type { CategoryChip } from "@/lib/spirits/tag";

/**
 * Art „Spirituose“ gewählt: eine Zeile mit den Hauptkategorien (nur vorhandene, mit Anzahl
 * Flaschen), bei gewählter Hauptkategorie mit Unterkategorien eine zweite Zeile. „Alle“ setzt die
 * jeweilige Zeile zurück. Auf schmalen Bildschirmen seitlich wischbar; die Auswahl steht in der
 * URL (bleibt beim Zurückkehren erhalten).
 */
export function SpiritChips({ basePath, state, mains, subs }: { basePath: string; state: ListState; mains: CategoryChip[]; subs: CategoryChip[] }) {
  const { query, visible } = useLiveSearch();
  const live = { ...state, query };
  if (!mains.length) return null;
  const row = (label: string, chips: CategoryChip[], selected: string | null, select: (id: string | null) => ListState["spirit"]) => (
    <nav className="spirit-filter" aria-label={label}>
      <Link
        href={listHref(basePath, live, { spirit: select(null), open: [] })}
        className={selected ? "chip" : "chip active"}
        aria-current={selected ? undefined : "page"}
        scroll={false}
      >
        Alle
      </Link>
      {chips.map((c) => {
        const count = liveCount(c.parts, visible);
        const active = c.id === selected;
        return (
          <Link
            key={c.id}
            href={listHref(basePath, live, { spirit: select(c.id), open: [] })}
            className={["chip", active ? "active" : "", count === 0 ? "is-empty" : ""].filter(Boolean).join(" ")}
            aria-current={active ? "page" : undefined}
            scroll={false}
          >
            {c.name} <span className="chip-count">{count}</span>
          </Link>
        );
      })}
    </nav>
  );
  return (
    <div className="spirit-filters">
      {row("Kategorie", mains, state.spirit.main, (id) => ({ main: id, sub: null }))}
      {state.spirit.main && subs.length > 0 && row("Unterkategorie", subs, state.spirit.sub, (id) => ({ main: state.spirit.main, sub: id }))}
    </div>
  );
}
