import "server-only";

// Testlauf (research_jobs, Auftragsart „label_check“, params { ingest_job_id, dry_run: true }):
// Erkennung, Abgleich, Recherche (Herstellerseite vom Etikett zuerst) und Prüfschritt der Namen
// mit den gespeicherten Fotos einer früheren Erfassung – ohne etwas zu speichern oder zu senden.
// Das Ergebnis steht in research_jobs.result.diagnostics.

import type { AdminClient } from "@/lib/supabase/admin";
import type { ResearchOutcome } from "@/lib/research/wine";
import { photoProposal } from "./flow";
import { loadLabelImages } from "./images";
import { recognizeLabel } from "./recognize";
import type { IngestState } from "./schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function runLabelCheck(db: AdminClient, ingestJobId: string | undefined): Promise<ResearchOutcome> {
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 1000);
  if (!ingestJobId || !UUID_RE.test(ingestJobId)) return { status: "nothing", filled: [], suggested: 0, seconds: 0 };
  const { data: job, error } = await db.from("ingest_jobs").select("id, photo_paths, extracted").eq("id", ingestJobId).maybeSingle();
  if (error) throw error;
  if (!job?.photo_paths?.length) return { status: "nothing", filled: [], suggested: 0, seconds: seconds(), diagnostics: { error: "Erfassung ohne Fotos" } };

  const images = await loadLabelImages(db, job.photo_paths);
  const recognition = await recognizeLabel(images);
  const caption = (job.extracted as IngestState | null)?.caption ?? null;
  const { state, known, check, decision, described } = await photoProposal(db, recognition, caption, { images });
  return {
    status: "nothing",
    filled: [],
    suggested: 0,
    seconds: seconds(),
    diagnostics: {
      dry_run: true,
      ingest_job_id: ingestJobId,
      recognition: {
        model: recognition.model,
        name: recognition.proposal.name,
        producer: recognition.proposal.producer,
        type: recognition.proposal.type,
        color: recognition.color ?? null,
        label_note: recognition.labelNote ?? null,
        producer_urls: recognition.producerUrls ?? [],
        confidence: recognition.confidence,
      },
      proposal: {
        name: state.proposal.name,
        producer: state.proposal.producer,
        vintage_year: state.proposal.vintage_year,
        type: state.proposal.type,
        grapes: state.proposal.grape_shares,
        known_wine_id: known?.id ?? null,
      },
      sources: state.recognition.sources,
      described,
      check,
      decision,
    },
  };
}
