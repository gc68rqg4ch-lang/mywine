"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ openCount }: { openCount: number }) {
  const pathname = usePathname();
  const links = [
    { href: "/", label: "Bestand", active: pathname === "/" },
    {
      href: "/offen",
      label: "Offen",
      badge: openCount,
      active: pathname.startsWith("/offen"),
    },
    { href: "/getrunken", label: "Getrunken", active: pathname.startsWith("/getrunken") },
  ];

  return (
    <nav className="nav" aria-label="Hauptnavigation">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={link.active ? "nav-link active" : "nav-link"}
          aria-current={link.active ? "page" : undefined}
        >
          {link.label}
          {link.badge ? <span className="badge">{link.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
