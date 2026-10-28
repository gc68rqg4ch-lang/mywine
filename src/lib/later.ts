import "server-only";

import { after } from "next/server";

// Arbeit nach der Antwort (Websuche, Speichern nach einem Knopf). In einer Anfrage über
// after(); ausserhalb (Tests, Skripte) wird sie gesammelt und mit runLater() ausgeführt.

const queued: (() => Promise<unknown>)[] = [];

export function later(task: () => Promise<unknown>) {
  try {
    after(task);
  } catch {
    queued.push(task);
  }
}

/** Gesammelte Arbeit ausführen (ausserhalb einer Anfrage). */
export async function runLater() {
  while (queued.length) await queued.shift()!();
}
