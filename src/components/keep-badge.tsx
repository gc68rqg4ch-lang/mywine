import type { KeepStatus } from "@/lib/fortified/keep";

/**
 * Likörwein offen: „offen gut bis 25.11.“ und – farbig wie die Trinkreife – „bald trinken“
 * bzw. „3 Tage über der Zeit“. compact (Startseiten-Kachel): „gut bis 25.11.“ bzw. nur der Hinweis.
 */
export function KeepBadge({ status, compact = false }: { status: KeepStatus | null; compact?: boolean }) {
  if (!status) return null;
  const hint = status.hint && <span className={`drink-badge drink-${status.status === "overdue" ? "overdue" : "now"}`}>{status.hint}</span>;
  if (compact) return <span title={status.text}>{hint ?? <span className="muted">{status.text.replace(/^offen /, "")}</span>}</span>;
  return (
    <span className="keep-badge">
      {status.text}
      {hint && <> · {hint}</>}
    </span>
  );
}
