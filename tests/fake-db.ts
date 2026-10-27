// Kleiner Supabase-Ersatz im Speicher für Tests, die den Client direkt übergeben (Menüs, Details,
// Verkostung): Tabellen als Arrays, Filter eq/is/in/gt/lt/gte, order, limit, insert/update/upsert, rpc.
type Row = Record<string, unknown>;

/** Tabellen, die PostgREST als einzelnes Objekt einbettet (1:1 über die eigene ID). */
const ONE_TO_ONE = new Set(["open_bottle_details"]);

/**
 * Eingebettete Beziehungen wie in PostgREST: „wine:wines(name)“ über wine_id (n:1, Objekt),
 * sonst rückwärts über eine *_id-Spalte, die auf die Zeile zeigt (1:1 Objekt, 1:n Liste).
 */
function embed(tables: Record<string, Row[]>, rows: Row[], cols: string | null) {
  const relations = [...(cols ?? "").matchAll(/(\w+):(\w+)\(/g)].map((m) => ({ alias: m[1], table: m[2] }));
  if (!relations.length) return rows;
  return rows.map((row) => {
    const out = { ...row };
    for (const { alias, table } of relations) {
      const target = tables[table] ?? [];
      const fk = row[`${alias}_id`];
      if (fk !== undefined) {
        out[alias] = target.find((t) => t.id === fk) ?? null;
      } else {
        const linked = target.filter((t) => Object.entries(t).some(([k, v]) => k.endsWith("_id") && v === row.id));
        out[alias] = ONE_TO_ONE.has(table) ? (linked[0] ?? null) : linked;
      }
    }
    return out;
  });
}
export function fakeDb(tables: Record<string, Row[]>, rpc: Record<string, (args: Row) => unknown> = {}) {
  const writes: { table: string; op: string; values?: unknown; filters: string[] }[] = [];
  function builder(table: string) {
    let rows = [...(tables[table] ?? [])];
    let op = "select";
    let values: unknown;
    const filters: string[] = [];
    let single = false;
    let selectCols: string | null = null;
    const b: Record<string, unknown> = {
      select(cols?: string) { selectCols = cols ?? "*"; return b; },
      eq(c: string, v: unknown) { filters.push(`${c}=${v}`); rows = rows.filter((r) => r[c] === v); return b; },
      is(c: string, v: unknown) { filters.push(`${c} is ${v}`); rows = rows.filter((r) => (r[c] ?? null) === v); return b; },
      in(c: string, v: unknown[]) { rows = rows.filter((r) => v.includes(r[c])); return b; },
      gt(c: string, v: number) { rows = rows.filter((r) => (r[c] as number) > v); return b; },
      lt(c: string, v: number) { rows = rows.filter((r) => (r[c] as number) < v); return b; },
      gte(c: string, v: unknown) { rows = rows.filter((r) => (r[c] as string) >= (v as string)); return b; },
      ilike() { return b; },
      or() { return b; },
      order(c: string, o?: { ascending?: boolean }) {
        const dir = o?.ascending === false ? -1 : 1;
        rows.sort((a, z) => (String(a[c] ?? "") < String(z[c] ?? "") ? -dir : String(a[c] ?? "") > String(z[c] ?? "") ? dir : 0));
        return b;
      },
      limit(n: number) { rows = rows.slice(0, n); return b; },
      range(a: number, z: number) { rows = rows.slice(a, z + 1); return b; },
      maybeSingle() { single = true; return b; },
      single() { single = true; return b; },
      update(v: unknown) { op = "update"; values = v; return b; },
      upsert(v: unknown) { op = "upsert"; values = v; return b; },
      insert(v: unknown) { op = "insert"; values = v; return b; },
      delete() { op = "delete"; return b; },
      then(resolve: (x: unknown) => void, reject: (e: unknown) => void) {
        try {
          if (op !== "select") {
            writes.push({ table, op, values, filters });
            if (op === "insert") {
              const inserted = [values as Row].flat().map((v) => ({ id: v.id ?? `id-${Math.random().toString(16).slice(2)}`, ...v }));
              (tables[table] ?? (tables[table] = [])).push(...inserted);
              rows = inserted;
            }
            if (op === "update") for (const r of rows) Object.assign(r, values as Row);
            if (op === "upsert") {
              const v = values as Row;
              const t = tables[table] ?? (tables[table] = []);
              const ex = t.find((r) => r.inventory_item_id === v.inventory_item_id);
              if (ex) Object.assign(ex, v); else t.push({ ...v });
              // cellar_overview mitführen
              for (const r of tables.cellar_overview ?? []) if (r.inventory_item_id === v.inventory_item_id && "fill_level_percent" in v) r.fill_level_percent = v.fill_level_percent;
            }
            if (op === "update" && table === "inventory_items") for (const r of tables.cellar_overview ?? []) for (const x of rows) if (r.inventory_item_id === x.id) Object.assign(r, values as Row);
            resolve({ data: selectCols != null || op === "update" ? (single ? rows[0] ?? null : rows) : null, error: null });
            return;
          }
          const result = embed(tables, rows, selectCols);
          resolve({ data: single ? result[0] ?? null : result, error: null });
        } catch (e) { reject(e); }
      },
    };
    return b;
  }
  return {
    writes,
    from: (t: string) => builder(t),
    rpc: async (name: string, args: Row) => ({ data: rpc[name]?.(args) ?? null, error: null }),
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}` })), error: null }),
      }),
    },
  };
}
