// Parser dedicato per l'export PMS "PlanningForecast" di Montecallini -
// l'unica delle 6 strutture senza export BD. Formato troppo diverso da
// quello BD (CSV testo vs XLSX binario, colonne diverse, un file = un
// mese anziche' un anno) per condividere la logica riga-per-riga di
// bdExportParser.ts, anche se il dato finale scritto in
// performance_daily_snapshot e' identico nella forma.
//
// CSV, delimitatore ";". Un file copre un solo mese CY (limite del PMS).
// Ogni riga-giorno puo' comparire fino a 3 volte nello stesso file: CY
// (data 2026 pura), SDLY e LY (data 2025 corrispondente, con suffisso
// "(SDLY)"/"(LY)" nella colonna DATA) - tre osservazioni economicamente
// distinte per la stessa stay_date storica, MAI ridondanti (vedi kind
// sotto). Righe di totale ("TOTALE CY"/"TOTALE SDLY"/"TOTALE LY") servono
// solo al controllo di quadratura del PMS stesso, mai importate come
// giornate.
//
// CORREZIONE CRITICA (rispetto alla prima versione di questo file): la
// mappatura CP/CV era invertita. Mappatura corretta, verificata su file
// reali:
//   CP           -> rooms_sold
//   CV           -> rooms_available (DINAMICO riga per riga, MAI fisso a
//                    48 - verificato: le righe CY di una stagione aperta
//                    hanno CV=48, ma le righe SDLY/LY della STESSA riga
//                    del file hanno CV=38, prova diretta che varia)
//   RICAVI TRAT  -> revenue_total
//   PAX          -> presences
//   —            -> arrivals sempre NULL (colonna non disponibile)

import { parseEuroCurrency } from "./bdExportParser";

export type MontecalliniRowKind = "cy" | "sdly" | "ly";

export type ParsedMontecalliniRow = {
  kind: MontecalliniRowKind;
  // Per kind="sdly"/"ly" e' gia' la data storica REALE letta dal file
  // (es. 2025), mai ricavata sottraendo un anno alla data CY - il file
  // la fornisce direttamente nella colonna DATA.
  stayDate: string; // YYYY-MM-DD
  revenueTotal: number;
  roomsSold: number; // da CP
  roomsAvailable: number; // da CV, dinamico
  arrivals: null; // non disponibile in questo export - mai un valore inventato
  presences: number;
};

export type MontecalliniExcludedRow = {
  line: number;
  reason: string;
};

export type MontecalliniWarning = {
  line: number;
  message: string;
};

export type MontecalliniParseResult = {
  rows: ParsedMontecalliniRow[]; // CY + SDLY + LY, classificate per kind
  // Solo righe di totale ("TOTALE CY/SDLY/LY") - non sono un giorno, mai
  // importate. SDLY/LY non sono piu' escluse: vedi `rows`.
  excludedRows: MontecalliniExcludedRow[];
  // Controlli di coerenza indicativi (CV oltre il limite di buon senso,
  // scarto revenue/CP vs ADR dichiarato, scarto CP/CV vs OCCUP dichiarato)
  // - MAI bloccanti, la riga resta comunque importata: servono solo a
  // segnalare un possibile problema nel report di import, non a deciderlo
  // al posto di chi importa.
  warnings: MontecalliniWarning[];
  errors: string[]; // righe malformate o con valori impossibili (CP>CV, negativi) - riga scartata
};

// Limite superiore di BUON SENSO per CV (inventario fisico attuale = 48),
// usato SOLO per un warning, mai per bloccare o forzare il valore - se
// l'inventario fisico cambia in futuro un CV piu' alto e' legittimo.
const ROOMS_SANITY_LIMIT = 48;

// Tolleranza per i controlli di coerenza indicativi (revenue/CP vs ADR,
// CP/CV vs OCCUP) - ADR/OCCUP sono valori del PMS gia' arrotondati per la
// visualizzazione, un piccolo scarto e' atteso e non un errore.
const CONSISTENCY_TOLERANCE = 0.01;

const REQUIRED_COLUMNS = {
  data: "DATA",
  roomsSold: "CP",
  roomsAvailable: "CV",
  presences: "PAX",
  revenue: "RICAVI TRAT",
} as const;

// Colonne di controllo del PMS - MAI lette come fonte del dato (sempre
// ricalcolate da noi, stessa regola dell'export BD), usate SOLO per i
// warning di coerenza sopra. Opzionali: se assenti nel file, i relativi
// controlli vengono semplicemente saltati, mai un errore bloccante.
const OPTIONAL_CONTROL_COLUMNS = {
  adr: "ADR",
  occup: "OCCUP",
} as const;

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

// Split minimale con gestione campi tra virgolette ("" come escape) -
// riscritto qui apposta, mai condiviso con altri parser: questo e' un
// parser autonomo per un formato CSV proprio, non un'estensione di
// bdExportParser.ts (che legge XLSX binario, non testo delimitato).
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

// "21/05/2026 gio" o "21/05/2025 gio (SDLY)" -> "2026-05-21" / "2025-05-21".
// Il giorno della settimana e l'eventuale suffisso (SDLY)/(LY) vengono
// ignorati dalla data (il match e' ancorato all'inizio stringa) - nessuna
// inferenza su formati diversi da gg/mm/aaaa in apertura riga: se non
// combacia, null - mai una data indovinata.
function parseItalianDateWithWeekday(value: string): string | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  const [, d, m, y] = match;
  const day = Number(d);
  const month = Number(m);
  const year = Number(y);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// CP/CV/PAX sono conteggi interi - formato italiano gestito comunque
// (punto migliaia, virgola decimale) per robustezza.
function parseIntegerCell(value: string): number | null {
  const cleaned = value.trim().replace(/\./g, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function parsePercentCell(value: string): number | null {
  const cleaned = value.trim().replace(/%/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function classifyRowKind(dataCell: string): MontecalliniRowKind {
  if (/\(SDLY\)/i.test(dataCell)) return "sdly";
  if (/\(LY\)/i.test(dataCell)) return "ly";
  return "cy";
}

export function parseMontecalliniPmsCsv(fileContent: string): MontecalliniParseResult {
  const content = stripBom(fileContent);
  const lines = content.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");

  if (lines.length === 0) {
    return { rows: [], excludedRows: [], warnings: [], errors: ["Il file e' vuoto"] };
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
      warnings: [],
      errors: [
        `Formato file non riconosciuto: colonne mancanti (${missing.map(([, label]) => label).join(", ")}). ` +
          `Colonne trovate nel file: ${headerFields.join(", ")}`,
      ],
    };
  }

  const optionalColIndex: Record<string, number> = {};
  for (const [key, label] of Object.entries(OPTIONAL_CONTROL_COLUMNS)) {
    optionalColIndex[key] = headerFields.indexOf(label);
  }

  const rows: ParsedMontecalliniRow[] = [];
  const excludedRows: MontecalliniExcludedRow[] = [];
  const warnings: MontecalliniWarning[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const fields = splitCsvLine(lines[i], ";");
    const dataCell = (fields[colIndex.data] ?? "").trim();

    if (!dataCell) continue; // riga vuota residua di fine file, mai un errore

    if (/^TOTALE\b/i.test(dataCell)) {
      excludedRows.push({ line: lineNumber, reason: `Riga di totale ("${dataCell}") - non e' un giorno, esclusa.` });
      continue;
    }

    // Riga di servizio a fine file (riepilogo camere disponibili per
    // categoria a fine mese, non un giorno) - stesso trattamento delle
    // righe TOTALE: esclusa esplicitamente, mai un errore generico "data
    // non interpretabile", mai una riga snapshot.
    if (/^DISPONIBILI A FINE MESE\b/i.test(dataCell)) {
      excludedRows.push({ line: lineNumber, reason: `Riga di servizio ("${dataCell}") - non e' un giorno, esclusa.` });
      continue;
    }

    const stayDate = parseItalianDateWithWeekday(dataCell);
    if (!stayDate) {
      errors.push(`Riga ${lineNumber}: impossibile interpretare la data "${dataCell}"`);
      continue;
    }

    const kind = classifyRowKind(dataCell);

    const roomsSoldRaw = fields[colIndex.roomsSold] ?? "";
    const roomsAvailableRaw = fields[colIndex.roomsAvailable] ?? "";
    const presencesRaw = fields[colIndex.presences] ?? "";
    const revenueRaw = fields[colIndex.revenue] ?? "";

    const roomsSold = parseIntegerCell(roomsSoldRaw);
    const roomsAvailable = parseIntegerCell(roomsAvailableRaw);
    const presences = parseIntegerCell(presencesRaw);
    const revenueTotal = parseEuroCurrency(revenueRaw);

    if (roomsSold === null || roomsAvailable === null || presences === null || revenueTotal === null) {
      errors.push(
        `Riga ${lineNumber} (${dataCell}): valori mancanti o non numerici (CP="${roomsSoldRaw}", CV="${roomsAvailableRaw}", PAX="${presencesRaw}", RICAVI TRAT="${revenueRaw}")`
      );
      continue;
    }

    // ---- Validazioni bloccanti: stati fisicamente impossibili, mai un warning ----
    if (roomsSold < 0 || revenueTotal < 0) {
      errors.push(`Riga ${lineNumber} (${dataCell}): valori negativi non validi (CP=${roomsSold}, revenue=${revenueTotal})`);
      continue;
    }
    if (roomsSold > roomsAvailable) {
      errors.push(`Riga ${lineNumber} (${dataCell}): CP (${roomsSold}) maggiore di CV (${roomsAvailable}) - non si possono vendere piu' camere di quelle vendibili quel giorno.`);
      continue;
    }

    // ---- Warning indicativi: la riga resta comunque importata ----
    if (roomsAvailable > ROOMS_SANITY_LIMIT) {
      warnings.push({
        line: lineNumber,
        message: `CV (${roomsAvailable}) supera il limite di buon senso di ${ROOMS_SANITY_LIMIT} camere (inventario fisico attuale) - importata comunque, verificare se l'inventario e' cambiato.`,
      });
    }

    if (optionalColIndex.adr !== -1 && roomsSold > 0) {
      const declaredAdr = parseEuroCurrency(fields[optionalColIndex.adr] ?? "");
      if (declaredAdr !== null && declaredAdr !== 0) {
        const computedAdr = revenueTotal / roomsSold;
        const relativeDiff = Math.abs(computedAdr - declaredAdr) / Math.abs(declaredAdr);
        if (relativeDiff > CONSISTENCY_TOLERANCE) {
          warnings.push({
            line: lineNumber,
            message: `Coerenza ADR: revenue/CP=${computedAdr.toFixed(2)} si discosta da ADR dichiarato (${declaredAdr.toFixed(2)}) di oltre l'1% - possibile errore di lettura colonne.`,
          });
        }
      }
    }

    if (optionalColIndex.occup !== -1 && roomsAvailable > 0) {
      const declaredOccup = parsePercentCell(fields[optionalColIndex.occup] ?? "");
      if (declaredOccup !== null) {
        const computedOccup = (roomsSold / roomsAvailable) * 100;
        const relativeDiff = Math.abs(computedOccup - declaredOccup) / Math.max(Math.abs(declaredOccup), 1);
        if (relativeDiff > CONSISTENCY_TOLERANCE) {
          warnings.push({
            line: lineNumber,
            message: `Coerenza OCCUP: CP/CV=${computedOccup.toFixed(1)}% si discosta da OCCUP dichiarato (${declaredOccup.toFixed(1)}%) di oltre l'1% - possibile errore di lettura colonne.`,
          });
        }
      }
    }

    rows.push({
      kind,
      stayDate,
      revenueTotal,
      roomsSold,
      roomsAvailable,
      arrivals: null,
      presences,
    });
  }

  return { rows, excludedRows, warnings, errors };
}
