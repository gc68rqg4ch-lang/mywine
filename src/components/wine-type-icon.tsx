import { wineTypeLabel, type WineType } from "@/lib/format";

// Einheitlich gezeichnete Trauben-Symbole je Weintyp (24×24-Raster).
// Eine Traube = sechs Beeren (3-2-1), Stiel und Blatt. Jede Beere hat eine dunklere
// Kontur und einen Glanzpunkt, damit sie auf hellem und dunklem Grund lesbar bleibt.

type Palette = { fill: [string, string]; stroke: string };

const PALETTES: Record<"red" | "white" | "amber" | "orange" | "unknown", Palette> = {
  red: { fill: ["#7a2246", "#9b3159"], stroke: "#3b0d20" },
  white: { fill: ["#c8d36b", "#b3c252"], stroke: "#6f7d26" },
  amber: { fill: ["#dc9a2e", "#c47f1f"], stroke: "#83500d" },
  orange: { fill: ["#ea8b3c", "#d5722a"], stroke: "#934611" },
  unknown: { fill: ["#b9afaa", "#a39893"], stroke: "#776e6a" },
};

const BERRIES: [number, number][] = [
  [7.2, 9],
  [12, 9],
  [16.8, 9],
  [9.6, 13.4],
  [14.4, 13.4],
  [12, 17.8],
];

function Cluster({ palette, transform }: { palette: Palette; transform?: string }) {
  return (
    <g transform={transform}>
      <path d="M12 6.6C12 5 12.6 3.7 14 2.7" fill="none" stroke="#7a5332" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M12.9 4.4c1.6-1.8 4.4-1.9 5.7-.7-1.3 1.6-4 1.9-5.7.7Z" fill="#5f8f3a" />
      {BERRIES.map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r="2.55" fill={palette.fill[i % 2]} stroke={palette.stroke} strokeWidth="0.6" />
          <circle cx={cx - 0.8} cy={cy - 0.9} r="0.7" fill="#fff" opacity="0.45" />
        </g>
      ))}
    </g>
  );
}

function paletteFor(type: WineType | null | undefined) {
  switch (type) {
    case "red":
      return PALETTES.red;
    case "white":
    case "sparkling":
      return PALETTES.white;
    case "sweet":
    case "fortified":
      return PALETTES.amber;
    case "orange":
      return PALETTES.orange;
    default:
      return PALETTES.unknown;
  }
}

export function WineTypeIcon({
  type,
  size = 22,
  withLabel = false,
}: {
  type: WineType | null | undefined;
  size?: number;
  withLabel?: boolean;
}) {
  const label = wineTypeLabel(type ?? null);
  let content;
  if (type === "rose") {
    // Rosé: je eine rote und eine weisse Traube.
    content = (
      <>
        <Cluster palette={PALETTES.red} transform="translate(-2 2.4) scale(0.7)" />
        <Cluster palette={PALETTES.white} transform="translate(8.6 2.4) scale(0.7)" />
      </>
    );
  } else if (type === "sparkling") {
    // Schaumwein: weisse Traube mit kleinen Perlen.
    content = (
      <>
        <Cluster palette={PALETTES.white} transform="translate(-1.2 2.6) scale(0.86)" />
        <g fill="none" stroke="#6fa7c4" strokeWidth="0.8">
          <circle cx="20.2" cy="8.2" r="1.35" />
          <circle cx="21.6" cy="4.3" r="0.95" />
          <circle cx="18.4" cy="3.6" r="0.7" />
        </g>
      </>
    );
  } else {
    content = <Cluster palette={paletteFor(type)} />;
  }

  return (
    <span className="type">
      <svg
        className="type-icon"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        role="img"
        aria-label={label}
      >
        {content}
      </svg>
      {withLabel && label}
    </span>
  );
}
