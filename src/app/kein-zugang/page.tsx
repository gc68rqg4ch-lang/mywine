import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Kein Zugang" };

/** Angemeldet, aber nicht in app_members: klare Meldung statt einer leeren Seite. */
export default async function NoAccessPage() {
  const { isMember, email, userId } = await getSession(); // ohne Login → /login
  if (isMember) redirect("/");

  return (
    <main className="login">
      <div className="card login-card stack">
        <h1 className="brand">MyWine</h1>
        <h2 className="section-title">Kein Zugang</h2>
        <p>
          Du bist als <strong>{email ?? "unbekannt"}</strong> angemeldet, bist aber nicht für diesen Weinkeller
          freigeschaltet.
        </p>
        <p className="muted">
          Eine berechtigte Person muss deine User-ID in <code>app_members</code> eintragen:
        </p>
        <code className="code-block">{userId}</code>
        <form action={signOut}>
          <button type="submit" className="btn">
            Abmelden
          </button>
        </form>
      </div>
    </main>
  );
}
