// Datum und Zeit in Europe/Zurich (rein): Monats-/Jahresgrenzen, Wochentag, Jahreszeit.

const TZ = "Europe/Zurich";

export type ZurichParts = { year: number; month: number; day: number; hour: number; weekday: number; date: string };

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

/** Teile eines Zeitpunkts in Zürich (weekday: 0 = Sonntag). */
export function zurichParts(at: Date | number | string): ZurichParts {
  const d = new Date(at);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { year, month, day, hour: Number(parts.hour), weekday, date: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Tag in Zürich als „YYYY-MM-DD“ (null bleibt null). */
export const zurichDay = (at: string | null | undefined) => (at ? (/^\d{4}-\d{2}-\d{2}$/.test(at) ? at : zurichParts(at).date) : null);

/** Liegt der Zeitpunkt (bzw. Tag) im selben Monat bzw. Jahr wie now – in Zürich? */
export function sameZurichMonth(at: string | null | undefined, now: Date | number) {
  const d = zurichDay(at);
  return d != null && d.slice(0, 7) === zurichParts(now).date.slice(0, 7);
}
export function sameZurichYear(at: string | null | undefined, year: number) {
  const d = zurichDay(at);
  return d != null && Number(d.slice(0, 4)) === year;
}

export type Season = "Frühling" | "Sommer" | "Herbst" | "Winter";
export const season = (month: number): Season => (month >= 3 && month <= 5 ? "Frühling" : month >= 6 && month <= 8 ? "Sommer" : month >= 9 && month <= 11 ? "Herbst" : "Winter");

export const weekdayName = (weekday: number) => WEEKDAYS[weekday] ?? "";

/** Tage zurück (YYYY-MM-DD, Kalender). */
export function daysBefore(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Jetzt (ms) – für Server-Seiten, die pro Anfrage einmal die Zeit brauchen. */
export const currentTime = () => Date.now();
