"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { navScrollLeft } from "@/lib/ui/nav-scroll";

export function NavLinks({ openCount }: { openCount: number }) {
  const pathname = usePathname();
  const links = [
    { href: "/bestand", label: "Bestand", active: pathname.startsWith("/bestand") },
    {
      href: "/offen",
      label: "Offen",
      badge: openCount,
      active: pathname.startsWith("/offen"),
    },
    { href: "/getrunken", label: "Getrunken", active: pathname.startsWith("/getrunken") },
    { href: "/verkostet", label: "Verkostet", active: pathname.startsWith("/verkostet") },
    { href: "/recherche", label: "🔎", long: "Recherche", active: pathname.startsWith("/recherche") },
  ];

  // Schmale Bildschirme: die Reiter sind wischbar – den aktiven sichtbar machen (nur die Reiterzeile
  // scrollen, nie die Seite).
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>(".nav-link.active");
    if (!nav || !active) return;
    nav.scrollLeft = navScrollLeft({ left: active.offsetLeft - nav.offsetLeft, width: active.offsetWidth }, { width: nav.clientWidth, scrollWidth: nav.scrollWidth });
  }, [pathname]);

  return (
    <nav className="nav" aria-label="Hauptnavigation" ref={navRef}>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={link.active ? "nav-link active" : "nav-link"}
          aria-current={link.active ? "page" : undefined}
          aria-label={"long" in link ? link.long : undefined}
        >
          {link.label}
          {"long" in link && <span className="nav-long">{link.long}</span>}
          {"badge" in link && link.badge ? <span className="badge">{link.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
