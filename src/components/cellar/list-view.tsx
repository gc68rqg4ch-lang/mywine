import { Suspense, type ReactNode } from "react";
import { GroupedList } from "@/components/cellar/grouped-list";
import { ListControls } from "@/components/cellar/list-controls";
import { ListMemory } from "@/components/cellar/list-memory";
import { Hit, NoHits, SearchScope } from "@/components/cellar/live-search";
import { TypeTabs } from "@/components/cellar/type-tabs";
import { applyFilters, optionPart, typeCountParts, type Filterable } from "@/lib/cellar/filters";
import { applyTypeFilter, type ListState } from "@/lib/cellar/list-params";
import { groupWines, type GroupBy, type GroupItem } from "@/lib/cellar/overview";
import { searchText } from "@/lib/cellar/search";
import { SpiritChips } from "@/components/cellar/spirit-chips";
import type { SpiritCategory } from "@/lib/spirits/categories";
import { applySpiritFilter, categoryChips } from "@/lib/spirits/tag";

type Tagged<T> = T & { searchId: string };

/**
 * Eine Liste (Bestand, Offen, Getrunken, Verkostet): Suche/Filter/Gruppierung oben, bei
 * „Weintyp“ Knöpfe und direkt die Liste des gewählten Typs, sonst einklappbare Gruppen.
 * entries: nach Lagerort, vor Suche, Filtern und Typ. Die Suche läuft im Browser über alle
 * Einträge (Suchtext je Eintrag, inkl. Notizen): beim Tippen kein Server-Aufruf.
 */
export function ListView<T extends Filterable>({
  basePath,
  state,
  groupings,
  entries,
  year,
  countMode = "bottles",
  countUnit = "bottles",
  notes,
  empty,
  itemKey,
  renderItem,
  spiritCategories = [],
}: {
  basePath: string;
  state: ListState;
  groupings: GroupBy[];
  entries: T[];
  year: number;
  countMode?: "bottles" | "wines";
  /** Zahl im Gruppenkopf: Flaschen bzw. Verkostungen („3×“). */
  countUnit?: "bottles" | "times";
  /** Notizen zum Eintrag – werden mitdurchsucht. */
  notes?: (entry: T) => string | null | undefined;
  empty: string;
  itemKey: (item: GroupItem<T>) => string;
  renderItem: (item: GroupItem<T>) => ReactNode;
  /** Kategorien der Spirituosen (Filter bei Art „Spirituose“). */
  spiritCategories?: SpiritCategory[];
}) {
  // Jeder Eintrag bekommt eine Kennung für die Suche (bleibt beim Filtern erhalten).
  const tagged: Tagged<T>[] = entries.map((e, i) => ({ ...e, searchId: `e${i}` }));
  const idOf = (e: Tagged<T>) => e.searchId;
  const index = Object.fromEntries(tagged.map((e) => [e.searchId, searchText(e, notes?.(e))]));

  const filtered = applyFilters(tagged, state.filters, year);
  const counts = typeCountParts(filtered, countMode, idOf);
  const ofType = applyTypeFilter(filtered, state.type);
  // Art „Spirituose“: Kategorie-Filter in zwei Ebenen (nur vorhandene Kategorien, mit Anzahl).
  const spiritMode = state.type === "spirit";
  const chips = spiritMode
    ? categoryChips(ofType, spiritCategories, state.spirit, idOf, (e) => (countMode === "wines" ? 1 : e.units.reduce((n, u) => n + u.count, 0)))
    : null;
  const shown = spiritMode ? applySpiritFilter(ofType, state.spirit) : ofType;
  const spiritRow = chips ? <SpiritChips basePath={basePath} state={state} mains={chips.mains} subs={chips.subs} /> : null;
  // Auswahl im Filterfeld aus der Liste des gewählten Typs (vor den Filtern) – live nach Suche.
  const optionParts = applyTypeFilter(tagged, state.type).map((e): [string, ReturnType<typeof optionPart>] => [e.searchId, optionPart(e, year)]);
  const nothing = <p className="empty">{entries.length ? "Keine Weine passen zu diesen Filtern." : empty}</p>;
  const noHits = <NoHits ids={shown.map(idOf)} />;

  let body: ReactNode;
  if (state.groupBy === "typ") {
    // Gruppierung Weintyp: die Einträge des Typs, je Eintrag alle Einheiten.
    const items: GroupItem<Tagged<T>>[] = shown.map((wine) => ({
      wine,
      bottles: wine.units.reduce((s, u) => s + u.count, 0),
      vintages: wine.vintages,
    }));
    body = (
      <>
        <TypeTabs basePath={basePath} state={state} counts={counts} unit={countMode} />
        {spiritRow}
        {items.length ? (
          <>
            <ul className="list list-cols">
              {items.map((item) => (
                <Hit key={itemKey(item)} id={item.wine.searchId}>
                  {renderItem(item)}
                </Hit>
              ))}
            </ul>
            {noHits}
          </>
        ) : (
          nothing
        )}
      </>
    );
  } else {
    const groups = groupWines(shown, state.groupBy, year);
    body = groups.length ? (
      <>
        {spiritRow}
        <GroupedList
          groups={groups}
          groupBy={state.groupBy}
          query={state.query}
          openKeys={state.open}
          unit={countUnit}
          idOf={(item) => item.wine.searchId}
          itemKey={itemKey}
          renderItem={renderItem}
        />
        {noHits}
      </>
    ) : (
      <>
        {spiritRow}
        {nothing}
      </>
    );
  }

  return (
    <SearchScope basePath={basePath} index={index} initialQuery={state.query}>
      <ListControls basePath={basePath} state={state} groupings={groupings} typeCounts={counts} optionParts={optionParts} shownIds={shown.map(idOf)} />
      {body}
      <Suspense fallback={null}>
        <ListMemory basePath={basePath} />
      </Suspense>
    </SearchScope>
  );
}
