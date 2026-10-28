"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

// Zurück zur Liste: die zuletzt gezeigte Listen-URL (mit Gruppierung, Filtern, offenen
// Gruppen) und die Scroll-Position je URL liegen in sessionStorage. Wiederhergestellt wird
// nur nach „← Liste“ oder der Browser-Zurück-Taste (Merker RESTORE_KEY).

const LIST_KEY = (base: string) => `mywine:list:${base}`;
const SCROLL_KEY = (url: string) => `mywine:scroll:${url}`;
export const RESTORE_KEY = "mywine:restore";

function store(key: string, value: string | null) {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // privat/gesperrt: ohne Gedächtnis
  }
}
function load(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Zuletzt gezeigte URL einer Liste (z. B. „/?gruppe=land&auf=Spanien“), sonst null. */
export function lastListUrl(base: string) {
  return load(LIST_KEY(base));
}

const here = () => `${window.location.pathname}${window.location.search}`;

/** Aktuelle URL als „zuletzt gezeigt“ für diese Liste merken (z. B. nach Auf-/Zuklappen). */
export function rememberList(basePath = window.location.pathname) {
  store(LIST_KEY(basePath), here());
}

/** Vor dem Zurückgehen: Scroll-Position der Liste wiederherstellen lassen. */
export function markRestore() {
  store(RESTORE_KEY, "1");
}

export function ListMemory({ basePath }: { basePath: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const url = `${pathname}${search ? `?${search}` : ""}`;

  // Aktuelle URL merken (auch nach Auf-/Zuklappen über history.replaceState).
  useEffect(() => {
    store(LIST_KEY(basePath), url);
  }, [basePath, url]);

  // Scroll-Position laufend je URL sichern; beim Zurückkommen wiederherstellen.
  useEffect(() => {
    if (load(RESTORE_KEY)) {
      store(RESTORE_KEY, null);
      const y = Number(load(SCROLL_KEY(here())));
      if (y > 0) {
        // Nach dem Rendern und nach dem Scrollen des Routers.
        requestAnimationFrame(() => setTimeout(() => window.scrollTo(0, y), 0));
      }
    }
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        store(SCROLL_KEY(here()), String(Math.round(window.scrollY)));
        rememberList(basePath);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
    // Nur beim Betreten der Liste wiederherstellen, nicht bei jeder URL-Änderung.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
