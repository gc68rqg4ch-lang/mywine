// Einmalige Prüfung des Bestands (nur lesend): Produzenten- und Weinnamen (siehe
// src/lib/producers/audit.ts). Ändert nichts in der DB.
// Ausführen:
//   npx tsx --tsconfig tsconfig.json scripts/check-names.ts                 (liest wines per Supabase;
//     braucht NEXT_PUBLIC_SUPABASE_URL und SUPABASE_SECRET_KEY)
//   npx tsx --tsconfig tsconfig.json scripts/check-names.ts wines.json      (JSON: [{id,name,producer,type}])
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { auditText, nameAudit, type AuditWine } from "../src/lib/producers/audit";

async function loadWines(): Promise<AuditWine[]> {
  const file = process.argv[2];
  if (file) return JSON.parse(readFileSync(file, "utf8")) as AuditWine[];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL und SUPABASE_SECRET_KEY setzen oder eine JSON-Datei angeben.");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db.from("wines").select("id, name, producer, type").order("name");
  if (error) throw error;
  return data ?? [];
}

loadWines()
  .then((wines) => {
    console.log(`${wines.length} Weine geprüft.\n`);
    console.log(auditText(nameAudit(wines)));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
