"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { lastListUrl, markRestore } from "@/components/cellar/list-memory";

/**
 * „← Bestand“ (bzw. Offen, Getrunken, Verkostet): zurück genau dorthin, wo man in der Liste
 * war – gleiche URL (Gruppierung, Filter, offene Gruppen) und Scroll-Position. Auch die
 * Browser-Zurück-Taste stellt die Position wieder her.
 */
export function BackLink({ base, label }: { base: string; label: string }) {
  const [href, setHref] = useState(base);
  useEffect(() => {
    const last = lastListUrl(base);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- erst im Browser bekannt (sessionStorage)
    if (last) setHref(last);
    const onPop = () => markRestore();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [base]);
  return (
    <Link href={href} className="back" onClick={markRestore}>
      ← {label}
    </Link>
  );
}
