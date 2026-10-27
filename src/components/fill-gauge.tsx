export function FillGauge({ percent, size = "sm" }: { percent: number | null; size?: "sm" | "lg" }) {
  const value = percent == null ? null : Math.max(0, Math.min(100, percent));
  return (
    <div
      className={`gauge gauge-${size}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      aria-label="Füllstand"
    >
      <div className="gauge-bottle">
        <div className="gauge-fill" style={{ height: `${value ?? 0}%` }} />
      </div>
      <span className="gauge-label">{value == null ? "–" : `${value} %`}</span>
    </div>
  );
}
