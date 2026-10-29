// Automatisch speichern (rein, ohne React und DB): nach einer kurzen Tipp-Pause und beim
// Verlassen des Felds. Gespeichert wird nur, was sich gegenüber dem zuletzt Gespeicherten
// geändert hat (verglichen in der gespeicherten Form, z. B. getrimmt). Ein Fehler lässt den Text
// stehen; der nächste Anlass (Tippen, Verlassen, „nochmals versuchen“) versucht es wieder.

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

export type AutosaveOptions = {
  /** Speichert den Text; liefert die gespeicherte Form (z. B. getrimmt) oder wirft. */
  save: (text: string) => Promise<string | null>;
  /** Vergleichsform (wie gespeichert würde) – unverändert → kein Aufruf. */
  normalize: (text: string) => string | null;
  initial: string | null;
  delayMs?: number;
  onStatus?: (status: AutosaveStatus) => void;
};

export function createAutosave(o: AutosaveOptions) {
  const delay = o.delayMs ?? 1000;
  let saved = o.normalize(o.initial ?? "");
  let latest = o.initial ?? "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  let status: AutosaveStatus = "idle";
  const set = (s: AutosaveStatus) => {
    status = s;
    o.onStatus?.(s);
  };
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  async function run(): Promise<void> {
    if (running) {
      // Läuft schon: danach mit dem neusten Text nochmals.
      again = true;
      return running;
    }
    const text = latest;
    if (o.normalize(text) === saved) {
      if (status === "saving") set("saved");
      return;
    }
    set("saving");
    running = (async () => {
      try {
        saved = await o.save(text);
        set(o.normalize(latest) === saved ? "saved" : "saving");
      } catch {
        set("error");
        again = false;
      } finally {
        running = null;
      }
    })();
    await running;
    if (again) {
      again = false;
      await run();
    }
  }

  return {
    /** Beim Tippen: Speichern nach der Pause. */
    change(text: string) {
      latest = text;
      clear();
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delay);
    },
    /** Beim Verlassen des Felds bzw. der Seite: sofort speichern. */
    flush() {
      clear();
      return run();
    },
    /** Noch nicht gespeichert (Pause läuft, Speichern läuft oder fehlgeschlagen)? */
    dirty() {
      return timer != null || running != null || o.normalize(latest) !== saved;
    },
    status: () => status,
  };
}
