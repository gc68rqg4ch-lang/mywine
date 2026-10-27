import { Fragment, type ReactNode } from "react";
import { WineTypeIcon } from "@/components/wine-type-icon";
import type { GroupBy, GroupItem, Groupable, WineGroup } from "@/lib/cellar/overview";

/**
 * Einklappbare Gruppen mit Trauben-Symbol bzw. Flagge und Flaschenzahl. Beim Laden
 * zugeklappt; bei aktiver Suche sind nur Gruppen mit Treffern da – die gehen auf.
 */
export function GroupedList<T extends Groupable>({
  groups,
  groupBy,
  query,
  empty,
  itemKey,
  renderItem,
}: {
  groups: WineGroup<T>[];
  groupBy: GroupBy;
  query: string;
  empty: string;
  itemKey: (item: GroupItem<T>) => string;
  renderItem: (item: GroupItem<T>) => ReactNode;
}) {
  if (groups.length === 0) return <p className="empty">{query ? "Keine Weine passen zur Suche." : empty}</p>;

  const list = (items: GroupItem<T>[]) => (
    <ul className="list">
      {items.map((item) => (
        <Fragment key={itemKey(item)}>{renderItem(item)}</Fragment>
      ))}
    </ul>
  );

  return (
    <div className="groups">
      {groups.map((group) => (
        <details key={`${groupBy}:${group.key || "none"}:${query}`} className="group" open={query !== ""}>
          <summary>
            {groupBy === "typ" && <WineTypeIcon type={group.wineType ?? null} size={24} />}
            {group.flag && (
              <span className="flag" aria-hidden>
                {group.flag}
              </span>
            )}
            <span className="group-title">{group.label}</span>
            <span className="group-count">{group.bottles} Fl.</span>
          </summary>
          {group.sections?.length
            ? group.sections.map((section) => (
                <section key={section.key} className="group-section">
                  <h3 className="group-section-title">
                    <span>{section.label}</span>
                    <span className="group-count">{section.bottles} Fl.</span>
                  </h3>
                  {list(section.items)}
                </section>
              ))
            : list(group.items)}
        </details>
      ))}
    </div>
  );
}
