import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Anmelden" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) redirect(next);

  return (
    <main className="login">
      <div className="card login-card">
        <h1 className="brand">MyWine</h1>
        <p className="muted">Deine persönliche Weinsammlung. Melde dich per Magic Link an.</p>
        {params.fehler && (
          <p className="notice notice-error" role="alert">
            Der Login-Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.
          </p>
        )}
        <LoginForm next={next} />
      </div>
    </main>
  );
}
