import { GroupKind, ImportableRow, computeMontecalliniRowExtractionDate } from "../../performanceImportRouting";
import { NormalizedSnapshotRow } from "./types";

// Montecallini e' l'unico dataset dove N file compongono UN batch/snapshot
// (vedi commento nella migration performance_import_events): ogni
// PlanningForecast copre un mese, e i diversi mesi caricati insieme nella
// stessa sessione NON sono conflitti tra loro - vanno fusi per kind e
// extraction_date PRIMA di calcolare hash e chiamare il servizio, mai
// confrontati file contro file. L'extraction_date e' calcolata PER RIGA dal
// suo mese di soggiorno (computeMontecalliniRowExtractionDate): righe di
// mesi che producono date diverse (LY sempre, CY mese chiuso vs aperto)
// finiscono in gruppi distinti; SDLY e CY dei mesi aperti restano un solo
// gruppo.
export type MontecalliniFileInput = {
  fileName: string;
  filePath: string;
  sourceChecksum: string;
  groups: { kind: GroupKind; rows: ImportableRow[] }[];
};

export type MontecalliniBatch = {
  kind: GroupKind;
  // extraction_date comune a tutte le righe del gruppo.
  extractionDate: string;
  // sourceIndex di ogni riga e' un indice LOCALE in sourceFiles (sotto),
  // non nell'elenco originale di file caricati - solo i file che hanno
  // davvero contribuito righe a QUESTO gruppo (kind + extraction_date) vi
  // compaiono.
  rows: NormalizedSnapshotRow[];
  sourceFiles: { fileName: string; filePath: string }[];
  // Checksum dei soli file che contribuiscono a questo gruppo - usati per
  // calcolare batch_hash (vedi normalization.ts: computeBatchHash ordina
  // questo array PRIMA di unirlo, quindi il risultato e' indipendente
  // dall'ordine con cui i file sono stati selezionati/elaborati qui).
  sourceChecksums: string[];
};

// Non usa MAI i suffissi del filename (es. "PlanningForecast (4).csv")
// come segnale: raggruppa esclusivamente per `kind`, gia' classificato dal
// parser (lib/montecalliniPmsParser.ts) dal contenuto della riga
// (CY/SDLY/LY), indipendente dal nome o dall'ordine dei file in `files`.
export function buildMontecalliniBatches(files: MontecalliniFileInput[], today: string): MontecalliniBatch[] {
  // Ordina i file per nome prima di assegnare gli indici locali, cosi'
  // sourceFiles/bd_imports risultano in un ordine stabile e leggibile -
  // non necessario per la correttezza di batch_hash (gia' order-independent
  // di suo) ne' dell'extraction_date (calcolata per riga), solo per un
  // audit trail piu' prevedibile.
  const sortedFiles = [...files].sort((a, b) => a.fileName.localeCompare(b.fileName));

  type Bucket = {
    kind: GroupKind;
    extractionDate: string;
    rows: NormalizedSnapshotRow[];
    sourceFiles: { fileName: string; filePath: string }[];
    sourceChecksums: string[];
    // file -> indice locale in sourceFiles di QUESTO gruppo
    fileIndex: Map<string, number>;
  };
  const buckets = new Map<string, Bucket>();

  for (const file of sortedFiles) {
    for (const group of file.groups) {
      for (const row of group.rows) {
        const extractionDate = computeMontecalliniRowExtractionDate(group.kind, row.stayDate, today);
        const key = `${group.kind}|${extractionDate}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { kind: group.kind, extractionDate, rows: [], sourceFiles: [], sourceChecksums: [], fileIndex: new Map() };
          buckets.set(key, bucket);
        }

        let sourceIndex = bucket.fileIndex.get(file.fileName);
        if (sourceIndex === undefined) {
          sourceIndex = bucket.sourceFiles.length;
          bucket.fileIndex.set(file.fileName, sourceIndex);
          bucket.sourceFiles.push({ fileName: file.fileName, filePath: file.filePath });
          bucket.sourceChecksums.push(file.sourceChecksum);
        }

        bucket.rows.push({
          stayDate: row.stayDate,
          revenueTotal: row.revenueTotal,
          roomsSold: row.roomsSold,
          roomsAvailable: row.roomsAvailable,
          arrivals: row.arrivals,
          presences: row.presences,
          sourceIndex,
          // Diagnostico - trasportato per i guardrail di coerenza, mai
          // scritto ne' hashato (vedi NormalizedSnapshotRow.sourceKpi).
          sourceKpi: row.sourceKpi,
        });
      }
    }
  }

  // Ordine deterministico: kind (cy, sdly, ly) poi extraction_date.
  const kindOrder: Record<GroupKind, number> = { cy: 0, sdly: 1, ly: 2 };
  return [...buckets.values()]
    .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.extractionDate.localeCompare(b.extractionDate))
    .map((b) => ({
      kind: b.kind,
      extractionDate: b.extractionDate,
      rows: b.rows,
      sourceFiles: b.sourceFiles,
      sourceChecksums: b.sourceChecksums,
    }));
}
