"use client";

import { useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { rememberList } from "@/components/cellar/list-memory";
import { anyVisible, liveCount, visibleIds, withQuery, type CountParts } from "@/lib/cellar/search";

// Suche beim Tippen: gefiltert wird im Browser über die schon geladenen Einträge (Suchtext je
// Eintrag vom Server) – ohne Server- und Datenbank-Aufruf pro Tastendruck. Die Karten sind fertig
// gerendert und werden nur ein- bzw. ausgeblendet; Zahlen und Filter rechnen live mit.
// Die URL (q) wird mit replaceState nachgeführt: „Zurück“ springt nicht durch jeden Buchstaben.

type Ctx = {
  /** Text im Suchfeld (sofort). */
  query: string;
  setQuery: (q: string) => void;
  /** Sichtbare Einträge (leicht verzögert, damit das Tippen nie stockt); null = alle. */
  visible: Set<string> | null;
};

const SearchContext = createContext<Ctx>({ query: "", setQuery: () => {}, visible: null });

export const useLiveSearch = () => useContext(SearchContext);

export function SearchScope({ basePath, index, initialQuery, children }: { basePath: string; index: Record<string, string>; initialQuery: string; children: ReactNode }) {
  // Beim Zurückkommen (neu eingehängt) gilt die URL – die gespeicherte Seite kann älter sein.
  const [query, setState] = useState(() => (typeof window === "undefined" ? initialQuery : (new URLSearchParams(window.location.search).get("q") ?? initialQuery)));
  // Letzter Stand im Feld (für den Abgleich mit der URL); gesetzt beim Tippen bzw. Übernehmen.
  const latest = useRef(query);
  // Navigation von aussen (z. B. Link ohne q): Zustand aus der URL übernehmen. Eigene, noch
  // nachlaufende Werte (schnelles Tippen) erkennt man daran, dass die URL schon weiter ist.
  const urlQuery = useSearchParams().get("q") ?? "";
  useEffect(() => {
    const now = new URLSearchParams(window.location.search).get("q") ?? "";
    if (urlQuery === now && urlQuery.trim() !== latest.current.trim()) {
      latest.current = urlQuery;
      setState(urlQuery);
    }
  }, [urlQuery]);

  const setQuery = useCallback(
    (q: string) => {
      setState(q);
      latest.current = q;
      window.history.replaceState(null, "", withQuery(`${window.location.pathname}${window.location.search}`, q));
      rememberList(basePath);
    },
    [basePath],
  );

  const deferred = useDeferredValue(query);
  const visible = useMemo(() => visibleIds(index, deferred), [index, deferred]);
  const value = useMemo(() => ({ query, setQuery, visible }), [query, setQuery, visible]);
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

/** Ein Eintrag: nur sichtbar, wenn er zur Suche passt. */
export function Hit({ id, children }: { id: string; children: ReactNode }) {
  const { visible } = useLiveSearch();
  return visible == null || visible.has(id) ? children : null;
}

/** Gruppe bzw. Abschnitt: verschwindet, wenn kein Eintrag passt. */
export function HitGroup({ ids, children }: { ids: string[]; children: ReactNode }) {
  const { visible } = useLiveSearch();
  return anyVisible(ids, visible) ? children : null;
}

export type CountUnit = "bottles" | "times";
export const countText = (n: number, unit: CountUnit) => (unit === "times" ? `${n}×` : `${n} Fl.`);

/** Zahl im Gruppenkopf, live über die sichtbaren Einträge. */
export function HitCount({ parts, unit }: { parts: CountParts; unit: CountUnit }) {
  const { visible } = useLiveSearch();
  return <>{countText(liveCount(parts, visible), unit)}</>;
}

/** Ohne Treffer: kurzer Hinweis mit Knopf zum Zurücksetzen. */
export function NoHits({ ids }: { ids: string[] }) {
  const { visible, setQuery } = useLiveSearch();
  if (visible == null || anyVisible(ids, visible)) return null;
  return (
    <div className="empty no-hits">
      <p>Keine Treffer.</p>
      <button type="button" className="btn btn-sm" onClick={() => setQuery("")}>
        Suche zurücksetzen
      </button>
    </div>
  );
}
