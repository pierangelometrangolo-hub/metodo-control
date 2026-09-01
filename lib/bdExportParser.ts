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

// ATTENZIONE se in futuro aggiungi qui una nuova colonna in formato valuta
// o percentuale (es. ADR, RevPAR, IMO - oggi non lette, ricalcolate lato
// client da revenue/camere gia' validati): l'export BD scrive quasi sempre
// queste colonne come testo formattato ("€ 1.234,56"), ma occasionalmente
// una cella perde la formattazione e arriva come numero Excel grezzo (es.
// 33627 invece di "€ 336,27" per Revenue Totale, caso reale confermato su
// Villa Neviera nell'estrazione del 2026-09-01 - il valore numerico e'
// corretto, solo il formato testo e' andato perso). Usa sempre
// parseEuroCurrency (sotto) per una colonna di questo tipo, MAI toNumber()
// ne' un accesso diretto alla cella: parseEuroCurrency accetta sia il
// testo formattato italiano sia un number Excel grezzo (se finito),
// rifiutando solo NaN/±Infinity/testo non interpretabile - toNumber()
// resta riservato alle colonne di CONTEGGIO (Unita' occupate/in vendita/
// Arrivi/Presenze), che l'export scrive sempre come numero puro.
const REQUIRED_COLUMNS = {
  data: "Data",
  roomsSold: "Unità occupate",
  roomsAvailable: "Unità in vendita",
  arrivals: "Arrivi",
  presences: "Presenze",
  revenue: "Revenue Totale",
} as const;

// "Revenue Totale" nell'export BD arriva quasi sempre come testo
// formattato ("€ 1.234,56"), ma non sempre: alcune celle arrivano come
// number Excel grezzo (formattazione testo persa lato BD, non un errore
// di valore) - caso reale confermato su Villa Neviera e Palazzo Rollo
// nell'estrazione del 2026-09-01 (righe scartate per errore perche' il
// parser si aspettava solo una stringa: 364/365 e 356/365 righe importate
// invece di 365/365). Un number qui va accettato COSI' COM'E' quando e'
// finito (Number.isFinite) - mai ripassato per una stringa e riparsato,
// per non perdere/alterare i decimali originali - e rifiutato solo se
// NaN o ±Infinity (mai un valore plausibile per un revenue). Una stringa
// segue invece il formato importi italiano gia' supportato (simbolo €,
// punto migliaia, virgola decimale, spazi).
//
// Esportata (unica modifica a questo file per il parser Montecallini):
// il formato importi italiano (punto migliaia, virgola decimale) e'
// identico nell'export PMS "PlanningForecast" - riusata cosi' com'e' da
// lib/montecalliniPmsParser.ts invece di duplicare la stessa logica.
// Comportamento e firma invariati salvo l'accettazione dei number finiti,
// nessun altro impatto sulle 5 strutture BD.
export function parseEuroCurrency(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;

  const cleaned = value.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? null : n;
}

// Colonne KPI dell'export "ADR - RevPAR" (nome del report stesso, invariato
// da come compare nel nome file reale - vedi matchFileToStructure in
// lib/performanceImportRouting.ts) - presenti nel file ma MAI lette come
// fonte del dato, solo come riferimento indipendente per il controllo di
// coerenza sotto: usano lo stesso formato importi (testo "€ X,XX" o,
// occasionalmente, number Excel grezzo) di Revenue Totale, quindi vengono
// lette con la stessa parseEuroCurrency.
const OPTIONAL_KPI_COLUMNS = {
  adr: "ADR",
  revpar: "RevPAR",
} as const;

// Stesse identiche definizioni gia' in uso in lib/performanceMetrics.ts
// (adr/revPar) per calcolare questi KPI a valle da revenue/camere gia'
// validati - qui vengono ricalcolate dal lato "grezzo" del file (revenue
// letto + camere lette) solo per confrontarle con l'ADR/RevPAR che BD
// stessa dichiara nella stessa riga, non per introdurre una definizione
// nuova.
const KPI_RELATIVE_TOLERANCE = 0.01; // 1% - copre gli arrotondamenti a 2 decimali che BD applica ai KPI visualizzati
const KPI_ABSOLUTE_TOLERANCE = 0.5; // mezzo euro - evita una tolleranza irragionevolmente stretta (o una divisione per zero) quando il KPI dichiarato e' vicino/uguale a zero

function isWithinKpiTolerance(computed: number, declared: number): boolean {
  const allowedDiff = Math.max(KPI_ABSOLUTE_TOLERANCE, Math.abs(declared) * KPI_RELATIVE_TOLERANCE);
  return Math.abs(computed - declared) <= allowedDiff;
}

// Guardrail di coerenza per Revenue Totale: nato dal fix che ha esteso
// parseEuroCurrency ad accettare i number Excel grezzi (vedi commento sopra
// REQUIRED_COLUMNS) - quel fix risolve i casi legittimi (formattazione
// testo persa, valore corretto) ma da solo non distingue piu' un number
// legittimo da un number REALMENTE corrotto (caso reale confermato
// nell'incidente del 2026-08-19: 30325 al posto di ~300). Qui si confronta
// il Revenue Totale letto (da stringa O da number, stesso controllo per
// entrambi) con ADR/RevPAR che BD dichiara nella stessa riga, quando
// disponibili e utilizzabili - MAI un numero magico su Revenue Totale in
// se' (nessuna soglia tipo "revenue > X"), solo una relazione aritmetica
// gia' in uso altrove nell'app. Se nessun KPI e' disponibile/utilizzabile
// per la riga (colonna assente dal file, cella vuota/non interpretabile,
// roomsSold/roomsAvailable a zero), il controllo per quel KPI viene
// semplicemente saltato - MAI trattato come un mismatch: l'assenza di un
// riferimento non e' una prova di corruzione, e bloccare in quel caso
// reintrodurrebbe falsi positivi che questo guardrail non deve creare.
function checkRevenueConsistency(
  revenueTotal: number,
  roomsSold: number,
  roomsAvailable: number,
  row: unknown[],
  optionalColIndex: Record<string, number>
): { inconsistent: boolean; detail: string } {
  const checks: { label: string; computed: number | null; declaredCell: unknown }[] = [
    {
      label: "ADR",
      computed: roomsSold > 0 ? revenueTotal / roomsSold : null,
      declaredCell: optionalColIndex.adr !== -1 ? row[optionalColIndex.adr] : undefined,
    },
    {
      label: "RevPAR",
      computed: roomsAvailable > 0 ? revenueTotal / roomsAvailable : null,
      declaredCell: optionalColIndex.revpar !== -1 ? row[optionalColIndex.revpar] : undefined,
    },
  ];

  for (const check of checks) {
    if (check.computed === null) continue; // roomsSold/roomsAvailable a zero: KPI non definito, nessun controllo possibile
    if (check.declaredCell === undefined) continue; // colonna assente dal file
    const declared = parseEuroCurrency(check.declaredCell);
    if (declared === null) continue; // cella KPI vuota/non interpretabile: nessun riferimento utilizzabile, mai un blocco per questo

    if (!isWithinKpiTolerance(check.computed, declared)) {
      return {
        inconsistent: true,
        detail: `${check.label} calcolato da Revenue Totale (${check.computed.toFixed(2)}) incoerente con ${check.label} dichiarato nel file (${declared.toFixed(2)})`,
      };
    }
  }

  return { inconsistent: false, detail: "" };
}

// Solo per colonne di CONTEGGIO (camere/arrivi/presenze), mai per colonne
// valuta/percentuale - vedi il commento sopra REQUIRED_COLUMNS.
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

  // ADR/RevPAR sono opzionali (solo riferimento per checkRevenueConsistency,
  // mai richieste per riconoscere il formato del file) - a differenza di
  // REQUIRED_COLUMNS, la loro assenza non blocca l'import, semplicemente
  // disattiva il controllo di coerenza per l'intero file (vedi commento
  // sopra checkRevenueConsistency).
  const optionalColIndex: Record<string, number> = {};
  for (const [key, label] of Object.entries(OPTIONAL_KPI_COLUMNS)) {
    optionalColIndex[key] = headerRow.indexOf(label);
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

    const kpiCheck = checkRevenueConsistency(revenueTotal, roomsSold, roomsAvailable, row, optionalColIndex);
    if (kpiCheck.inconsistent) {
      errors.push(`Riga ${i + 1} (${periodLabel}): ${kpiCheck.detail} - riga scartata (Revenue Totale probabilmente corrotto).`);
      continue;
    }

    rows.push({ periodLabel, stayDate, revenueTotal, roomsSold, roomsAvailable, arrivals, presences });
  }

  return { rows, errors };
}
