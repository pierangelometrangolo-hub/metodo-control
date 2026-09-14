// ============ Performance Guardrails V0 — tipi ============
//
// Guardrails V0 shadow mode — no enforcement.
//
// Livello di controllo qualita' dato che gira DOPO la normalizzazione e
// PRIMA del calcolo hash / conflict / commit (lib/performance/ingestion/
// importService.ts). In questa fase e' puramente DIAGNOSTICO: le findings
// non alterano le righe, non bloccano l'import, non cambiano
// normalized_content_hash ne' il payload della RPC. Vengono solo
// restituite alla UI e al log.
//
// Il runner e' PURO: nessun I/O, nessuna dipendenza da React/Supabase,
// nessuna mutazione dell'input (stesso principio di conflictPolicy.ts).

import type { SourceKpiSnapshot } from "../../performanceImportRouting";

export type { SourceKpiSnapshot };

export type GuardrailDataset = "adr_revpar" | "nationality" | "montecallini_pms";

// blocking  -> in enforcement mode fermerebbe l'intero file / dataset-kind
//              (validation_error, zero righe scritte). In shadow mode e'
//              solo marcata come "anomalia bloccante candidata".
// warning   -> anomalia segnalata, l'import prosegue.
// info      -> diagnostica non bloccante.
export type GuardrailSeverity = "blocking" | "warning" | "info";

// file -> l'anomalia riguarda l'intero file/insieme di righe (es. chiave
//         duplicata): in enforcement mode bloccherebbe TUTTO, mai una riga.
// row  -> l'anomalia e' localizzata su una riga, ma NON esiste "escludi la
//         riga e importa il resto": una riga-dato con anomalia blocking
//         blocca comunque l'intero file (nessuno snapshot parziale).
export type GuardrailScope = "file" | "row";

export type GuardrailFinding = {
  // ID del guardrail (vedi registry.ts) - es. "GR-C01-QTY".
  id: string;
  dataset: GuardrailDataset;
  severity: GuardrailSeverity;
  scope: GuardrailScope;
  // Giorno di soggiorno interessato (null per le findings scope="file"
  // aggregate o quando non applicabile).
  stayDate: string | null;
  // Nazionalita' interessata (solo dataset "nationality", altrimenti null).
  nationality: string | null;
  // Messaggio gia' pronto per l'utente (italiano, nessun gergo tecnico
  // grezzo).
  message: string;
  // Dettaglio strutturato opzionale per il log/debug - MAI l'unico posto
  // dove vive un'informazione necessaria all'utente (quella sta in message).
  context?: Record<string, unknown>;
};

export type GuardrailResult = {
  findings: GuardrailFinding[];
  // true se almeno una finding ha severity "blocking". In shadow mode NON
  // viene usato per bloccare: e' calcolato da subito cosi' che lo STEP
  // successivo (enforcement) sia un cambiamento localizzato e visibile nei
  // test.
  hasBlockingFindings: boolean;
};

// Riga snapshot vista dai guardrail: i 6 campi normalizzati + i KPI
// sorgente opzionali. arrivals nullable (sempre null per Montecallini).
export type GuardrailSnapshotRow = {
  stayDate: string;
  revenueTotal: number;
  roomsSold: number;
  roomsAvailable: number;
  arrivals: number | null;
  presences: number;
  sourceKpi?: SourceKpiSnapshot;
};

export type GuardrailNationalityRow = {
  stayDate: string;
  nationality: string;
  presences: number;
};
