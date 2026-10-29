"use client";

import { useEffect } from "react";
import { lockedViewport, shouldResetZoom, type ReturnEvent } from "@/lib/ui/zoom";

/** Wie lange der Viewport gesperrt bleibt, bis Safari auf Zoomstufe 1 zurück ist. */
const RESTORE_MS = 400;

/**
 * Kehrt man zur App zurück (Safari stellt die Seite aus dem Zwischenspeicher wieder her, App
 * wieder im Vordergrund, Rückkehr in den Tab) und ist sie hineingezoomt, auf Zoomstufe 1
 * zurück – ohne Neuladen, Eingaben bleiben. Gilt für alle Seiten (im gemeinsamen Layout).
 */
export function ZoomReset() {
  useEffect(() => {
    let timer = 0;
    // Seit wann die Seite verdeckt bzw. ohne Fokus ist (null = gerade im Vordergrund).
    let awaySince: number | null = null;
    const leave = () => {
      awaySince ??= Date.now();
    };
    const reset = (event: ReturnEvent) => {
      const awayMs = awaySince == null ? null : Date.now() - awaySince;
      awaySince = null;
      if (!shouldResetZoom(event, window.visualViewport?.scale, awayMs)) return;
      const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
      if (!meta || timer) return;
      const original = meta.content;
      meta.content = lockedViewport(original);
      timer = window.setTimeout(() => {
        meta.content = original;
        timer = 0;
      }, RESTORE_MS);
    };
    const onPageShow = (e: PageTransitionEvent) => reset({ type: "pageshow", persisted: e.persisted });
    const onVisibility = () => (document.visibilityState === "hidden" ? leave() : reset({ type: "visibilitychange", visibility: document.visibilityState }));
    const onFocus = () => reset({ type: "focus" });
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", leave);
    window.addEventListener("blur", leave);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("blur", leave);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(timer);
    };
  }, []);
  return null;
}
