// Logica pura (nessun I/O, nessuna chiamata Supabase) di routing
// formato->parser e di calcolo extraction_date per il modulo Performance ->
// Import (app/(control)/performance/import/page.tsx). Estratta qui per
// poterla testare in isolamento: prima viveva come funzioni private dentro
// il file della pagina, senza nessuna copertura di test automatica -
// refactor puro, nessun cambiamento di comportamento (stesse firme, stessa
// logica, stessi valori di ritorno).

export type StructureOption = {
  id: string;
  name: string;
};

// Forma minima comune a ParsedMonthRow (export BD) e ParsedMontecalliniRow
// (export PMS) - permette al routing di restare agnostico rispetto alla
// fonte, senza che nessuno dei due parser dipenda dall'altro. arrivals e'
// nullable qui (mai lo e' per l'export BD, sempre null per l'export PMS
// Montecallini, che non ha questo dato).
export type ImportableRow = {
  stayDate: string;
  revenueTotal: number;
  roomsSold: number;
  roomsAvailable: number;
  arrivals: number | null;
  presences: number;
};

export type FileFormat = "bd_export" | "montecallini_pms";

// CY/SDLY/LY sono tre osservazioni economicamente distinte per lo stesso
// file PMS (mai ridondanti - vedi commento su parseMontecalliniPmsCsv), e
// devono finire su extraction_date diverse per non collidere sul vincolo
// UNIQUE (structure_id, stay_date, extraction_date) pur avendo la stessa
// stay_date storica. Per l'export BD c'e' sempre un solo gruppo "cy" (un
// solo flusso, comportamento invariato).
export type GroupKind = "cy" | "sdly" | "ly";

// Unica struttura senza export BD - usa invece il proprio export PMS
// "PlanningForecast" (CSV, un file per mese). Nome hardcoded qui per il
// controllo formato<->struttura (vedi matchFileToStructure): stesso
// pattern gia' in uso in app/(control)/performance/inserimento-manuale/page.tsx
// (STRUCTURE_NAME), non una convenzione nuova.
export const MONTECALLINI_STRUCTURE_NAME = "Montecallini";

// ATTENZIONE: da quando BD supporta anche l'export CSV (oltre a .xls/.xlsx
// - aggiunto per bypassare un difetto reale dell'export XLS, vedi
// lib/bdExportParser.ts: isRevenueCellDateFormatted/parseBdExportCsv),
// l'estensione ".csv" NON e' piu' un segnale univoco: puo' essere sia il
// PMS "PlanningForecast" di Montecallini sia l'export "ADR - RevPAR" di
// una delle 5 strutture BD. Questa funzione resta una stima "al buio"
// dalla sola estensione (usata solo come fallback quando il contenuto del
// file non e' disponibile, es. un errore di lettura) - per un file .csv
// il valore corretto va sempre determinato leggendo il contenuto con
// detectCsvFormat (sotto), MAI assunto dalla sola estensione. .xls/.xlsx
// restano invece un segnale univoco e sufficiente: solo l'export BD li
// produce, Montecallini non ha un dashboard BD.
export function detectFileFormat(fileName: string): FileFormat {
  return fileName.toLowerCase().endsWith(".csv") ? "montecallini_pms" : "bd_export";
}

// Determina quale dei due dialetti CSV supportati e' effettivamente questo
// file, leggendone il contenuto (mai la sola estensione - vedi
// detectFileFormat sopra). Segnale strutturale verificato su entrambi i
// file reali: il PMS "PlanningForecast" di Montecallini usa SEMPRE ";"
// come delimitatore (0 virgole nell'header reale, 17 punti-e-virgola),
// l'export BD "ADR - RevPAR" usa SEMPRE "," (0 punti-e-virgola nell'header
// reale, 13 virgole) - i due dialetti non si sovrappongono mai. Confrontare
// il conteggio dei due delimitatori sulla prima riga (l'header) e' quindi
// sufficiente e affidabile, senza dover interpretare l'intero contenuto.
export function detectCsvFormat(text: string): FileFormat {
  const firstLine = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r\n|\n|\r/)[0] ?? "";
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons > commas ? "montecallini_pms" : "bd_export";
}

// "Primo giorno del mese successivo" a quello di una data YYYY-MM-DD
// qualunque al suo interno - usata sia per il fallback "mese CY chiuso" sia
// (sempre, incondizionatamente) per le righe LY, che rappresentano per
// definizione un anno gia' concluso.
export function firstDayOfMonthAfter(stayDate: string): string {
  const [year, month] = stayDate.split("-").map(Number);
  // Date.UTC(year, month, 1) con month 1-based si comporta gia' come
  // "primo giorno del mese successivo" (month e' l'indice 0-based del mese
  // SUCCESSIVO) - incluso il rollover di anno per dicembre, gestito
  // nativamente da Date.
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

// Stessa data di un anno prima - usata per le righe SDLY: "la fotografia
// OTB del 2025 presa a una distanza temporale dal soggiorno equivalente a
// quella di oggi rispetto al 2026" e' rappresentata semplicemente da
// extraction_date = data di upload odierna meno un anno.
export function oneYearBefore(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y - 1, m - 1, d)).toISOString().slice(0, 10);
}

// extraction_date corretta per un gruppo di righe PMS Montecallini, in
// base al tipo di osservazione:
//   cy   -> mese CHIUSO (ultimo giorno del mese coperto gia' passato
//           rispetto a oggi): primo giorno del mese successivo (valore
//           fisso, non legato a quando il file e' stato caricato). Mese
//           ANCORA IN CORSO: oggi (stessa convenzione dell'export BD
//           corrente).
//   sdly -> sempre oggi meno un anno (fotografia OTB storica autentica,
//           mai un placeholder).
//   ly   -> sempre primo giorno del mese successivo alla stay_date storica
//           (LY e' per definizione un anno gia' chiuso, nessun caso "in
//           corso" possibile).
export function computeMontecalliniGroupExtractionDate(kind: GroupKind, rows: ImportableRow[], today: string): string {
  if (rows.length === 0) return today; // nessuna riga da cui dedurre il mese, fallback difensivo

  if (kind === "sdly") return oneYearBefore(today);
  if (kind === "ly") return firstDayOfMonthAfter(rows[0].stayDate);

  // kind === "cy"
  const [year, month] = rows[0].stayDate.split("-").map(Number);
  const monthEndDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const isClosedMonth = monthEndDate < today;
  return isClosedMonth ? firstDayOfMonthAfter(rows[0].stayDate) : today;
}

// Punto unico per risolvere l'extraction_date di un gruppo, qualunque sia
// lo slot UI di provenienza (corrente/storico/batch): per l'export BD resta
// sempre il valore scelto dall'utente/dallo slot (fallbackDate, invariato -
// "oggi" per il corrente, la data scelta a mano per storico/batch/SDLY di
// riferimento). Per il PMS Montecallini, fallbackDate viene ignorato: la
// data corretta si ricava sempre dal contenuto del file stesso.
export function resolveGroupExtractionDate(
  format: FileFormat,
  kind: GroupKind,
  rows: ImportableRow[],
  fallbackDate: string,
  today: string
): string {
  if (format !== "montecallini_pms") return fallbackDate;
  return computeMontecalliniGroupExtractionDate(kind, rows, today);
}

// Verificato sul file reale di un incidente (export BD, nome completo:
// "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Sangiorgio Resort ... .xls"):
// il CONTENUTO del file (foglio Excel, proprieta' del workbook) non porta
// nessun identificativo di struttura - la riga 0 e' gia' l'intestazione
// tabellare (Data/Unita' occupate/...), nessuna riga titolo, nessuna
// proprieta' custom. Il nome file e' l'UNICO segnale disponibile, generato
// dall'export BD stesso (non digitato a mano) - affidabile in pratica, ma
// comunque rinominabile per errore, quindi mai trattato come prova quanto
// un identificativo nel contenuto lo sarebbe stato.
export function guessStructureFromFileName(fileName: string, structures: StructureOption[]): StructureOption | null {
  const lower = fileName.toLowerCase();
  const matches = structures.filter((s) => lower.includes(s.name.toLowerCase()));
  return matches.length === 1 ? matches[0] : null;
}

export function guessStructureId(fileName: string, structures: StructureOption[]): string {
  return guessStructureFromFileName(fileName, structures)?.id ?? "";
}

export type StructureMatch =
  | { kind: "match" }
  | { kind: "mismatch"; guessedName: string }
  | { kind: "format_mismatch"; reason: string }
  | { kind: "unknown" };

// Confronta il file (nome + formato gia' rilevato dal CONTENUTO per il
// CSV, vedi detectCsvFormat) con la struttura selezionata. Il controllo di
// formato viene PRIMA di quello sul nome file ed e' piu' forte: il PMS
// "PlanningForecast" (dialetto CSV ";") appartiene solo a Montecallini per
// costruzione (nessun'altra struttura usa questo PMS), e l'export BD
// "ADR - RevPAR" (.xls/.xlsx o dialetto CSV ",") non esiste per
// Montecallini (non ha un dashboard BD) - non e' un'euristica sul nome, e'
// strutturalmente impossibile che sia altrimenti, dato che `format` a
// questo punto e' gia' stato determinato correttamente (mai dalla sola
// estensione per un .csv). "unknown" copre sia "nessun nome struttura
// riconoscibile nel nome file" sia "structureId non ancora selezionato"
// (nulla con cui confrontare).
export function matchFileToStructure(
  fileName: string,
  format: FileFormat,
  selectedStructureId: string,
  structures: StructureOption[]
): StructureMatch {
  if (!selectedStructureId) return { kind: "unknown" };
  const selected = structures.find((s) => s.id === selectedStructureId);
  const selectedName = selected?.name ?? selectedStructureId;

  if (format === "montecallini_pms" && selectedName !== MONTECALLINI_STRUCTURE_NAME) {
    return {
      kind: "format_mismatch",
      reason: `Questo file è nel formato export PMS "PlanningForecast" (.csv), usato esclusivamente da "${MONTECALLINI_STRUCTURE_NAME}" - hai selezionato "${selectedName}". Import bloccato.`,
    };
  }
  if (format === "bd_export" && selectedName === MONTECALLINI_STRUCTURE_NAME) {
    return {
      kind: "format_mismatch",
      reason: `Questo file è nel formato export BD "ADR - RevPAR" - "${MONTECALLINI_STRUCTURE_NAME}" non ha un export BD, usa l'export PMS "PlanningForecast" (.csv). Import bloccato.`,
    };
  }

  const guessed = guessStructureFromFileName(fileName, structures);
  if (!guessed) return { kind: "unknown" };
  if (guessed.id === selectedStructureId) return { kind: "match" };
  return { kind: "mismatch", guessedName: guessed.name };
}

export function structureMismatchMessage(guessedName: string, selectedName: string): string {
  return `Il file selezionato sembra appartenere a "${guessedName}", ma hai selezionato "${selectedName}". Import bloccato. (verifica basata sul nome del file: l'export BD non contiene un identificativo di struttura nel contenuto)`;
}

// Alias esplicito PMS(BD) -> nome structures.name, SOLO per le strutture il
// cui nome nel filename BD non e' gia' trovabile come sottostringa del
// nome DB (il caso che guessStructureFromFileName sopra copre da solo).
// Verificato sui filename reali dei report BD gia' supportati (ADR/RevPAR,
// Ospiti per provenienza - stesso nome struttura in entrambi, generato da
// BD stesso): "Palazzo Arco Cadura Hotel & SPA", "Palazzo Rollo",
// "Sangiorgio Resort _____", "Villa Neviera Wine Resort" contengono TUTTI
// gia' il rispettivo structures.name come sottostringa (case-insensitive)
// - nessun alias necessario per queste 4. Solo "Palazzo De' Belli" (nome
// che BD scrive nel filename) non ha alcuna relazione di sottostringa con
// "Dimora De Belli" (nome in structures.name) - qui l'alias e'
// indispensabile. Centralizzato qui (mai sparso nei singoli componenti
// UI) cosi' resta riusabile da qualunque importer futuro basato su
// filename BD, non solo da quello che lo richiede oggi (Nazionalita').
const BD_STRUCTURE_NAME_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "Dimora De Belli": ["Palazzo De' Belli"],
};

function structureSearchNames(structure: StructureOption): string[] {
  return [structure.name, ...(BD_STRUCTURE_NAME_ALIASES[structure.name] ?? [])];
}

export type BdStructureResolution =
  | { kind: "resolved"; structureId: string; structureName: string }
  | { kind: "not_found" }
  | { kind: "ambiguous"; candidateNames: string[] };

// Risoluzione BLOCCANTE struttura-da-filename per report BD, con supporto
// alias PMS->DB (vedi sopra) - a differenza di guessStructureFromFileName
// (usata per il confronto "soft" di ADR/RevPAR, dove "unknown" e' ammesso
// con conferma manuale), qui "non trovata"/"ambigua" sono esiti distinti e
// SEMPRE bloccanti, mai un fallback su "nessuna struttura riconosciuta ma
// procedi comunque": vedi lib/nationalityParser.ts e il commento su
// ImportNazionalita per l'uso. Stesso algoritmo di scansione per
// sottostringa di guessStructureFromFileName (non duplicato per caso: e'
// l'unico modo di comporre correttamente candidati-da-alias e
// candidati-da-nome-diretto in un solo controllo di ambiguita').
export function resolveBdStructureFromFileName(fileName: string, structures: StructureOption[]): BdStructureResolution {
  const lower = fileName.toLowerCase();
  const matches = structures.filter((s) => structureSearchNames(s).some((name) => lower.includes(name.toLowerCase())));

  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length > 1) return { kind: "ambiguous", candidateNames: matches.map((s) => s.name) };
  return { kind: "resolved", structureId: matches[0].id, structureName: matches[0].name };
}

// Messaggio bloccante unico per il guardrail struttura-file (Nazionalita'),
// riusato sia nell'anteprima file sia nella riverifica prima della
// scrittura DB - mai due formulazioni diverse per lo stesso esito.
export function bdStructureMismatchMessage(resolution: BdStructureResolution, selectedName: string): string {
  if (resolution.kind === "resolved") {
    return `Il file appartiene a "${resolution.structureName}", ma hai selezionato "${selectedName}". Seleziona la struttura corretta prima di procedere.`;
  }
  return "Impossibile identificare con sicurezza la struttura del file Booking Designer. Verifica il file prima di procedere.";
}
