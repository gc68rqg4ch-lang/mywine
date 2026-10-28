import { Fragment, type ReactNode } from "react";
import { GroupDetails } from "@/components/cellar/group-details";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { groupAnchor, type GroupBy, type GroupItem, type Groupable, type WineGroup } from "@/lib/cellar/overview";

/**
 * Einklappbare Gruppen mit Trauben-Symbol bzw. Flagge und Zahl. Aufgeklappt sind die Gruppen
 * aus der URL (?auf=…, z. B. nach „Zurück“ oder einem Tipp auf die Trinkreife); bei aktiver
 * Suche sind nur Gruppen mit Treffern da – die gehen alle auf.
 */
export function GroupedList<T extends Groupable>({
  groups,
  groupBy,
  query,
  openKeys = [],
  countLabel = (n) => `${n} Fl.`,
  empty,
  itemKey,
  renderItem,
}: {
  groups: WineGroup<T>[];
  groupBy: GroupBy;
  query: string;
  openKeys?: string[];
  /** Zahl im Gruppenkopf: Flaschen (Standard) bzw. z. B. Verkostungen. */
  countLabel?: (n: number) => string;
  empty: string;
  itemKey: (item: GroupItem<T>) => string;
  renderItem: (item: GroupItem<T>) => ReactNode;
}) {
  if (groups.length === 0) return <p className="empty">{query ? "Keine Weine passen zur Suche." : empty}</p>;

  const list = (items: GroupItem<T>[]) => (
    <ul className="list list-cols">
      {items.map((item) => (
        <Fragment key={itemKey(item)}>{renderItem(item)}</Fragment>
      ))}
    </ul>
  );

  return (
    <div className="groups">
      {groups.map((group) => (
        <GroupDetails
          key={`${groupBy}:${group.key || "none"}:${query}:${openKeys.join("|")}`}
          id={groupAnchor(groupBy, group.key)}
          groupKey={group.key}
          initialOpen={query !== "" || openKeys.includes(group.key)}
        >
          <summary>
            {groupBy === "typ" && <WineTypeIcon type={group.wineType ?? null} size={24} />}
            {group.flag && (
              <span className="flag" aria-hidden>
                {group.flag}
              </span>
            )}
            <span className="group-title">{group.label}</span>
            <span className="group-count">{countLabel(group.bottles)}</span>
          </summary>
          {group.sections?.length
            ? group.sections.map((section) => (
                <section key={section.key} className="group-section">
                  <h3 className="group-section-title">
                    <span>{section.label}</span>
                    <span className="group-count">{countLabel(section.bottles)}</span>
                  </h3>
                  {list(section.items)}
                </section>
              ))
            : list(group.items)}
        </GroupDetails>
      ))}
    </div>
  );
}
