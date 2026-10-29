"use client";

import { useEffect, useState } from "react";
import { AUTH_ERROR_KEY, EXPIRED_LINK_TEXT, cleanAuthErrorUrl } from "@/lib/auth-url";

/** Fehler-Teil eines abgelaufenen Login-Links sofort aus der Adresse entfernen (ohne Neuladen; alle Seiten). */
export function AuthUrlCleanup() {
  useEffect(() => {
    const { url, error } = cleanAuthErrorUrl(window.location.href);
    if (!error) return;
    // Nur auf der Login-Seite (nicht angemeldet) für den Hinweis merken – Angemeldete sehen nie einen.
    if (window.location.pathname === "/login") {
      try {
        sessionStorage.setItem(AUTH_ERROR_KEY, error);
      } catch {
        // privat/gesperrt: dann ohne Hinweis
      }
    }
    window.history.replaceState(window.history.state, "", url);
  }, []);
  return null;
}

/** Login-Seite (nur nicht angemeldet): kurzer Hinweis, wenn man über einen abgelaufenen Link kam. */
export function ExpiredLinkNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let error = cleanAuthErrorUrl(window.location.href).error;
    try {
      error ??= sessionStorage.getItem(AUTH_ERROR_KEY);
      sessionStorage.removeItem(AUTH_ERROR_KEY);
    } catch {
      // privat/gesperrt
    }
    // Erst im Browser bekannt (der Hash geht nie an den Server).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (error) setShow(true);
  }, []);
  if (!show) return null;
  return (
    <p className="notice notice-error" role="alert">
      {EXPIRED_LINK_TEXT}
    </p>
  );
}
