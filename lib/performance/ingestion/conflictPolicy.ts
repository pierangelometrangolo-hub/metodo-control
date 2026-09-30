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
  // Scope soggiorno dell'evento (migration 20260930130000). null/assente =
  // scope non noto: regola storica (confronto sull'intera chiave).
  stayDateStart?: string | null;
  stayDateEnd?: string | null;
};

// Intervallo di soggiorno coperto da un import (min/max stay_date del
// payload, YYYY-MM-DD).
export type StayScope = { start: string; end: string };

export type ImportDecision =
  | { action: "commit" }
  | { action: "skip_duplicate"; reason: "exact_duplicate" | "semantic_duplicate" }
  | { action: "conflict"; conflictingEventId: string; reason: "content_conflict" | "scope_overlap" };

export function stayScopeOf(rows: { stayDate: string }[]): StayScope | null {
  if (rows.length === 0) return null;
  let start = rows[0].stayDate;
  let end = rows[0].stayDate;
  for (const r of rows) {
    if (r.stayDate < start) start = r.stayDate;
    if (r.stayDate > end) end = r.stayDate;
  }
  return { start, end };
}

function eventScope(e: PriorImportedEvent): StayScope | null {
  return e.stayDateStart && e.stayDateEnd ? { start: e.stayDateStart, end: e.stayDateEnd } : null;
}

function sameScope(a: StayScope, b: StayScope): boolean {
  return a.start === b.start && a.end === b.end;
}

// Stessa selezione della RPC (migration 20260930130000): fra gli eventi
// 'imported' della chiave structure_id + extraction_date + dataset (in
// ordine created_at desc), quelli che si SOVRAPPONGONO allo scope del
// candidato - un evento senza scope si sovrappone a tutto - con priorita'
// a quello con lo STESSO scope. candidateScope null = dataset non scoped
// (adr_revpar, nationality): l'evento piu' recente, come prima.
export function selectPriorImportedEvent(
  eventsNewestFirst: PriorImportedEvent[],
  candidateScope: StayScope | null
): PriorImportedEvent | null {
  if (!candidateScope) return eventsNewestFirst[0] ?? null;
  const overlapping = eventsNewestFirst.filter((e) => {
    const scope = eventScope(e);
    return scope === null || (scope.start <= candidateScope.end && scope.end >= candidateScope.start);
  });
  const exact = overlapping.find((e) => {
    const scope = eventScope(e);
    return scope !== null && sameScope(scope, candidateScope);
  });
  return exact ?? overlapping[0] ?? null;
}

// Righe legacy (pre-Foundation) presenti sulla chiave, nessun evento
// 'imported': duplicato solo se il normalized_content_hash ricostruito
// dalle righe legacy (stessa funzione di normalization.ts) coincide con
// quello del nuovo import; altrimenti conflitto, come prima.
export type LegacyDecision = { action: "skip_duplicate"; reason: "legacy_equivalent" } | { action: "conflict" };

export function decideLegacyAction(legacyContentHash: string, candidateContentHash: string): LegacyDecision {
  return legacyContentHash === candidateContentHash
    ? { action: "skip_duplicate", reason: "legacy_equivalent" }
    : { action: "conflict" };
}

// priorImportedEvent = l'evento 'imported' scelto da selectPriorImportedEvent
// per la chiave (structure_id, extraction_date, dataset[, scope]) - null se non esiste
// ancora nessun import completato per quella chiave, indipendentemente da
// QUANDO è stato scritto (stessa sessione o una precedente: la funzione
// non fa alcuna distinzione, il chiamante è responsabile di recuperare
// l'evento corretto).
//
// candidateScope (solo montecallini_pms): se l'evento trovato ha uno scope
// noto diverso da quello del candidato (sovrapposizione parziale) il
// confronto hash non ha senso -> conflitto scope_overlap. Evento senza
// scope o dataset non scoped: regola storica.
export function decideImportAction(
  priorImportedEvent: PriorImportedEvent | null,
  candidate: { sourceChecksum: string | null; normalizedContentHash: string | null },
  candidateScope: StayScope | null = null
): ImportDecision {
  if (!priorImportedEvent) return { action: "commit" };

  const priorScope = eventScope(priorImportedEvent);
  if (candidateScope && priorScope && !sameScope(priorScope, candidateScope)) {
    return { action: "conflict", conflictingEventId: priorImportedEvent.id, reason: "scope_overlap" };
  }

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
  return { action: "conflict", conflictingEventId: priorImportedEvent.id, reason: "content_conflict" };
}
