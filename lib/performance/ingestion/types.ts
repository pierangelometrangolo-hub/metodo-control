// Tipi condivisi del servizio import Performance (upload manuale attuale +
// futura automazione Google Drive, non implementata in questa fase - vedi
// commento in importService.ts). Nessuna dipendenza da React/Supabase qui
// dentro: solo forme dati, cosi' restano testabili senza mock pesanti.

// Stesso set di 3 dataset gia' deciso per performance_import_events.dataset
// (vedi migration) - MAI il formato file (xls/csv/pms), quello e' un
// dettaglio del parsing, non dell'identita' del dataset.
export type Dataset = "adr_revpar" | "nationality" | "montecallini_pms";

// Oggi solo "manual_upload" e' realmente usato - "google_drive" e' gia'
// nel dominio del tipo perche' la Fase 1 costruisce la foundation comune,
// ma nessun codice qui la produce ancora.
export type ImportSource = "manual_upload" | "google_drive";

export type ImportEventStatus =
  | "imported"
  | "skipped_duplicate"
  | "conflict"
  | "routing_error"
  | "parse_error"
  | "validation_error";

export type StructureOption = {
  id: string;
  name: string;
};

// Alias PMS/BD -> struttura DB, cosi' come caricato da structure_source_aliases.
export type StructureAlias = {
  structureId: string;
  source: string;
  alias: string;
};

// Righe minime comuni ai due dataset "a snapshot giornaliero" (ADR/RevPAR e
// Montecallini) - stessa forma di ImportableRow gia' in uso in
// lib/performanceImportRouting.ts, ripetuta qui per non creare una
// dipendenza circolare fra i due moduli (performanceImportRouting resta
// import-free rispetto a lib/performance/ingestion).
export type NormalizedSnapshotRow = {
  stayDate: string;
  revenueTotal: number;
  roomsSold: number;
  roomsAvailable: number;
  arrivals: number | null;
  presences: number;
  // Indice nell'array sourceFiles passato al servizio - per Montecallini
  // (batch multi-file) indica da QUALE file e' arrivata questa riga, cosi'
  // fn_commit_performance_import puo' collegare correttamente ogni riga
  // al proprio bd_imports (un file = un bd_imports, invariato). Per i
  // dataset a file singolo e' sempre 0.
  sourceIndex: number;
};

export type NormalizedNationalityRow = {
  stayDate: string;
  nationality: string;
  presences: number;
  sourceIndex: number;
};

export type SourceFileInput = {
  fileName: string;
  // Contenuto grezzo del file cosi' come letto - usato per calcolare
  // source_checksum (SHA-256 dei byte esatti). Per un file di testo (CSV)
  // e' l'ArrayBuffer della codifica UTF-8 del testo letto, non la stringa:
  // lo stesso identico contenuto testuale deve produrre lo stesso hash
  // indipendentemente da come e' stato letto.
  content: ArrayBuffer;
};

// Esito della risoluzione struttura (booking_designer via alias DB,
// montecallini_pms via nome esatto "Montecallini") - vedi routing.ts.
export type StructureResolution =
  | { kind: "resolved"; structureId: string; structureName: string }
  | { kind: "not_found" }
  | { kind: "ambiguous"; candidateStructureIds: string[] };

export type IngestionOutcome =
  | { status: "imported"; importedCount: number; eventId: string; bdImportIds: string[] }
  | { status: "skipped_duplicate"; reason: "exact_duplicate" | "semantic_duplicate"; eventId: string }
  | { status: "conflict"; eventId: string; conflictingEventId: string | null }
  | { status: "routing_error"; message: string }
  | { status: "parse_error"; message: string }
  | { status: "validation_error"; message: string };
