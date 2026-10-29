// Fehler-Teile von Supabase Auth aus der Adresse entfernen (rein, ohne DOM): Ein abgelaufener
// Magic Link führt auf „…/#error=access_denied&error_code=otp_expired&error_description=…&sb=“
// (bzw. als Query). Die Adresse bleibt sonst gern als Tab oder Lesezeichen stehen.

/** Teile, die Supabase Auth bei einem Fehler anhängt. */
const ERROR_KEYS = ["error", "error_code", "error_description"] as const;
/** Kommt zusammen mit dem Fehler im Hash (leer) – nur dann mit entfernen. */
const COMPANION_KEYS = ["sb"] as const;

const strip = (params: URLSearchParams) => {
  const code = params.get("error_code") ?? params.get("error");
  if (!ERROR_KEYS.some((k) => params.has(k))) return null;
  for (const k of [...ERROR_KEYS, ...COMPANION_KEYS]) params.delete(k);
  return code ?? "error";
};

/**
 * Adresse säubern: Fehler-Teile aus Hash und Query entfernen, Pfad und übrige Parameter (z. B. q)
 * bleiben. Liefert die neue Adresse (Pfad + Query + Hash) und den Fehlercode bzw. null, wenn es
 * nichts zu entfernen gab (dann ist url die unveränderte Adresse).
 */
export function cleanAuthErrorUrl(href: string): { url: string; error: string | null } {
  const u = new URL(href, "http://x");
  const query = new URLSearchParams(u.search);
  const hash = new URLSearchParams(u.hash.replace(/^#/, ""));
  const fromQuery = strip(query);
  const fromHash = u.hash.includes("=") ? strip(hash) : null;
  const error = fromHash ?? fromQuery;
  const original = `${u.pathname}${u.search}${u.hash}`;
  if (!error) return { url: original, error: null };
  const search = query.toString();
  const rest = fromHash ? hash.toString() : u.hash.replace(/^#/, "");
  return { url: `${u.pathname}${search ? `?${search}` : ""}${rest ? `#${rest}` : ""}`, error };
}

/** Hinweis auf der Login-Seite (nicht angemeldet). */
export const EXPIRED_LINK_TEXT = "Der Login-Link ist abgelaufen – bitte neuen Link anfordern.";
/** Übergabe an die Login-Seite, falls die Adresse schon gesäubert ist (für den Tab). */
export const AUTH_ERROR_KEY = "mywine:auth-link-error";
