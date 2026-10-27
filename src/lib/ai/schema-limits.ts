// Grenzen der Claude API für Schemas (strukturierte Ausgabe und strict-Tools).
// Die API lehnt Schemas mit mehr als 16 Parametern mit Union-Typen ab
// („type“ als Liste oder anyOf, z. B. durch .nullable()).

export const MAX_UNION_PARAMS = 16;

/** Zählt alle Stellen im JSON-Schema mit anyOf/oneOf oder einer Typ-Liste. */
export function countUnionParams(schema: unknown): number {
  if (Array.isArray(schema)) return schema.reduce((sum: number, s) => sum + countUnionParams(s), 0);
  if (!schema || typeof schema !== "object") return 0;
  const node = schema as Record<string, unknown>;
  const own = Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.type) ? 1 : 0;
  return own + Object.values(node).reduce((sum: number, v) => sum + countUnionParams(v), 0);
}

/**
 * JSON-Schema-Schlüsselwörter, die die API bei strict (strict-Tools und strukturierte
 * Ausgabe) nicht annimmt – laut Doku „Structured outputs → JSON Schema limitations“:
 * Zahlen- und Text-Grenzen sowie Array-Grenzen ausser minItems 0/1.
 */
export const STRICT_UNSUPPORTED_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
] as const;

/** Erlaubte Werte für format bei strict. */
export const STRICT_FORMATS = ["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"];

/** Regex-Teile, die strict nicht unterstützt: Rückverweise, Lookaround, Wortgrenzen. */
const UNSUPPORTED_REGEX = /\\[1-9]|\(\?[=!]|\(\?<[=!]|\\[bB]/;

/**
 * Alle Stellen eines Schemas, die bei strict einen 400-Fehler auslösen, z. B.
 * „.properties.year.minimum“. Leere Liste = in Ordnung.
 */
export function strictSchemaProblems(schema: unknown, path = ""): string[] {
  if (Array.isArray(schema)) return schema.flatMap((s, i) => strictSchemaProblems(s, `${path}[${i}]`));
  if (!schema || typeof schema !== "object") return [];
  const node = schema as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of STRICT_UNSUPPORTED_KEYWORDS) if (key in node) problems.push(`${path}.${key}`);
  if (typeof node.minItems === "number" && node.minItems > 1) problems.push(`${path}.minItems=${node.minItems}`);
  if (typeof node.format === "string" && !STRICT_FORMATS.includes(node.format)) problems.push(`${path}.format=${node.format}`);
  if (typeof node.pattern === "string" && UNSUPPORTED_REGEX.test(node.pattern)) problems.push(`${path}.pattern`);
  if (node.type === "object" && node.additionalProperties !== false) problems.push(`${path}.additionalProperties`);
  for (const [key, value] of Object.entries(node)) {
    if (!value || typeof value !== "object") continue;
    if (key === "properties" || key === "$defs" || key === "definitions") {
      // Feldnamen sind keine Schlüsselwörter – nur die Schemas darunter prüfen.
      for (const [name, sub] of Object.entries(value)) problems.push(...strictSchemaProblems(sub, `${path}.${key}.${name}`));
    } else {
      problems.push(...strictSchemaProblems(value, `${path}.${key}`));
    }
  }
  return problems;
}
