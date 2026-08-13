import * as XLSX from "xlsx";

export type ParsedNationalityRow = {
  stayDate: string;
  nationality: string;
  presences: number;
};

export type NationalityParseResult = {
  rows: ParsedNationalityRow[];
  errors: string[];
};

const DATE_COLUMN_LABEL = "Data";

// Formato atteso "Ospiti per Nazione": prima colonna "Data" (un giorno per
// riga), colonne successive = una per nazionalità, valore = presenze quel
// giorno. Nessuna riga scritta per celle vuote/zero (stessa convenzione
// gia' in uso nei dati storici 2026 gia' importati: verificato che
// guest_nationality non ha mai una riga con presences=0).
//
// Formato non ancora validato su un file reale da questo parser (lo
// storico 2026 e' stato caricato via script esterno, non da qui) - se le
// colonne o il formato data non corrispondono, fallisce con un errore
// esplicito che elenca le intestazioni trovate, mai un import silenzioso
// di dati sbagliati.
function excelSerialToStayDate(serial: number): string | null {
  // Costante standard per la conversione epoch Excel (1900) -> epoch Unix,
  // stessa formula usata da XLSX.SSF internamente.
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDateCell(value: unknown): string | null {
  if (typeof value === "number") {
    return excelSerialToStayDate(value);
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // "YYYY-MM-DD"
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return trimmed;

  // "DD/MM/YYYY" o "DD-MM-YYYY"
  const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return null;
}

function toPresenceCount(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(",", "."));
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export function parseNationalityWorkbook(buffer: ArrayBuffer): NationalityParseResult {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch (err) {
    return {
      rows: [],
      errors: [`File non leggibile come Excel: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], errors: ["Il file non contiene nessun foglio"] };
  }

  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });

  if (data.length === 0) {
    return { rows: [], errors: ["Il foglio è vuoto"] };
  }

  const headerRow = data[0].map((h) => String(h).trim());
  const dateColIndex = headerRow.indexOf(DATE_COLUMN_LABEL);

  if (dateColIndex === -1) {
    return {
      rows: [],
      errors: [
        `Formato file non riconosciuto: colonna "${DATE_COLUMN_LABEL}" non trovata. ` +
          `Colonne trovate nel file: ${headerRow.join(", ")}`,
      ],
    };
  }

  const nationalityColumns = headerRow
    .map((label, index) => ({ label, index }))
    .filter(({ label, index }) => index !== dateColIndex && label !== "");

  if (nationalityColumns.length === 0) {
    return {
      rows: [],
      errors: [`Nessuna colonna nazionalità trovata oltre a "${DATE_COLUMN_LABEL}". Colonne trovate: ${headerRow.join(", ")}`],
    };
  }

  const rows: ParsedNationalityRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rawDate = row[dateColIndex];
    if (rawDate === "" || rawDate === undefined) continue; // riga vuota di chiusura tabella, salta senza errore

    const stayDate = parseDateCell(rawDate);
    if (!stayDate) {
      errors.push(`Riga ${i + 1}: impossibile interpretare la data "${String(rawDate)}"`);
      continue;
    }

    for (const { label, index } of nationalityColumns) {
      const presences = toPresenceCount(row[index]);
      // Nessuna riga per celle vuote o pari a zero - stessa convenzione
      // gia' osservata nei dati storici 2026 (mai presences=0 salvato).
      if (presences === null || presences <= 0) continue;
      rows.push({ stayDate, nationality: label, presences });
    }
  }

  return { rows, errors };
}
