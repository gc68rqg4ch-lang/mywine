"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { RESEND_SECONDS } from "@/lib/login/code-limits";
import { requestCodeAction, sendMagicLink, verifyCodeAction, type LoginState } from "./actions";

/**
 * Anmelden: E-Mail eingeben, dann „Code per Telegram“ (Hauptweg – Antoine schickt 6 Ziffern) oder
 * „Link per E-Mail“ (Ersatz). Ohne LOGIN_CODE_SECRET gibt es nur den Link.
 */
export function LoginForm({ next, codeEnabled = false }: { next: string; codeEnabled?: boolean }) {
  const [linkState, linkAction, linkPending] = useActionState<LoginState, FormData>(sendMagicLink, undefined);
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(0);
  const [pending, startTransition] = useTransition();

  // „Neuen Code senden“ frühestens nach 60 s.
  useEffect(() => {
    if (step !== "code") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step]);
  const wait = Math.max(0, RESEND_SECONDS - Math.floor((now - sentAt) / 1000));

  const requestCode = () =>
    startTransition(async () => {
      setError(null);
      const result = await requestCodeAction(email);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message);
      setStep("code");
      setSentAt(Date.now());
      setNow(Date.now());
    });

  const verify = () =>
    startTransition(async () => {
      setError(null);
      const result = await verifyCodeAction(email, code, next);
      // Erfolg leitet weiter; sonst Meldung, die Eingabe bleibt.
      if (result?.error) setError(result.error);
    });

  if (linkState?.sentTo) {
    return (
      <div className="notice notice-ok" role="status">
        <p>
          Wir haben einen Login-Link an <strong>{linkState.sentTo}</strong> geschickt.
        </p>
        <p className="muted">Öffne ihn im selben Browser, um dich anzumelden.</p>
      </div>
    );
  }

  if (step === "code") {
    return (
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          verify();
        }}
      >
        {message && (
          <p className="notice notice-ok" role="status">
            {message}
          </p>
        )}
        <label className="field">
          <span>Code aus Telegram</span>
          <input
            type="text"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            required
            autoFocus
            className="login-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Prüfe …" : "Anmelden"}
        </button>
        <div className="row row-between">
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending || wait > 0} onClick={requestCode}>
            {wait > 0 ? `Neuen Code senden (in ${wait} s)` : "Neuen Code senden"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
            }}
          >
            Andere E-Mail
          </button>
        </div>
      </form>
    );
  }

  return (
    <form action={linkAction} className="stack">
      <input type="hidden" name="next" value={next} />
      <label className="field">
        <span>E-Mail</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          placeholder="du@example.ch"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {(error ?? linkState?.error) && (
        <p className="notice notice-error" role="alert">
          {error ?? linkState?.error}
        </p>
      )}
      {codeEnabled && (
        <button type="button" className="btn btn-primary" disabled={pending || linkPending || !email.trim()} onClick={requestCode}>
          {pending ? "Wird gesendet …" : "Code per Telegram"}
        </button>
      )}
      <button type="submit" className={codeEnabled ? "btn" : "btn btn-primary"} disabled={pending || linkPending}>
        {linkPending ? "Wird gesendet …" : codeEnabled ? "Link per E-Mail" : "Login-Link senden"}
      </button>
    </form>
  );
}
