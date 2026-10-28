"use client";

import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { setLocation } from "@/app/(cellar)/location-actions";

export function LocationSwitcher({
  options,
  selected,
}: {
  options: { key: string; label: string }[];
  selected: string | null;
}) {
  const [pending, startTransition] = useTransition();
  // „Verkostet“ hängt nicht am Lagerort – dort keine Wahl.
  const pathname = usePathname();
  if (options.length < 2 || pathname.startsWith("/verkostet")) return null;
  const all = [{ key: "", label: "Alle" }, ...options];

  return (
    <div className="segmented" role="group" aria-label="Lagerort" aria-busy={pending}>
      {all.map((o) => {
        const active = (selected ?? "") === o.key;
        return (
          <button
            key={o.key || "all"}
            type="button"
            className={active ? "segment active" : "segment"}
            aria-pressed={active}
            disabled={pending}
            onClick={() => startTransition(() => setLocation(o.key))}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
