import { wineTypeLabel, type WineType } from "@/lib/format";

export function TypeDot({ type, withLabel = false }: { type: WineType | null; withLabel?: boolean }) {
  return (
    <span className="type">
      <span className={`type-dot type-${type ?? "unknown"}`} aria-hidden />
      {withLabel ? wineTypeLabel(type) : <span className="sr-only">{wineTypeLabel(type)}</span>}
    </span>
  );
}
