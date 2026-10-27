// Netz-Stub für Integrationstests (kein echter Netzverkehr).
// Netz-Stub für Integrationstests: Telegram, Claude API und eine kleine PostgREST-Nachbildung.
type Row = Record<string, unknown>;
export type Net = {
  tables: Record<string, Row[]>;
  telegram: { method: string; body: Record<string, unknown> }[];
  claude: (body: Record<string, unknown>) => Record<string, unknown>;
  rpc: Record<string, (args: Row) => unknown>;
};
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(data === undefined ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

function field(row: Row, col: string) {
  const m = col.match(/^(\w+)->>(\w+)$/);
  if (m) return ((row[m[1]] ?? {}) as Row)[m[2]] == null ? null : String(((row[m[1]] ?? {}) as Row)[m[2]]);
  return row[col];
}
function matches(row: Row, col: string, expr: string): boolean {
  if (col === "or") return true;
  const [op, ...rest] = expr.split(".");
  const raw = rest.join(".");
  const v = field(row, col);
  const unq = (s: string) => s.replace(/^"|"$/g, "");
  switch (op) {
    case "eq": return String(v) === raw;
    case "neq": return String(v) !== raw;
    case "is": return raw === "null" ? v == null : String(v) === raw;
    case "gt": return v != null && String(v) > raw;
    case "lt": return v != null && String(v) < raw;
    case "in": return raw.replace(/^\(|\)$/g, "").split(",").map(unq).includes(String(v));
    case "ilike": {
      const pattern = raw.replace(/\\([\\%_])/g, "$1");
      return typeof v === "string" && v.toLowerCase() === pattern.toLowerCase();
    }
    default: throw new Error(`stub: Operator ${op}`);
  }
}
let seq = 0;
export function installNet(net: Net) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.host === "api.telegram.org") {
      net.telegram.push({ method: url.pathname.split("/").pop()!, body: body ?? {} });
      return json({ ok: true, result: { message_id: 100 + net.telegram.length } });
    }
    if (url.host === "api.anthropic.com") return json(net.claude(body));
    const m = url.pathname.match(/\/rest\/v1\/(rpc\/)?(\w+)$/);
    if (!m) throw new Error(`stub: ${url}`);
    if (m[1]) return json(net.rpc[m[2]]?.(body) ?? null);
    const table = (net.tables[m[2]] ??= []);
    const filters = [...url.searchParams].filter(([k]) => !["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k));
    let rows = table.filter((r) => filters.every(([k, v]) => matches(r, k, v)));
    const single = (headers.get("accept") ?? "").includes("vnd.pgrst.object");
    const wantsRows = (headers.get("prefer") ?? "").includes("return=representation") || method === "GET";
    if (method === "POST") {
      const inserted = [body].flat().map((r: Row) => ({ id: `id-${++seq}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r }));
      table.push(...inserted);
      rows = inserted;
    } else if (method === "PATCH") {
      for (const r of rows) Object.assign(r, body, { updated_at: new Date().toISOString() });
    }
    if (method === "HEAD" || (headers.get("prefer") ?? "").includes("count=exact")) {
      return new Response(null, { status: 200, headers: { "content-range": `0-0/${rows.length}` } });
    }
    const order = url.searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(",")[0].split(".");
      rows = [...rows].sort((a, b) => (String(a[col] ?? "") < String(b[col] ?? "") ? -1 : 1) * (dir === "desc" ? -1 : 1));
    }
    const limit = url.searchParams.get("limit");
    if (limit) rows = rows.slice(0, Number(limit));
    if (!wantsRows) return new Response(null, { status: 204 });
    if (single) return rows.length ? json(rows[0]) : json({ code: "PGRST116", message: "no rows" }, 406);
    return json(rows);
  }) as typeof fetch;
}

/** Antwort der Messages API mit Text (strukturierte Ausgabe) bzw. einem Tool-Aufruf. */
export const claudeText = (obj: unknown) => ({
  id: "msg", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null,
  content: [{ type: "text", text: JSON.stringify(obj) }], usage: { input_tokens: 1, output_tokens: 1 },
});
export const claudeTool = (name: string, input: unknown) => ({
  id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "tool_use", stop_sequence: null,
  content: [{ type: "tool_use", id: "tu", name, input }], usage: { input_tokens: 1, output_tokens: 1 },
});
