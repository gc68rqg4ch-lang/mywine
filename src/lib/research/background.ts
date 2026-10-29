import "server-only";

// Automatische Recherchen nach dem Einbuchen bzw. Erfassen (Geschmacksprofil, Trinkfenster,
// Spirituose, Haltbarkeit): nach der Antwort im Hintergrund, mit Wein im Verbrauchsprotokoll.
// Ist das Monatsbudget der API erreicht, fallen sie aus (nur ein Log-Eintrag) – Erkennung, Chat
// und Tagestext laufen weiter; nachholen lässt sich alles über 🔎 bzw. den Sammellauf.

import { budgetExceeded } from "@/lib/ai/budget";
import { withUsage } from "@/lib/ai/usage";
import { later } from "@/lib/later";
import type { AdminClient } from "@/lib/supabase/admin";

export function backgroundResearch(wineId: string, label: string, task: (db: AdminClient) => Promise<unknown>) {
  later(async () => {
    // Admin-Client erst beim Ausführen laden (Umgebungsvariablen werden dort geprüft).
    const db = (await import("@/lib/supabase/admin")).createAdminClient();
    if (await budgetExceeded(db)) {
      console.warn("api budget reached, skipped", label, wineId);
      return;
    }
    await withUsage({ wineId }, () => task(db));
  });
}
