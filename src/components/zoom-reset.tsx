"use client";

import { useEffect, useState } from "react";
import {
  CHECK_DELAYS_MS,
  debugEnabled,
  inWatchWindow,
  isReturn,
  loadKind,
  lockedViewport,
  minMaxViewport,
  nextMethod,
  resetOutcome,
  zoomedIn,
  type LoadKind,
  type ResetMethod,
  type ReturnEvent,
} from "@/lib/ui/zoom";

/** Wie lange eine Methode wirkt, bevor der Viewport wiederhergestellt und gemessen wird. */
const RESTORE_MS = 400;
const MEASURE_MS = 250;
const DEBUG_KEY = "mywine:zoomdebug";
const LOG_KEY = "mywine:zoomdebug:log";

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const scaleNow = () => window.visualViewport?.scale ?? null;
const fmt = (n: number | null) => (n == null ? "–" : n.toFixed(2));
const time = () => new Date().toLocaleTimeString("de-CH");

function store(key: string, value: string | null) {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // privat/gesperrt
  }
}
function load(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Eine Methode anwenden, Viewport wiederherstellen, danach messen. */
async function apply(method: ResetMethod) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const original = meta.content;
  if (method === "Meta umstellen") {
    meta.content = lockedViewport(original);
    await wait(RESTORE_MS);
    meta.content = original;
  } else if (method === "Meta neu einfügen") {
    // Tag entfernen und gesperrt neu einfügen, danach wieder mit dem bisherigen Inhalt.
    const fresh = document.createElement("meta");
    fresh.name = "viewport";
    fresh.content = lockedViewport(original);
    meta.replaceWith(fresh);
    await wait(RESTORE_MS);
    fresh.content = original;
  } else {
    meta.content = minMaxViewport(original);
    await wait(RESTORE_MS);
    meta.content = original;
  }
  await wait(MEASURE_MS);
}

/**
 * Zoom beim Laden und beim Zurückkehren auf Stufe 1 zurücksetzen (iPad/iPhone): Safari lädt die
 * Seite beim Wiederöffnen oft neu und stellt den Zoom erst danach wieder her. Darum nach dem
 * Laden bzw. der Rückkehr mehrmals prüfen (sofort, 0,3 s, 1 s, 2,5 s) und in diesen 3 Sekunden
 * auch auf „resize“ reagieren; danach nie – Zwei-Finger-Zoom in der App bleibt möglich.
 * Wirkt eine Methode nicht (gemessen an visualViewport.scale), kommt die nächste.
 * Diagnose mit ?zoomdebug=1 (bleibt für den Tab, ?zoomdebug=0 schaltet aus).
 */
export function ZoomReset() {
  const [debug, setDebug] = useState(false);
  const [info, setInfo] = useState<{ scale: number | null; kind: LoadKind | null; attempts: number; log: string[] }>({ scale: null, kind: null, attempts: 0, log: [] });

  useEffect(() => {
    const on = debugEnabled(window.location.search, load(DEBUG_KEY));
    store(DEBUG_KEY, on ? "1" : null);
    if (!on) store(LOG_KEY, null);
    let log: string[] = on ? JSON.parse(load(LOG_KEY) ?? "[]") : [];
    const note = (line: string) => {
      if (!on) return;
      log = [...log, `${time()} ${line}`].slice(-8);
      store(LOG_KEY, JSON.stringify(log));
      setInfo((i) => ({ ...i, log }));
    };
    const show = () => on && setInfo((i) => ({ ...i, scale: scaleNow() }));
    // In einem Effekt nötig: erst im Browser ist bekannt, ob die Diagnose an ist.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDebug(on);

    let since: number | null = null;
    let kind: LoadKind = "neu";
    let busy = false;
    let timers: number[] = [];

    const check = async (why: string) => {
      const before = scaleNow();
      show();
      if (busy || !zoomedIn(before)) return;
      busy = true;
      try {
        const tried: ResetMethod[] = [];
        let current = before!;
        for (let method = nextMethod(tried); method; method = nextMethod(tried)) {
          tried.push(method);
          if (on) setInfo((i) => ({ ...i, attempts: i.attempts + 1 }));
          await apply(method);
          const after = scaleNow();
          note(`${kind}/${why}: ${fmt(current)} → ${method} → ${fmt(after)} (${resetOutcome(current, after)})`);
          if (!zoomedIn(after)) break;
          current = after ?? current;
        }
      } finally {
        busy = false;
        show();
      }
    };

    const start = (k: LoadKind) => {
      kind = k;
      since = Date.now();
      if (on) setInfo((i) => ({ ...i, kind: k }));
      note(`${k}: scale ${fmt(scaleNow())}`);
      timers.forEach((t) => window.clearTimeout(t));
      timers = CHECK_DELAYS_MS.map((ms) => window.setTimeout(() => void check(`${ms} ms`), ms));
    };

    // Beim Laden
    const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
    start(loadKind(nav?.type));

    // Rückkehr (Zwischenspeicher, Tab/App wieder vorne nach ≥ 1 s)
    let awaySince: number | null = null;
    const leave = () => {
      awaySince ??= Date.now();
    };
    const back = (event: ReturnEvent) => {
      const awayMs = awaySince == null ? null : Date.now() - awaySince;
      awaySince = null;
      if (isReturn(event, awayMs)) start(event.type === "pageshow" ? "Zwischenspeicher" : "Rückkehr");
    };
    const onPageShow = (e: PageTransitionEvent) => back({ type: "pageshow", persisted: e.persisted });
    const onVisibility = () => (document.visibilityState === "hidden" ? leave() : back({ type: "visibilitychange", visibility: document.visibilityState }));
    const onFocus = () => back({ type: "focus" });
    // In den ersten 3 s nach Laden/Rückkehr: auch wenn Safari den Zoom später wiederherstellt.
    let resizeTimer = 0;
    const onResize = () => {
      show();
      if (!inWatchWindow(Date.now(), since)) return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => void check("resize"), 150);
    };
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", leave);
    window.addEventListener("blur", leave);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(resizeTimer);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("blur", leave);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);

  if (!debug) return null;
  return (
    <div className="zoom-debug" aria-hidden>
      <div>
        scale {fmt(info.scale)} · {info.kind ?? "–"} · Versuche {info.attempts}
      </div>
      {info.log.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}
