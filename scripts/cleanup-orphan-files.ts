// Verwaiste Dateien in Storage auflisten bzw. löschen (wine-photos, wine-documents).
// Standard ist ein Trockenlauf (listet nur); gelöscht wird nur mit --apply.
//   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SECRET_KEY=… npx tsx scripts/cleanup-orphan-files.ts [--apply]
// Der Secret Key umgeht RLS – nur lokal bzw. vertrauenswürdig ausführen.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types";
import { cleanupOrphanFiles } from "../src/lib/media/orphans";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL und SUPABASE_SECRET_KEY setzen.");
  const apply = process.argv.includes("--apply");
  const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { orphans, deleted } = await cleanupOrphanFiles(db, { apply });
  for (const f of orphans) console.log(`${f.bucket}/${f.path}\t${f.createdAt ?? "?"}\t${f.size ?? "?"} B`);
  console.log(
    apply
      ? `${deleted} von ${orphans.length} Dateien ohne Verweis gelöscht.`
      : `${orphans.length} Dateien ohne Verweis (Trockenlauf – nichts gelöscht; mit --apply löschen).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
