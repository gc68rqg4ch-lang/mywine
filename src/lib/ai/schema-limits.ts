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
