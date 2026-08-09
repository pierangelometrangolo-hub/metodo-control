import * as XLSX from "xlsx";

export type ParsedMonthRow = {
  periodLabel: string;
  stayDate: string;
  revenueTotal: number;
  roomsSold: number;
  roomsAvailable: number;
  arrivals: number;
  presences: number;
};

export type ParseResult = {
  rows: ParsedMonthRow[];
  errors: string[];
};

const ITALIAN_MONTHS: Record<string, number> = {
  gen: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  mag: 5,
  giu: 6,
  lug: 7,
  ago: 8,
  set: 9,
  ott: 10,
  nov: 11,
  dic: 12,
};

const REQUIRED_COLUMNS = {
  data: "Data",
  roomsSold: "Unità occupate",
  roomsAvailable: "Unità in vendita",
  arrivals: "Arrivi",
  presences: "Presenze",
  revenue: "Revenue Totale",
} as const;

function parseEuroCurrency(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;

  const cleaned = value.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? null : n;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(",", "."));
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

// Esempio atteso: "Mercoledì, 01 Gen - 31 Gen 2025" -> "2025-01-01"
// (riga di un mese aggregato: prendiamo solo l'inizio del periodo)
function parsePeriodStartDate(label: string): string | null {
  const afterComma = label.includes(",") ? label.split(",")[1] : label;
  const dayMonthMatch = afterComma?.match(/(\d{1,2})\s+([A-Za-zàèìòù]+)/i);
  const yearMatch = label.match(/(\d{4})/);

  if (!dayMonthMatch || !yearMatch) return null;

  const day = parseInt(dayMonthMatch[1], 10);
  const monthKey = dayMonthMatch[2].toLowerCase().slice(0, 3);
  const month = ITALIAN_MONTHS[monthKey];
  const year = parseInt(yearMatch[1], 10);

  if (!month || Number.isNaN(day) || Number.isNaN(year)) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseBdExportWorkbook(buffer: ArrayBuffer): ParseResult {
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
  const colIndex: Record<string, number> = {};
  for (const [key, label] of Object.entries(REQUIRED_COLUMNS)) {
    colIndex[key] = headerRow.indexOf(label);
  }

  const missing = Object.entries(REQUIRED_COLUMNS).filter(([key]) => colIndex[key] === -1);
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        `Formato file non riconosciuto: colonne mancanti (${missing.map(([, label]) => label).join(", ")}). ` +
          `Colonne trovate nel file: ${headerRow.join(", ")}`,
      ],
    };
  }

  const rows: ParsedMonthRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const periodLabel = String(row[colIndex.data] || "").trim();

    // riga dei totali annuali: non ha un'etichetta di periodo, si salta senza errore
    if (!periodLabel) continue;

    const stayDate = parsePeriodStartDate(periodLabel);
    if (!stayDate) {
      errors.push(`Riga ${i + 1}: impossibile interpretare il periodo "${periodLabel}"`);
      continue;
    }

    const roomsSold = toNumber(row[colIndex.roomsSold]);
    const roomsAvailable = toNumber(row[colIndex.roomsAvailable]);
    const arrivals = toNumber(row[colIndex.arrivals]);
    const presences = toNumber(row[colIndex.presences]);
    const revenueTotal = parseEuroCurrency(row[colIndex.revenue]);

    if (
      roomsSold === null ||
      roomsAvailable === null ||
      arrivals === null ||
      presences === null ||
      revenueTotal === null
    ) {
      errors.push(`Riga ${i + 1} (${periodLabel}): valori mancanti o non numerici`);
      continue;
    }

    rows.push({ periodLabel, stayDate, revenueTotal, roomsSold, roomsAvailable, arrivals, presences });
  }

  return { rows, errors };
}
