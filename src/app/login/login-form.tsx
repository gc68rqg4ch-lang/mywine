"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, undefined);

  if (state?.sentTo) {
    return (
      <div className="notice notice-ok" role="status">
        <p>
          Wir haben einen Login-Link an <strong>{state.sentTo}</strong> geschickt.
        </p>
        <p className="muted">Öffne ihn im selben Browser, um dich anzumelden.</p>
      </div>
    );
  }

  return (
    <form action={action} className="stack">
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
        />
      </label>
      {state?.error && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Wird gesendet …" : "Login-Link senden"}
      </button>
    </form>
  );
}
