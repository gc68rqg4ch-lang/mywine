import "server-only";

// Chat-Werkzeuge für offene Erfassungen dieses Chats (ingest_jobs mit status received,
// processing oder needs_review): anzeigen und weglassen (→ discarded). Weglassen ohne
// Ja/Nein-Rückfrage – es geht nichts verloren.

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { subjectText } from "@/lib/bot/texts";
import type { AdminClient } from "@/lib/supabase/admin";
import { cancelFlow, flowSubject, isSavedTasted, openFlows } from "./pending";

const minutesAgo = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));

/** Offene Erfassungen als Zeilen für Claude: id, worum es geht, seit wann. */
export async function openEntryLines(db: AdminClient, chatId: number) {
  const flows = await openFlows(db, chatId);
  return flows.map((j) => ({
    entry_id: j.id,
    what: subjectText(flowSubject(j)).replace(/^den angefangenen |^die angefangene |^das /, ""),
    waiting_for_answer: j.status === "needs_review",
    already_saved: isSavedTasted(j),
    last_activity_minutes_ago: minutesAgo(j.updated_at),
  }));
}

export function flowTools(db: AdminClient, chatId: number | null) {
  return [
    betaZodTool({
      name: "list_open_entries",
      description:
        "Zeigt die offenen, noch nicht gespeicherten Erfassungen dieses Chats (angefangene Käufe, neue Weine, Verkostet, WSET, Fotos zuordnen, Vorschläge mit Ja/Nein). Immer aufrufen, bevor du sagst, dass etwas offen, vorgemerkt oder noch nicht fertig ist – und bei „lösch das“, „vergiss den“, „brauchen wir nicht“.",
      inputSchema: z.object({}),
      run: async () => {
        if (chatId == null) return "Keine offenen Erfassungen.";
        const lines = await openEntryLines(db, chatId);
        if (!lines.length) return "Keine offenen Erfassungen – gerade ist nichts angefangen. Behaupte nicht, dass etwas vorgemerkt sei.";
        return JSON.stringify(lines);
      },
    }),
    betaZodTool({
      name: "cancel_open_entry",
      description:
        "Lässt eine offene Erfassung weg (nichts wird gespeichert, nichts geht verloren) – ohne Rückfrage. entry_id aus list_open_entries; ohne entry_id nur, wenn genau eine offen ist. Danach kurz bestätigen, z. B. „Gut, den Pintia lasse ich weg.“",
      inputSchema: z.object({ entry_id: z.uuid().optional() }),
      run: async ({ entry_id }) => {
        if (chatId == null) return "Keine offenen Erfassungen.";
        let id = entry_id;
        if (!id) {
          const lines = await openEntryLines(db, chatId);
          if (!lines.length) return "Keine offenen Erfassungen – es gibt nichts wegzulassen. Ist ein gespeicherter Wein gemeint, frag nach oder schlag das Löschen mit propose_* vor.";
          if (lines.length > 1) return `Mehrere offen – frag kurz, welche gemeint ist: ${JSON.stringify(lines)}`;
          id = lines[0].entry_id;
        }
        const result = await cancelFlow(db, chatId, id);
        if (result.status === "gone") return "Diese Erfassung ist nicht mehr offen (schon erledigt oder abgelaufen). Prüfe list_open_entries.";
        if (result.status === "saved") {
          return `Das war schon gespeichert (${subjectText(result.subject)}); nur die freiwilligen Ergänzungen fallen weg. Soll der gespeicherte Verkostet-Eintrag weg, schlag propose_delete_encounter vor.`;
        }
        return `Weggelassen: ${subjectText(result.subject)}. Nichts gespeichert. Bestätige kurz in einem Satz, z. B. „Gut, den Pintia lasse ich weg.“`;
      },
    }),
  ];
}
