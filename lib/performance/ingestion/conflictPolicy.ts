// Regola di decisione duplicato/conflitto, in TypeScript puro.
//
// NOTA IMPORTANTE su dove vive davvero l'autorità a runtime: l'unica
// implementazione che decide realmente cosa viene scritto in produzione è
// la funzione SQL fn_commit_performance_import (migration
// 20260908113200_fn_commit_performance_import.sql), perché lì il
// controllo e la scrittura avvengono nella STESSA transazione Postgres,
// eliminando qualunque finestra di race fra "controllo" e "scrittura" che
// un controllo lato client non potrebbe mai escludere. Questo file è una
// implementazione PARALLELA e deliberatamente separata della stessa
// identica regola, scritta per essere testabile senza un database reale:
// questo ambiente di sviluppo non può eseguire le migration direttamente
// (nessun accesso SQL diretto, per policy di progetto - le migration
// vengono consegnate per l'esecuzione manuale). Se la regola qui cambia,
// la funzione SQL va aggiornata di conseguenza a mano, e viceversa: non
// sono la stessa funzione, sono due specifiche della stessa policy.
export type PriorImportedEvent = {
  id: string;
  sourceChecksum: string | null;
  normalizedContentHash: string | null;
};

export type ImportDecision =
  | { action: "commit" }
  | { action: "skip_duplicate"; reason: "exact_duplicate" | "semantic_duplicate" }
  | { action: "conflict"; conflictingEventId: string };

// priorImportedEvent = l'ultimo evento con status='imported' per la stessa
// chiave (structure_id, extraction_date, dataset) - null se non esiste
// ancora nessun import completato per quella chiave, indipendentemente da
// QUANDO è stato scritto (stessa sessione o una precedente: la funzione
// non fa alcuna distinzione, il chiamante è responsabile di recuperare
// l'evento corretto).
export function decideImportAction(
  priorImportedEvent: PriorImportedEvent | null,
  candidate: { sourceChecksum: string | null; normalizedContentHash: string | null }
): ImportDecision {
  if (!priorImportedEvent) return { action: "commit" };

  if (
    priorImportedEvent.sourceChecksum !== null &&
    candidate.sourceChecksum !== null &&
    priorImportedEvent.sourceChecksum === candidate.sourceChecksum
  ) {
    return { action: "skip_duplicate", reason: "exact_duplicate" };
  }

  if (
    priorImportedEvent.normalizedContentHash !== null &&
    candidate.normalizedContentHash !== null &&
    priorImportedEvent.normalizedContentHash === candidate.normalizedContentHash
  ) {
    return { action: "skip_duplicate", reason: "semantic_duplicate" };
  }

  // Stessa struttura+data+dataset, contenuto diverso: MAI un overwrite,
  // MAI "vince l'ultimo file" - conflitto bloccante.
  return { action: "conflict", conflictingEventId: priorImportedEvent.id };
}
