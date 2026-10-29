"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { lastListUrl, markRestore } from "@/components/cellar/list-memory";
import { BACK_FALLBACK_MS, backHref, navigationStuck, plainClick } from "@/lib/ui/back-link";

const here = () => `${window.location.pathname}${window.location.search}`;

/**
 * Zurück-Link mit Rückfall: Läuft auf der Seite noch eine Aktion (Formular, Transition), wartet die
 * App-Navigation, bis sie fertig ist – der Tipp scheint nichts zu bewirken. Steht die Adresse nach
 * 1,5 s noch, lädt der Link das Ziel hart.
 */
export function FallbackLink({ href, children, onClick }: { href: string; children: ReactNode; onClick?: () => void }) {
  const fallback = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (fallback.current != null) window.clearTimeout(fallback.current);
    },
    [],
  );
  const click = (e: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.();
    if (!plainClick(e)) return;
    const before = here();
    if (fallback.current != null) window.clearTimeout(fallback.current);
    fallback.current = window.setTimeout(() => {
      fallback.current = null;
      if (navigationStuck(before, here())) window.location.assign(href);
    }, BACK_FALLBACK_MS);
  };
  return (
    <Link href={href} className="back" onClick={click}>
      {children}
    </Link>
  );
}

/** „← Bestand“ (bzw. Offen, Getrunken, Verkostet, Start): zurück zur zuletzt gezeigten Ansicht der Liste. */
export function BackLink({ base, label }: { base: string; label: string }) {
  const [href, setHref] = useState(base);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- erst im Browser bekannt (sessionStorage)
    setHref(backHref(base, lastListUrl(base)));
    const onPop = () => markRestore();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [base]);
  return (
    <FallbackLink href={href} onClick={markRestore}>
      ← {label}
    </FallbackLink>
  );
}
