import { Fragment, Suspense, type ReactNode } from "react";
import { GroupedList } from "@/components/cellar/grouped-list";
import { ListControls } from "@/components/cellar/list-controls";
import { ListMemory } from "@/components/cellar/list-memory";
import { TypeTabs } from "@/components/cellar/type-tabs";
import { applyFilters, filterOptions, typeCounts, type Filterable } from "@/lib/cellar/filters";
import { applyTypeFilter, type ListState } from "@/lib/cellar/list-params";
import { groupWines, type GroupBy, type GroupItem } from "@/lib/cellar/overview";

/**
 * Eine Liste (Bestand, Offen, Getrunken, Verkostet): Suche/Filter/Gruppierung oben, bei
 * „Weintyp“ Knöpfe und direkt die Liste des gewählten Typs, sonst einklappbare Gruppen.
 * entries: nach Lagerort und Suche, vor Filtern und Typ.
 */
export function ListView<T extends Filterable>({
  basePath,
  state,
  groupings,
  entries,
  year,
  countMode = "bottles",
  countLabel,
  empty,
  itemKey,
  renderItem,
}: {
  basePath: string;
  state: ListState;
  groupings: GroupBy[];
  entries: T[];
  year: number;
  countMode?: "bottles" | "wines";
  countLabel?: (n: number) => string;
  empty: string;
  itemKey: (item: GroupItem<T>) => string;
  renderItem: (item: GroupItem<T>) => ReactNode;
}) {
  const filtered = applyFilters(entries, state.filters, year);
  const counts = typeCounts(filtered, countMode);
  const shown = applyTypeFilter(filtered, state.type);
  // Auswahl im Filterfeld aus der Liste des gewählten Typs (vor den Filtern).
  const options = filterOptions(applyTypeFilter(entries, state.type), state.filters, year);
  const nothing = <p className="empty">{state.query ? "Keine Weine passen zur Suche." : entries.length ? "Keine Weine passen zu diesen Filtern." : empty}</p>;

  let body: ReactNode;
  if (state.groupBy === "typ") {
    // Gruppierung Weintyp: die Einträge des Typs, je Eintrag alle Einheiten.
    const items: GroupItem<T>[] = shown.map((wine) => ({
      wine,
      bottles: wine.units.reduce((s, u) => s + u.count, 0),
      vintages: wine.vintages,
    }));
    body = (
      <>
        <TypeTabs basePath={basePath} state={state} counts={counts} unit={(n) => (countMode === "wines" ? (n === 1 ? "1 Wein" : `${n} Weine`) : `${n} Fl.`)} />
        {items.length ? (
          <ul className="list list-cols">
            {items.map((item) => (
              <Fragment key={itemKey(item)}>{renderItem(item)}</Fragment>
            ))}
          </ul>
        ) : (
          nothing
        )}
      </>
    );
  } else {
    const groups = groupWines(shown, state.groupBy, year);
    body = groups.length ? (
      <GroupedList
        groups={groups}
        groupBy={state.groupBy}
        query={state.query}
        openKeys={state.open}
        countLabel={countLabel}
        empty={empty}
        itemKey={itemKey}
        renderItem={renderItem}
      />
    ) : (
      nothing
    );
  }

  return (
    <>
      <ListControls basePath={basePath} state={state} groupings={groupings} typeCounts={counts} options={options} />
      {body}
      <Suspense fallback={null}>
        <ListMemory basePath={basePath} />
      </Suspense>
    </>
  );
}
