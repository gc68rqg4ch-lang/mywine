"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { rememberList } from "@/components/cellar/list-memory";
import { useLiveSearch } from "@/components/cellar/live-search";

/**
 * Einklappbare Gruppe; Auf-/Zuklappen landet in der URL (?auf=…), damit „Zurück“ dieselben
 * Gruppen offen zeigt. Nur Klicks zählen – nicht das automatische Öffnen bei einer Suche.
 * Suche beim Tippen: mit Suchbegriff alle Gruppen offen; Suche geleert → wie in der URL (?auf=…).
 */
export function GroupDetails({
  id,
  groupKey,
  initialOpen,
  children,
}: {
  id: string;
  groupKey: string;
  initialOpen: boolean;
  children: ReactNode;
}) {
  const clicked = useRef(false);
  const ref = useRef<HTMLDetailsElement>(null);
  const searching = useLiveSearch().query.trim() !== "";
  const was = useRef(searching);
  useEffect(() => {
    // Suche geleert: wieder so offen wie in der URL (?auf=…); mit Suche sind alle offen (open).
    if (was.current && !searching && ref.current) {
      ref.current.open = new URL(window.location.href).searchParams.getAll("auf").includes(groupKey);
    }
    was.current = searching;
  }, [searching, groupKey]);
  return (
    <details
      ref={ref}
      id={id}
      className="group"
      open={initialOpen || searching}
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest("summary")) clicked.current = true;
      }}
      onToggle={(e) => {
        if (!clicked.current) return;
        clicked.current = false;
        const url = new URL(window.location.href);
        const keys = url.searchParams.getAll("auf").filter((k) => k !== groupKey);
        if (e.currentTarget.open) keys.push(groupKey);
        url.searchParams.delete("auf");
        for (const k of keys) url.searchParams.append("auf", k);
        url.hash = "";
        window.history.replaceState(null, "", `${url.pathname}${url.search}`);
        rememberList();
      }}
    >
      {children}
    </details>
  );
}
