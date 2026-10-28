"use client";

import { useRef, type ReactNode } from "react";
import { rememberList } from "@/components/cellar/list-memory";

/**
 * Einklappbare Gruppe; Auf-/Zuklappen landet in der URL (?auf=…), damit „Zurück“ dieselben
 * Gruppen offen zeigt. Nur Klicks zählen – nicht das automatische Öffnen bei einer Suche.
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
  return (
    <details
      id={id}
      className="group"
      open={initialOpen}
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
