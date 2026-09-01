import * as XLSX from "xlsx";
import { parsePeriodStartDate } from "./bdExportParser";

export type ParsedNationalityRow = {
  stayDate: string;
  nationality: string;
  presences: number;
};

export type NationalityParseResult = {
  rows: ParsedNationalityRow[];
  errors: string[];
};

// Il report BD "Ospiti per provenienza" (Nazionalità) usa un'intestazione
// GERARCHICA su due righe, verificata su file reali (.xls e .csv, stesso
// export, stessa struttura in entrambi i formati - XLSX.read gestisce i due
// formati in modo identico, nessun parser separato necessario qui a
// differenza di lib/bdExportParser.ts, dove la corruzione riguardava il
// TIPO della singola cella, non l'interpretazione dell'intestazione):
//
//   riga 0 (gruppi):   "" | "Totali" | "" | "" | "ITALIA" | "" | "" | "FRANCIA" | ...
//   riga 1 (metriche): "Data" | "Presenze" | "Arrivi" | "Partenze" | "Presenze" | "Arrivi" | "Partenze" | ...
//   riga 2+ (dati):    "Giovedì, 01 Gennaio 2026" | 0 | 0 | 0 | "" | "" | "" | ...
//
// L'etichetta di gruppo compare SOLO nella prima colonna del proprio blocco
// (le altre restano vuote, "merged cell" nel foglio originale) - va quindi
// "trascinata in avanti" (forward-fill) finche' non se ne incontra una
// nuova. La prima colonna (indice 0) e' sempre la data: usata per
// POSIZIONE, non cercando una cella letterale "Data" in riga 0 (era li'
// l'errore del parser precedente - "Data" compare davvero, ma in riga 1,
// mai in riga 0, che per quella colonna e' vuota).
//
// A MeToDo Control interessa solo "Presenze" per ogni nazionalità reale:
// "Arrivi"/"Partenze" non vengono mai lette, e il gruppo "Totali" (sempre
// il primo dopo la colonna data) e' un aggregato del BD stesso, non una
// nazionalità - escluso esplicitamente per nome strutturale (non e' un
// hardcode di una nazionalità: "Totali" non lo e' mai).
//
// Il numero di nazionalità, i loro nomi e la posizione delle rispettive
// colonne "Presenze" sono dedotti dinamicamente dalle due righe di
// intestazione - nessun nome di nazionalità e' hardcoded nel codice.
const GROUP_ROW_INDEX = 0;
const METRIC_ROW_INDEX = 1;
const DATA_COLUMN_INDEX = 0;
const PRESENCES_METRIC_LABEL = "presenze";
const TOTALS_GROUP_LABEL = "totali";

function toPresenceCount(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(",", "."));
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

type PresenceColumn = {
  index: number;
  nationality: string;
};

// Deduce, dalle due righe di intestazione, l'elenco delle colonne
// "Presenze" e a quale nazionalità appartiene ciascuna - vedi commento in
// testa al file per la logica di forward-fill del gruppo.
function findPresenceColumns(groupRow: string[], metricRow: string[]): PresenceColumn[] {
  const columns: PresenceColumn[] = [];
  let currentGroup = "";

  const columnCount = Math.max(groupRow.length, metricRow.length);
  for (let col = DATA_COLUMN_INDEX + 1; col < columnCount; col++) {
    const groupLabel = (groupRow[col] ?? "").trim();
    if (groupLabel !== "") currentGroup = groupLabel;

    const metricLabel = (metricRow[col] ?? "").trim().toLowerCase();
    if (metricLabel !== PRESENCES_METRIC_LABEL) continue;
    if (!currentGroup) continue; // colonna "Presenze" senza nessun gruppo ancora visto - intestazione malformata, ignorata
    if (currentGroup.toLowerCase() === TOTALS_GROUP_LABEL) continue; // aggregato BD, non una nazionalità

    columns.push({ index: col, nationality: currentGroup });
  }

  return columns;
}

export function parseNationalityWorkbook(buffer: ArrayBuffer): NationalityParseResult {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch (err) {
    return {
      rows: [],
      errors: [`File non leggibile: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], errors: ["Il file non contiene nessun foglio"] };
  }

  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });

  if (data.length <= METRIC_ROW_INDEX) {
    return {
      rows: [],
      errors: ["Il file non ha le due righe di intestazione attese (riga gruppi + riga metriche Presenze/Arrivi/Partenze)"],
    };
  }

  const groupRow = data[GROUP_ROW_INDEX].map((h) => String(h).trim());
  const metricRow = data[METRIC_ROW_INDEX].map((h) => String(h).trim());
  const presenceColumns = findPresenceColumns(groupRow, metricRow);

  if (presenceColumns.length === 0) {
    return {
      rows: [],
      errors: [
        `Formato file non riconosciuto: nessuna colonna "Presenze" per nazionalità trovata nell'intestazione a due righe. ` +
          `Riga 1 (gruppi): ${groupRow.join(", ")}. Riga 2 (metriche): ${metricRow.join(", ")}.`,
      ],
    };
  }

  const rows: ParsedNationalityRow[] = [];
  const errors: string[] = [];

  for (let i = METRIC_ROW_INDEX + 1; i < data.length; i++) {
    const row = data[i];
    const rawDate = row[DATA_COLUMN_INDEX];

    // riga vuota di chiusura tabella (totale annuale, colonna data vuota) - salta senza errore
    if (rawDate === "" || rawDate === undefined || rawDate === null) continue;

    const stayDate = parsePeriodStartDate(String(rawDate));
    if (!stayDate) {
      errors.push(`Riga ${i + 1}: impossibile interpretare la data "${String(rawDate)}"`);
      continue;
    }

    for (const { index, nationality } of presenceColumns) {
      const presences = toPresenceCount(row[index]);
      // Nessuna riga per celle vuote o pari a zero - solo le combinazioni
      // giorno x nazionalita' realmente riportate da BD, mai la matrice
      // artificiale con zeri per ogni nazionalità.
      if (presences === null || presences <= 0) continue;
      rows.push({ stayDate, nationality, presences });
    }
  }

  return { rows, errors };
}
