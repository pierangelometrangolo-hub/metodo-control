import { GroupKind, ImportableRow } from "../../performanceImportRouting";
import { NormalizedSnapshotRow } from "./types";

// Montecallini e' l'unico dataset dove N file compongono UN batch/snapshot
// (vedi commento nella migration performance_import_events): ogni
// PlanningForecast copre un mese, e i diversi mesi caricati insieme nella
// stessa sessione NON sono conflitti tra loro - vanno fusi per kind
// (cy/sdly/ly, ognuno con la propria extraction_date - invariato) PRIMA
// di calcolare hash e chiamare il servizio, mai confrontati file contro
// file.
export type MontecalliniFileInput = {
  fileName: string;
  filePath: string;
  sourceChecksum: string;
  groups: { kind: GroupKind; rows: ImportableRow[] }[];
};

export type MontecalliniBatch = {
  kind: GroupKind;
  // sourceIndex di ogni riga e' un indice LOCALE in sourceFiles (sotto),
  // non nell'elenco originale di file caricati - solo i file che hanno
  // davvero contribuito righe a QUESTO kind vi compaiono.
  rows: NormalizedSnapshotRow[];
  sourceFiles: { fileName: string; filePath: string }[];
  // Checksum dei soli file che contribuiscono a questo kind - usati per
  // calcolare batch_hash (vedi normalization.ts: computeBatchHash ordina
  // questo array PRIMA di unirlo, quindi il risultato e' indipendente
  // dall'ordine con cui i file sono stati selezionati/elaborati qui).
  sourceChecksums: string[];
};

// Non usa MAI i suffissi del filename (es. "PlanningForecast (4).csv")
// come segnale: raggruppa esclusivamente per `kind`, gia' classificato dal
// parser (lib/montecalliniPmsParser.ts) dal contenuto della riga
// (CY/SDLY/LY), indipendente dal nome o dall'ordine dei file in `files`.
export function buildMontecalliniBatches(files: MontecalliniFileInput[]): MontecalliniBatch[] {
  // Ordina i file per nome prima di assegnare gli indici locali, cosi'
  // sourceFiles/bd_imports risultano in un ordine stabile e leggibile -
  // non necessario per la correttezza di batch_hash (gia' order-independent
  // di suo), solo per un audit trail piu' prevedibile.
  const sortedFiles = [...files].sort((a, b) => a.fileName.localeCompare(b.fileName));

  const byKind = new Map<
    GroupKind,
    { rows: NormalizedSnapshotRow[]; sourceFiles: { fileName: string; filePath: string }[]; sourceChecksums: string[] }
  >();

  for (const file of sortedFiles) {
    for (const group of file.groups) {
      if (group.rows.length === 0) continue;

      let bucket = byKind.get(group.kind);
      if (!bucket) {
        bucket = { rows: [], sourceFiles: [], sourceChecksums: [] };
        byKind.set(group.kind, bucket);
      }

      const sourceIndex = bucket.sourceFiles.length;
      bucket.sourceFiles.push({ fileName: file.fileName, filePath: file.filePath });
      bucket.sourceChecksums.push(file.sourceChecksum);

      for (const row of group.rows) {
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

  return [...byKind.entries()].map(([kind, bucket]) => ({
    kind,
    rows: bucket.rows,
    sourceFiles: bucket.sourceFiles,
    sourceChecksums: bucket.sourceChecksums,
  }));
}
