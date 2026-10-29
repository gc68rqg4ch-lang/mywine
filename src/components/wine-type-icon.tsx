import { asWineType, wineTypeLabel, type WineType } from "@/lib/format";

// Einheitlich gezeichnete Trauben-Symbole je Weintyp (24×24-Raster); Spirituosen: ein Glas.
// Eine Traube = sechs Beeren (3-2-1), Stiel und Blatt. Jede Beere hat eine dunklere
// Kontur und einen Glanzpunkt, damit sie auf hellem und dunklem Grund lesbar bleibt.

type Palette = { fill: [string, string]; stroke: string };

const PALETTES: Record<"red" | "white" | "amber" | "dark" | "unknown", Palette> = {
  red: { fill: ["#7a2246", "#9b3159"], stroke: "#3b0d20" },
  white: { fill: ["#c8d36b", "#b3c252"], stroke: "#6f7d26" },
  amber: { fill: ["#dc9a2e", "#c47f1f"], stroke: "#83500d" },
  dark: { fill: ["#4a1730", "#5e1f3c"], stroke: "#22060f" },
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

function paletteFor(type: WineType | null) {
  switch (type) {
    case "red":
      return PALETTES.red;
    case "white":
    case "sparkling":
      return PALETTES.white;
    case "sweet":
      return PALETTES.amber;
    case "fortified":
      return PALETTES.dark;
    default:
      return PALETTES.unknown;
  }
}

export function WineTypeIcon({
  type,
  size = 22,
  withLabel = false,
}: {
  /** Typ aus der DB (Unbekanntes → neutrale Traube). */
  type: string | null | undefined;
  size?: number;
  withLabel?: boolean;
}) {
  const t = asWineType(type);
  const label = wineTypeLabel(t);
  let content;
  if (t === "rose") {
    // Rosé: je eine rote und eine weisse Traube.
    content = (
      <>
        <Cluster palette={PALETTES.red} transform="translate(-2 2.4) scale(0.7)" />
        <Cluster palette={PALETTES.white} transform="translate(8.6 2.4) scale(0.7)" />
      </>
    );
  } else if (t === "sparkling") {
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
  } else if (t === "sweet") {
    // Süsswein: goldene Traube mit Honigtropfen.
    content = (
      <>
        <Cluster palette={PALETTES.amber} transform="translate(-1.2 2.6) scale(0.86)" />
        <path
          d="M20 3.2c1.4 2 2.2 3.3 2.2 4.4a2.2 2.2 0 0 1-4.4 0c0-1.1.8-2.4 2.2-4.4Z"
          fill="#e8a922"
          stroke="#9a6608"
          strokeWidth="0.6"
        />
        <circle cx="19.4" cy="7.3" r="0.55" fill="#fff" opacity="0.6" />
      </>
    );
  } else if (t === "fortified") {
    // Likörwein: dunkle Traube mit kleinem Dessertglas.
    content = (
      <>
        <Cluster palette={PALETTES.dark} transform="translate(-1.6 2.6) scale(0.86)" />
        <g stroke="#5b3a1e" strokeWidth="0.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.6 3.4h4.2l-.5 3a1.6 1.6 0 0 1-3.2 0Z" fill="#8a2d1f" />
          <path d="M19.7 8v2.6M18.4 10.6h2.6" fill="none" />
        </g>
      </>
    );
  } else if (t === "spirit") {
    // Spirituose: Tumbler mit bernsteinfarbenem Inhalt (statt Traube).
    content = (
      <g strokeLinejoin="round">
        <path d="M5.4 6.2h13.2l-1.3 12.6a2 2 0 0 1-2 1.8H8.7a2 2 0 0 1-2-1.8Z" fill="#f4efe9" stroke="#776e6a" strokeWidth="0.9" />
        <path d="M6.3 11.6h11.4l-.8 7.1a1.4 1.4 0 0 1-1.4 1.2H8.5a1.4 1.4 0 0 1-1.4-1.2Z" fill="#c47f1f" stroke="#83500d" strokeWidth="0.6" />
        <path d="M8.1 13.2h3.2" stroke="#f2c46d" strokeWidth="0.9" strokeLinecap="round" />
        <rect x="12.6" y="8.6" width="3.4" height="3.4" rx="0.7" fill="#dff1f8" stroke="#6fa7c4" strokeWidth="0.6" opacity="0.9" />
      </g>
    );
  } else {
    content = <Cluster palette={paletteFor(t)} />;
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
