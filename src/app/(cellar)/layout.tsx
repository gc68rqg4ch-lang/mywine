import Link from "next/link";
import { signOut } from "@/app/actions";
import { NavLinks } from "@/components/nav-links";
import { getSession } from "@/lib/auth";

export default async function CellarLayout({ children }: LayoutProps<"/">) {
  const { supabase, isMember, email, userId } = await getSession();

  if (!isMember) {
    return (
      <main className="login">
        <div className="card login-card stack">
          <h1 className="brand">MyWine</h1>
          <p>
            Du bist als <strong>{email ?? "unbekannt"}</strong> angemeldet, hast aber noch keinen
            Zugriff auf diesen Weinkeller.
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

  const { count: openCount } = await supabase
    .from("inventory_items")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <Link href="/" className="brand">
            MyWine
          </Link>
          <NavLinks openCount={openCount ?? 0} />
          <form action={signOut}>
            <button type="submit" className="btn btn-ghost btn-sm" title={email ?? undefined}>
              Abmelden
            </button>
          </form>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
