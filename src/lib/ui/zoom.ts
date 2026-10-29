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
