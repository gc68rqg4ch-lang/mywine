// Zoom beim Zurückkehren zurücksetzen (rein, ohne DOM): Safari stellt eine Seite samt
// Zwei-Finger-Zoom aus dem Zwischenspeicher wieder her. Zurückgesetzt wird nur bei einer
// Rückkehr in die App – nie während man in der App ist (Zwei-Finger-Zoom bleibt möglich).

export type ReturnEvent =
  | { type: "pageshow"; persisted: boolean }
  | { type: "visibilitychange"; visibility: "visible" | "hidden" | string }
  | { type: "focus" };

/** Ab dieser Zoomstufe gilt die Seite als hineingezoomt (Rundungen von Safari ignorieren). */
export const ZOOM_TOLERANCE = 1.01;

/** So lange muss man weg gewesen sein (Tab/App gewechselt), damit „sichtbar“/„Fokus“ als Rückkehr zählt. */
export const MIN_AWAY_MS = 1000;

/**
 * Ist das eine Rückkehr in die App? pageshow aus dem Zwischenspeicher immer; wieder sichtbar
 * bzw. Fokus nur nach mindestens 1 s weg (nicht z. B. nach einem kurzen Dialog in der App).
 * awayMs: wie lange die Seite verdeckt bzw. ohne Fokus war (null = nicht weg).
 */
export function isReturn(event: ReturnEvent, awayMs: number | null = null) {
  if (event.type === "pageshow") return event.persisted;
  const away = awayMs != null && awayMs >= MIN_AWAY_MS;
  if (event.type === "visibilitychange") return event.visibility === "visible" && away;
  return event.type === "focus" && away;
}

/** Zurücksetzen nur bei einer Rückkehr und nur, wenn hineingezoomt ist (scale > 1). */
export function shouldResetZoom(event: ReturnEvent, scale: number | null | undefined, awayMs: number | null = null) {
  return isReturn(event, awayMs) && typeof scale === "number" && Number.isFinite(scale) && scale > ZOOM_TOLERANCE;
}

/**
 * Viewport kurz auf „nicht zoombar“ setzen – Safari springt dabei auf Zoomstufe 1 – und danach
 * den bisherigen Inhalt wiederherstellen (Zwei-Finger-Zoom geht wieder).
 */
export function lockedViewport(content: string) {
  const parts = content
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !/^(initial-scale|minimum-scale|maximum-scale|user-scalable)\s*=/i.test(p));
  return [...parts, "initial-scale=1", "minimum-scale=1", "maximum-scale=1", "user-scalable=no"].join(", ");
}

// ——— Auch beim normalen Laden, verzögert und mit mehreren Methoden ———
// Safari lädt die Seite beim Wiederöffnen oft neu (pageshow ohne persisted) und stellt den Zoom
// erst danach wieder her. Darum nach dem Laden bzw. der Rückkehr mehrmals prüfen und in diesem
// Zeitfenster auch auf visualViewport-„resize“ reagieren; danach nicht mehr eingreifen.

/** Prüfzeitpunkte nach dem Laden bzw. der Rückkehr (ms). */
export const CHECK_DELAYS_MS = [0, 300, 1000, 2500] as const;
/** So lange nach dem Laden bzw. der Rückkehr reagiert der Rücksetzer auch auf „resize“. */
export const WATCH_MS = 3000;

/** Wie die Seite kam: neu geladen, aus dem Zwischenspeicher, Rückkehr (Tab/App), zurück/vor. */
export type LoadKind = "neu" | "neu geladen" | "zurück/vor" | "Zwischenspeicher" | "Rückkehr";

/** Art des Ladens aus performance.navigation (type) bzw. pageshow.persisted. */
export function loadKind(navigationType: string | null | undefined, persisted = false): LoadKind {
  if (persisted) return "Zwischenspeicher";
  if (navigationType === "reload") return "neu geladen";
  if (navigationType === "back_forward") return "zurück/vor";
  return "neu";
}

/** Noch im Zeitfenster nach dem Laden bzw. der Rückkehr? (sonst: Zwei-Finger-Zoom nicht stören) */
export const inWatchWindow = (now: number, since: number | null) => since != null && now - since >= 0 && now - since <= WATCH_MS;

/** Hineingezoomt? */
export const zoomedIn = (scale: number | null | undefined) => typeof scale === "number" && Number.isFinite(scale) && scale > ZOOM_TOLERANCE;

/** Methoden, der Reihe nach: Meta umstellen, Meta neu einfügen, nur minimum-/maximum-scale=1. */
export const RESET_METHODS = ["Meta umstellen", "Meta neu einfügen", "min/max-scale=1"] as const;
export type ResetMethod = (typeof RESET_METHODS)[number];

/** Nächste noch nicht versuchte Methode (null = alle versucht). */
export function nextMethod(tried: readonly string[]): ResetMethod | null {
  return RESET_METHODS.find((m) => !tried.includes(m)) ?? null;
}

/** Viewport für „min/max-scale=1“ (ohne user-scalable=no). */
export function minMaxViewport(content: string) {
  const parts = content
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !/^(initial-scale|minimum-scale|maximum-scale|user-scalable)\s*=/i.test(p));
  return [...parts, "initial-scale=1", "minimum-scale=1", "maximum-scale=1"].join(", ");
}

/** Ergebnis eines Versuchs, gemessen an visualViewport.scale danach. */
export function resetOutcome(before: number, after: number | null | undefined): "zurückgesetzt" | "teilweise" | "ohne Wirkung" | "unbekannt" {
  if (typeof after !== "number" || !Number.isFinite(after)) return "unbekannt";
  if (!zoomedIn(after)) return "zurückgesetzt";
  return after < before - 0.01 ? "teilweise" : "ohne Wirkung";
}

/** Diagnose an? ?zoomdebug=1 schaltet ein, ?zoomdebug=0 aus; sonst gilt die gespeicherte Einstellung. */
export function debugEnabled(search: string, stored: string | null) {
  const flag = new URLSearchParams(search).get("zoomdebug");
  if (flag === "1") return true;
  if (flag === "0") return false;
  return stored === "1";
}
