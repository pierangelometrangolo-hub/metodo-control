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

// Testo di dettaglio per ogni esito, derivato dallo status/motivo REALE
// restituito dal servizio (mai un testo unico per tutti i conflitti).
export function describeOutcome(outcome: IngestionOutcome): string {
  switch (outcome.status) {
    case "imported":
      return `${outcome.importedCount} righe importate`;
    case "skipped_duplicate":
      if (outcome.reason === "legacy_equivalent") {
        return "Duplicato già acquisito: contenuto identico a uno snapshot legacy già presente.";
      }
      return outcome.reason === "exact_duplicate"
        ? "Duplicato esatto (stesso file già importato) - nessuna scrittura."
        : "Duplicato semantico (stesso contenuto già importato con un file diverso) - nessuna scrittura.";
    case "conflict":
      return outcome.conflictKind === "legacy"
        ? "Conflitto con snapshot legacy: il contenuto già presente è diverso dal file caricato. Nessuna scrittura."
        : "Conflitto: esiste già un import completato per questa struttura/data con contenuto diverso. Nessuna scrittura.";
    case "routing_error":
    case "parse_error":
    case "validation_error":
      return outcome.message;
  }
}

export const OUTCOME_CATEGORY_LABEL: Record<OutcomeCategory, string> = {
  imported: "Importato",
  duplicate: "Duplicato già acquisito",
  conflict: "Conflitto",
  error: "Errore parsing/routing",
  validationError: "Errore validazione",
  warning: "Avviso",
};
