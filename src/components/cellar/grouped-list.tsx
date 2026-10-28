import type { ReactNode } from "react";
import { GroupDetails } from "@/components/cellar/group-details";
import { Hit, HitCount, HitGroup, type CountUnit } from "@/components/cellar/live-search";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { groupAnchor, type GroupBy, type GroupItem, type Groupable, type WineGroup } from "@/lib/cellar/overview";
import type { CountParts } from "@/lib/cellar/search";

/**
 * Einklappbare Gruppen mit Trauben-Symbol bzw. Flagge und Zahl. Aufgeklappt sind die Gruppen
 * aus der URL (?auf=…, z. B. nach „Zurück“ oder einem Tipp auf die Trinkreife); bei aktiver
 * Suche (im Browser, beim Tippen) sind nur Gruppen mit Treffern da – die gehen alle auf, und die
 * Zahlen zählen nur die Treffer.
 */
export function GroupedList<T extends Groupable>({
  groups,
  groupBy,
  query,
  openKeys = [],
  unit = "bottles",
  idOf,
  itemKey,
  renderItem,
}: {
  groups: WineGroup<T>[];
  groupBy: GroupBy;
  /** Suche beim Laden der Seite (für das erste Aufklappen). */
  query: string;
  openKeys?: string[];
  /** Zahl im Gruppenkopf: Flaschen (Standard) bzw. Verkostungen („3×“). */
  unit?: CountUnit;
  /** Kennung des Eintrags für die Suche. */
  idOf: (item: GroupItem<T>) => string;
  itemKey: (item: GroupItem<T>) => string;
  renderItem: (item: GroupItem<T>) => ReactNode;
}) {
  const parts = (items: GroupItem<T>[]): CountParts => items.map((item) => [idOf(item), item.bottles]);
  const ids = (items: GroupItem<T>[]) => [...new Set(items.map(idOf))];

  const list = (items: GroupItem<T>[]) => (
    <ul className="list list-cols">
      {items.map((item) => (
        <Hit key={itemKey(item)} id={idOf(item)}>
          {renderItem(item)}
        </Hit>
      ))}
    </ul>
  );

  return (
    <div className="groups">
      {groups.map((group) => (
        <HitGroup key={`${groupBy}:${group.key || "none"}:${openKeys.join("|")}`} ids={ids(group.items)}>
          <GroupDetails id={groupAnchor(groupBy, group.key)} groupKey={group.key} initialOpen={query.trim() !== "" || openKeys.includes(group.key)}>
            <summary>
              {groupBy === "typ" && <WineTypeIcon type={group.wineType ?? null} size={24} />}
              {group.flag && (
                <span className="flag" aria-hidden>
                  {group.flag}
                </span>
              )}
              <span className="group-title">{group.label}</span>
              <span className="group-count">
                <HitCount parts={parts(group.items)} unit={unit} />
              </span>
            </summary>
            {group.sections?.length
              ? group.sections.map((section) => (
                  <HitGroup key={section.key} ids={ids(section.items)}>
                    <section className="group-section">
                      <h3 className="group-section-title">
                        <span>{section.label}</span>
                        <span className="group-count">
                          <HitCount parts={parts(section.items)} unit={unit} />
                        </span>
                      </h3>
                      {list(section.items)}
                    </section>
                  </HitGroup>
                ))
              : list(group.items)}
          </GroupDetails>
        </HitGroup>
      ))}
    </div>
  );
}
