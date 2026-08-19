// Parser per l'export BD "Esportazione Prenotazioni" con filtro Tag attivo
// - CSV, delimitatore ";", UTF-8 con BOM. Formato diverso da quello gestito
// da bdExportParser.ts (che e' un file Excel per ADR/RevPAR aggregato per
// periodo) - non riusabile per questo caso, da qui un parser dedicato.
//
// Il campo testo "Tag" nel file risulta sempre vuoto anche con filtro
// attivo (limite noto dell'export BD, gia' verificato in audit): il dato
// e' l'appartenenza stessa al file filtrato, non un valore di colonna -
// questo parser quindi NON cerca ne' richiede una colonna "Tag".

export type ParsedTagBookingRow = {
  bookingCode: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string | null; // YYYY-MM-DD
  periodYear: number; // derivato da checkIn - mese di check-in, mai split proporzionale
  periodMonth: number;
  tagAmount: number; // da "Totale Soggiorno"
  status: string; // valore raw, per audit/log - solo le righe CONFERMATA finiscono in "rows"
};

export type ExcludedRow = {
  line: number;
  bookingCode: string | null;
  status: string | null;
  reason: string;
};

export type TagParseResult = {
  rows: ParsedTagBookingRow[]; // solo Stato = CONFERMATA
  excludedRows: ExcludedRow[]; // Stato diverso da CONFERMATA (es. IN ATTESA) - mai scartate silenziosamente
  errors: string[]; // righe con formato inatteso/importo non parsabile - mai un fallimento silenzioso o dell'intero import
};

const REQUIRED_COLUMNS = {
  bookingCode: "Cod.",
  checkIn: "Check-in",
  checkOut: "Check-out",
  tagAmount: "Totale Soggiorno",
  status: "Stato",
} as const;

const CONFIRMED_STATUS = "CONFERMATA";

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

// Split minimale ma corretto per un singolo campo tra virgolette (gestisce
// "" come escape della virgoletta letterale) - il resto dei campi di
// questo export non contiene ";" al suo interno per costruzione (codici
// prenotazione, date, importi), ma un campo puo' comunque arrivare
// quotato dall'export stesso.
function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

// "dd/mm/yyyy" -> "yyyy-mm-dd". Nessuna inferenza su formati ambigui: se
// non combacia esattamente il pattern atteso, ritorna null (mai una data
// indovinata).
function parseItalianDate(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, d, m, y] = match;
  const day = Number(d);
  const month = Number(m);
  const year = Number(y);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Formato italiano: punto migliaia, virgola decimale, eventuale simbolo
// euro/spazi. "1.234,56" -> 1234.56. "581" -> 581.
function parseItalianAmount(value: string): number | null {
  const cleaned = value.replace(/[€\s]/g, "").trim();
  if (cleaned === "") return null;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const n = Number(normalized);
  return Number.isNaN(n) ? null : n;
}

export function parseTagBookingsCsv(fileContent: string): TagParseResult {
  const content = stripBom(fileContent);
  const lines = content.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");

  if (lines.length === 0) {
    return { rows: [], excludedRows: [], errors: ["Il file e' vuoto"] };
  }

  const headerFields = splitCsvLine(lines[0], ";");
  const colIndex: Record<string, number> = {};
  for (const [key, label] of Object.entries(REQUIRED_COLUMNS)) {
    colIndex[key] = headerFields.indexOf(label);
  }

  const missing = Object.entries(REQUIRED_COLUMNS).filter(([key]) => colIndex[key] === -1);
  if (missing.length > 0) {
    return {
      rows: [],
      excludedRows: [],
      errors: [
        `Formato file non riconosciuto: colonne mancanti (${missing.map(([, label]) => label).join(", ")}). ` +
          `Colonne trovate: ${headerFields.join(", ")}`,
      ],
    };
  }

  const rows: ParsedTagBookingRow[] = [];
  const excludedRows: ExcludedRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const fields = splitCsvLine(lines[i], ";");

    const bookingCode = fields[colIndex.bookingCode]?.trim() || null;
    const status = fields[colIndex.status]?.trim() || null;
    const checkInRaw = fields[colIndex.checkIn]?.trim() || "";
    const checkOutRaw = fields[colIndex.checkOut]?.trim() || "";
    const tagAmountRaw = fields[colIndex.tagAmount]?.trim() || "";

    if (!bookingCode) {
      errors.push(`Riga ${lineNumber}: codice prenotazione ("Cod.") mancante - riga scartata.`);
      continue;
    }

    const checkIn = parseItalianDate(checkInRaw);
    if (!checkIn) {
      errors.push(`Riga ${lineNumber} (${bookingCode}): Check-in "${checkInRaw}" non nel formato atteso gg/mm/aaaa - riga scartata.`);
      continue;
    }

    const tagAmount = parseItalianAmount(tagAmountRaw);
    if (tagAmount === null) {
      errors.push(`Riga ${lineNumber} (${bookingCode}): Totale Soggiorno "${tagAmountRaw}" non e' un importo valido - riga scartata.`);
      continue;
    }

    // Stato diverso da CONFERMATA: esclusa esplicitamente, mai silenziosamente.
    if ((status ?? "").toUpperCase() !== CONFIRMED_STATUS) {
      excludedRows.push({ line: lineNumber, bookingCode, status, reason: `Stato "${status ?? "assente"}" diverso da CONFERMATA` });
      continue;
    }

    const checkOut = checkOutRaw ? parseItalianDate(checkOutRaw) : null;
    if (checkOutRaw && !checkOut) {
      errors.push(`Riga ${lineNumber} (${bookingCode}): Check-out "${checkOutRaw}" presente ma non nel formato atteso gg/mm/aaaa - riga scartata.`);
      continue;
    }

    const [year, month] = checkIn.split("-").map(Number);

    rows.push({
      bookingCode,
      checkIn,
      checkOut,
      periodYear: year,
      periodMonth: month,
      tagAmount,
      status: status ?? CONFIRMED_STATUS, // per costruzione: se fossimo qui, status normalizzato == CONFERMATA (controllato sopra), mai realmente null
    });
  }

  return { rows, excludedRows, errors };
}
