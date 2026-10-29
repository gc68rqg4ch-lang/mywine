"use client";

import { useActionState } from "react";
import { refreshAntoinePhoto } from "../home-actions";

/** „Antoines Foto neu holen“ (sonst wöchentlich automatisch). */
export function AvatarRefresh() {
  const [state, action, pending] = useActionState(refreshAntoinePhoto, undefined);
  return (
    <form action={action} className="stack-sm">
      <div>
        <button type="submit" className="btn btn-sm" disabled={pending}>
          {pending ? "Hole Foto …" : "Antoines Foto neu holen"}
        </button>
      </div>
      {!pending && state?.error && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
      {!pending && state?.ok && (
        <p className="notice notice-ok" role="status">
          {state.ok}
        </p>
      )}
    </form>
  );
}
