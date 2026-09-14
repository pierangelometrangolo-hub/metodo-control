// ============ Categorizzazione esiti import per la UI ============
//
// Logica pura (nessun I/O, nessuna dipendenza React) estratta da
// app/(control)/performance/import/page.tsx per poterla testare in
// isolamento - stesso principio gia' in uso per
// lib/performanceImportRouting.ts. La UI resta l'unico posto che decide
// COME mostrare ogni categoria (colori, testo); qui vive solo il mapping
// status -> categoria, l'unica parte con un requisito di correttezza
// verificabile a priori: validation_error non deve MAI finire sotto la
// stessa categoria di routing_error/parse_error, ne' un warning sotto
// quella di un errore (bug UX gia' corretto una volta, STEP 2 - vedi
// handleSubmitHistorical).
import type { IngestionOutcome } from "./types";

// routing_error/parse_error restano fusi in "error": un file/struttura
// sbagliati o un'eccezione imprevista, mai il CONTENUTO del file. Da STEP 3
// validation_error ha una categoria propria e visivamente diversa: il file
// era quello giusto, ma il contenuto non ha passato i controlli di
// qualita' (parser su una vera riga-dato, o un guardrail bloccante) - zero
// scritture comunque, ma un problema diverso da "file sbagliato".
export type OutcomeCategory = "imported" | "duplicate" | "conflict" | "error" | "validationError" | "warning";

export function categorizeOutcome(status: IngestionOutcome["status"]): OutcomeCategory {
  if (status === "imported") return "imported";
  if (status === "skipped_duplicate") return "duplicate";
  if (status === "conflict") return "conflict";
  if (status === "validation_error") return "validationError";
  return "error"; // routing_error | parse_error
}

export const OUTCOME_CATEGORY_LABEL: Record<OutcomeCategory, string> = {
  imported: "Importato",
  duplicate: "Duplicato già acquisito",
  conflict: "Conflitto",
  error: "Errore parsing/routing",
  validationError: "Errore validazione",
  warning: "Avviso",
};
