import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { signOut } from "@/app/actions";
import { LocationSwitcher } from "@/components/location-switcher";
import { NavLinks } from "@/components/nav-links";
import { getMemberSession } from "@/lib/auth";
import { getLocationFilter, withLocation } from "@/lib/location";

export default async function CellarLayout({ children }: LayoutProps<"/">) {
  const [{ supabase, email, person }, location] = await Promise.all([getMemberSession(), getLocationFilter()]);
  const { count: openCount } = await withLocation(
    // Offene Flaschen ohne Spirituosen (die haben nur eine aktuelle Flasche im Bestand).
    supabase.from("cellar_overview").select("inventory_item_id", { count: "exact", head: true }).eq("status", "open").or("type.is.null,type.neq.spirit"),
    location.filter,
  );

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <Link href="/" className="brand">
            <BrandLogo />
            <span className="brand-name">MyWine</span>
          </Link>
          <NavLinks openCount={openCount ?? 0} />
          <LocationSwitcher
            options={location.options.map(({ key, label }) => ({ key, label }))}
            selected={location.selected?.key ?? null}
          />
          {person && (
            <span className="whoami" title={email ?? undefined}>
              {person.name}
            </span>
          )}
          <form action={signOut} className="signout">
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
