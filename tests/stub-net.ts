// Netz-Stub für Integrationstests (kein echter Netzverkehr): Telegram, Claude API und eine
// kleine Nachbildung von PostgREST und Supabase Storage.
type Row = Record<string, unknown>;
export type Net = {
  tables: Record<string, Row[]>;
  telegram: { method: string; body: Record<string, unknown> }[];
  claude: (body: Record<string, unknown>) => Record<string, unknown>;
  rpc: Record<string, (args: Row) => unknown>;
  /** Fehler einspielen: liefert für eine Anfrage an PostgREST eine Fehlerantwort statt sie auszuführen. */
  fail?: (method: string, table: string, body: unknown) => { status: number; body: unknown } | null;
  /** Supabase Storage: „bucket/pfad“ → Inhalt. Optional. */
  storage?: Map<string, { bytes: Uint8Array; type: string }>;
  /** Telegram-Dateien zum Herunterladen: file_id → Inhalt. Optional (Standard: kleines PDF). */
  files?: Map<string, Uint8Array>;
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
    case "gte": return v != null && String(v) >= raw;
    case "lte": return v != null && String(v) <= raw;
    case "in": return raw.replace(/^\(|\)$/g, "").split(",").map(unq).includes(String(v));
    case "ilike": {
      const pattern = raw.replace(/\\([\\%_])/g, "$1");
      return typeof v === "string" && v.toLowerCase() === pattern.toLowerCase();
    }
    default: throw new Error(`stub: Operator ${op}`);
  }
}
/** Tabellen, die PostgREST als einzelnes Objekt einbettet (1:1 über die eigene ID). */
const ONE_TO_ONE = new Set(["open_bottle_details"]);

/** Eingebettete Beziehungen im select wie „place:places(name)“: über place_id (n:1), sonst rückwärts. */
function embed(tables: Record<string, Row[]>, rows: Row[], select: string | null) {
  const relations = [...(select ?? "").matchAll(/(\w+):(\w+)\(/g)].map((m) => ({ alias: m[1], table: m[2] }));
  if (!relations.length) return rows;
  return rows.map((row) => {
    const out = { ...row };
    for (const { alias, table } of relations) {
      const target = tables[table] ?? [];
      const fk = row[`${alias}_id`];
      if (fk !== undefined) out[alias] = target.find((t) => t.id === fk) ?? null;
      else {
        const linked = target.filter((t) => Object.entries(t).some(([k, v]) => k.endsWith("_id") && v === row.id));
        out[alias] = ONE_TO_ONE.has(table) ? (linked[0] ?? null) : linked;
      }
    }
    return out;
  });
}

let seq = 0;
export function installNet(net: Net) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    if (url.pathname.startsWith("/storage/v1/")) return storage(net, url, method, headers, init?.body);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.host === "api.telegram.org") {
      // Dateien: getFile → file_path, Download unter /file/bot…/<file_path> (net.files, sonst ein kleines PDF)
      if (url.pathname.startsWith("/file/bot")) {
        const fileId = url.pathname.split("/").pop()!.replace(/\.\w+$/, "");
        const bytes = net.files?.get(fileId) ?? new TextEncoder().encode("%PDF-1.4 test");
        return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), { status: 200 });
      }
      if (url.pathname.endsWith("/getFile")) {
        return json({ ok: true, result: { file_id: body?.file_id, file_path: `documents/${body?.file_id}.pdf` } });
      }
      net.telegram.push({ method: url.pathname.split("/").pop()!, body: body ?? {} });
      return json({ ok: true, result: { message_id: 100 + net.telegram.length } });
    }
    if (url.host === "api.anthropic.com") {
      // Fehlerantwort der API: { status, body } mit einem HTTP-Status ≠ 200
      const answer = net.claude(body);
      return typeof answer.status === "number" && answer.body ? json(answer.body, answer.status) : json(answer);
    }
    const m = url.pathname.match(/\/rest\/v1\/(rpc\/)?(\w+)$/);
    if (!m) throw new Error(`stub: ${url}`);
    if (m[1]) return json(net.rpc[m[2]]?.(body) ?? null);
    const failure = net.fail?.(method, m[2], body);
    if (failure) return json(failure.body, failure.status);
    const table = (net.tables[m[2]] ??= []);
    const filters = [...url.searchParams].filter(([k]) => !["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k));
    let rows = table.filter((r) => filters.every(([k, v]) => matches(r, k, v)));
    const single = (headers.get("accept") ?? "").includes("vnd.pgrst.object");
    const wantsRows = (headers.get("prefer") ?? "").includes("return=representation") || method === "GET";
    if (method === "POST") {
      // Upsert (on_conflict): vorhandene Zeile mit gleichen Schlüsselwerten ignorieren bzw. ergänzen.
      const conflict = url.searchParams.get("on_conflict")?.split(",");
      const prefer = headers.get("prefer") ?? "";
      const same = (r: Row) => (conflict ? table.find((t) => conflict.every((c) => t[c] === r[c])) : undefined);
      const fresh: Row[] = [];
      const touched: Row[] = [];
      for (const r of [body].flat() as Row[]) {
        const existing = same(r);
        if (existing && prefer.includes("ignore-duplicates")) continue;
        if (existing && prefer.includes("merge-duplicates")) {
          Object.assign(existing, r, { updated_at: new Date().toISOString() });
          touched.push(existing);
          continue;
        }
        fresh.push({ id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r });
      }
      table.push(...fresh);
      rows = [...touched, ...fresh];
    } else if (method === "PATCH") {
      for (const r of rows) Object.assign(r, body, { updated_at: new Date().toISOString() });
    } else if (method === "DELETE") {
      net.tables[m[2]] = table.filter((r) => !rows.includes(r));
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
    rows = embed(net.tables, rows, url.searchParams.get("select"));
    if (single) return rows.length ? json(rows[0]) : json({ code: "PGRST116", message: "no rows" }, 406);
    return json(rows);
  }) as typeof fetch;
}

/** Kleine Nachbildung der Storage-API: hochladen, herunterladen, auflisten, löschen, signieren. */
async function storage(net: Net, url: URL, method: string, headers: Headers, body: unknown) {
  const files = (net.storage ??= new Map());
  const path = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\/object\//, ""));
  const asJson = () => JSON.parse(String(body));
  if (method === "POST" && path.startsWith("list/")) {
    const bucket = path.slice(5);
    const prefix = `${bucket}/${asJson().prefix}/`;
    return json([...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ name: k.slice(prefix.length), id: k })));
  }
  if (method === "POST" && path.startsWith("sign/")) {
    const bucket = path.slice(5);
    return json(asJson().paths.map((p: string) => ({ path: p, signedURL: `/object/sign/${bucket}/${p}?token=t`, error: files.has(`${bucket}/${p}`) ? null : "not found" })));
  }
  if (method === "DELETE") {
    const removed = asJson().prefixes.filter((p: string) => files.delete(`${path}/${p}`));
    return json(removed.map((name: string) => ({ name })));
  }
  const key = path.replace(/^authenticated\//, "");
  if (method === "POST" || method === "PUT") {
    if (files.has(key) && headers.get("x-upsert") !== "true") return json({ statusCode: "409", error: "Duplicate", message: "exists" }, 400);
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
    files.set(key, { bytes, type: headers.get("content-type") ?? "application/octet-stream" });
    return json({ Key: key, Id: key });
  }
  if (method === "GET") {
    const file = files.get(key);
    return file ? new Response(file.bytes, { headers: { "content-type": file.type } }) : json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400);
  }
  throw new Error(`stub storage: ${method} ${url}`);
}

/** Antwort der Messages API mit Text (strukturierte Ausgabe) bzw. einem Tool-Aufruf. */
export const claudeText = (obj: unknown) => ({
  id: "msg", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null,
  content: [{ type: "text", text: JSON.stringify(obj) }], usage: { input_tokens: 1, output_tokens: 1 },
});
/** Fehlerantwort der Messages API (z. B. Nutzungslimit: 400 invalid_request_error). */
export const claudeError = (status: number, message: string) => ({
  status,
  body: { type: "error", error: { type: status === 400 ? "invalid_request_error" : "api_error", message } },
});
export const claudeTool = (name: string, input: unknown) => ({
  id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "tool_use", stop_sequence: null,
  content: [{ type: "tool_use", id: "tu", name, input }], usage: { input_tokens: 1, output_tokens: 1 },
});
