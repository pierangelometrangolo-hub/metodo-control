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
  // Righe importate comunque ma con un dubbio diagnostico non risolvibile
  // automaticamente - vedi evaluateRevenueConsistency (caso "un solo KPI
  // disponibile ed e' incoerente"). Vuoto quando non c'e' nulla da
  // segnalare, mai usato per bloccare un import.
  warnings: string[];
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

// Cella Revenue Totale FORMATTATA COME DATA invece che come valuta/numero -
// difetto distinto e piu' grave della "formattazione testo persa" (vedi
// commento sopra parseEuroCurrency): non e' un valore corretto letto in un
// formato diverso, e' un valore FISICAMENTE NON PIU' PRESENTE nella cella.
// Caso reale confermato bit per bit (Villa Neviera 2026-09-01, Lunedi' 27
// Luglio 2026, cella K209): il numero memorizzato nella cella (33627) e'
// il seriale Excel della data 23/01/1992 sotto il formato numerico
// "m/d/yy" associato alla cella - non un revenue in nessuna interpretazione
// possibile (verificato: forzare un formato valuta sullo stesso identico
// cell.v produce "€33.627,00", mai "€1.024,92" - nessuna opzione di
// lettura SheetJS recupera un valore diverso da 33627 per quella cella).
// Passare questo numero a parseEuroCurrency lo accetterebbe silenziosamente
// come revenue valido (e' un number finito) - da qui questo controllo
// dedicato, PRIMA di parseEuroCurrency, sulla cella FISICA (non sul valore
// gia' estratto da sheet_to_json, che perde t/z).
//
// NON basta controllare cell.t === "d": nel file reale, con le opzioni di
// lettura effettivamente usate da questo parser (XLSX.read senza
// cellDates), la stessa cella corrotta arriva con t:"n" (non "d") - e'
// SOLO cell.z ("m/d/yy") a rivelare che si tratta di una data. cell.t==="d"
// resta comunque controllato in aggiunta (mai in sostituzione) per i casi
// in cui altre opzioni di lettura o altri export lo impostassero davvero.
export function isRevenueCellDateFormatted(cell: XLSX.CellObject | undefined): boolean {
  if (!cell) return false;
  if (cell.t === "d") return true;
  if (typeof cell.z !== "string") return false;
  try {
    return XLSX.SSF.is_date(cell.z);
  } catch {
    // XLSX.SSF.is_date lancia su input non-stringa (null/undefined) - mai
    // atteso qui dato il typeof sopra, ma un formato non standard non deve
    // mai far crashare l'intero import: fail-safe, non un difetto data.
    return false;
  }
}

// Colonne KPI dell'export "ADR - RevPAR" - presenti nel file ma MAI lette
// come fonte del dato, solo come riferimento indipendente per il controllo
// di coerenza sotto: usano lo stesso formato importi (testo "€ X,XX" o,
// occasionalmente, number Excel grezzo) di Revenue Totale, quindi vengono
// lette con la stessa parseEuroCurrency.
//
// ATTENZIONE al nome esatto della colonna ADR: NON e' "ADR" (verificato
// su file reale, estrazione Villa Neviera 2026-09-01 - con "ADR" l'indice
// colonna risultava sempre -1, il controllo ADR non si attivava MAI su
// nessun file BD reale). L'header vero e' "Tariffa media (ADR)".
const OPTIONAL_KPI_COLUMNS = {
  adr: "Tariffa media (ADR)",
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
// nell'incidente del 2026-08-19: 30325 al posto di ~300, e su Villa
// Neviera 2026-09-01: 33627 al posto di ~1.024,94 - confermato
// matematicamente da ADR e RevPAR dichiarati che concordano tra loro).
//
// ADR e RevPAR pero' NON sono riferimenti sempre affidabili: soffrono
// esattamente della stessa malattia di Revenue Totale (numero Excel
// grezzo corrotto al posto del testo formattato) - verificato sullo
// stesso file reale, 21 righe su 365 hanno RevPAR come number grezzo
// palesemente sbagliato mentre Revenue Totale in quelle stesse righe era
// perfettamente valido (confermato dall'ADR, che coincideva esattamente).
// Un guardrail che scarta la riga sulla base di un SOLO riferimento
// incoerente rischia quindi di scartare righe sane per colpa del
// riferimento, non del dato controllato. Da qui la classificazione a tre
// vie sotto (consistent/inconsistent/unavailable) e la regola "basta un
// riscontro coerente per accettare, servono tutti i riscontri disponibili
// discordanti per scartare, un solo riscontro disponibile e discorde da'
// solo un warning" - mai un numero magico su Revenue Totale in se'
// (nessuna soglia tipo "revenue > X"), solo relazioni aritmetiche gia' in
// uso altrove nell'app (lib/performanceMetrics.ts).
type KpiVerdict = "consistent" | "inconsistent" | "unavailable";

type KpiCheckOutcome = {
  label: string;
  verdict: KpiVerdict;
  computed: number | null;
  declared: number | null;
};

// Classifica un singolo KPI (ADR o RevPAR) per una riga - "unavailable" se
// manca uno qualunque degli ingredienti necessari per un confronto
// (colonna assente dal file, cella vuota/non interpretabile, denominatore
// a zero -> KPI matematicamente non definito): l'assenza di un riferimento
// non e' MAI una prova di corruzione.
function classifyKpi(label: string, computed: number | null, declaredCell: unknown): KpiCheckOutcome {
  if (computed === null || declaredCell === undefined) {
    return { label, verdict: "unavailable", computed, declared: null };
  }
  const declared = parseEuroCurrency(declaredCell);
  if (declared === null) {
    return { label, verdict: "unavailable", computed, declared: null };
  }
  const verdict: KpiVerdict = isWithinKpiTolerance(computed, declared) ? "consistent" : "inconsistent";
  return { label, verdict, computed, declared };
}

function classifyKpiChecks(
  revenueTotal: number,
  roomsSold: number,
  roomsAvailable: number,
  row: unknown[],
  optionalColIndex: Record<string, number>
): KpiCheckOutcome[] {
  return [
    classifyKpi(
      "ADR",
      roomsSold > 0 ? revenueTotal / roomsSold : null,
      optionalColIndex.adr !== -1 ? row[optionalColIndex.adr] : undefined
    ),
    classifyKpi(
      "RevPAR",
      roomsAvailable > 0 ? revenueTotal / roomsAvailable : null,
      optionalColIndex.revpar !== -1 ? row[optionalColIndex.revpar] : undefined
    ),
  ];
}

type RevenueConsistencyAction =
  | { kind: "accept" }
  | { kind: "warn"; detail: string }
  | { kind: "reject"; detail: string };

// Regola decisionale a "votazione" tra i KPI utilizzabili (mai gli
// "unavailable", che restano semplicemente fuori dal conteggio):
//   - almeno un riscontro CONSISTENT -> accetta (un riferimento discorde
//     puo' essere lui stesso corrotto, indipendentemente da Revenue
//     Totale - vedi ADR/RevPAR sopra);
//   - 2+ riscontri utilizzabili e TUTTI inconsistent -> scarta (nessun
//     riferimento indipendente conferma il valore);
//   - un solo riscontro utilizzabile ed e' inconsistent -> warning, MAI
//     uno scarto: con un solo riferimento non si puo' distinguere se il
//     corrotto sia Revenue Totale o il riferimento stesso;
//   - nessun riscontro utilizzabile -> accetta, comportamento invariato
//     (nessuna base per un controllo).
function evaluateRevenueConsistency(outcomes: KpiCheckOutcome[]): RevenueConsistencyAction {
  const usable = outcomes.filter((o) => o.verdict !== "unavailable");

  if (usable.some((o) => o.verdict === "consistent")) {
    return { kind: "accept" };
  }

  if (usable.length >= 2) {
    // qui per costruzione tutti gli utilizzabili sono inconsistent
    const detail = usable
      .map((o) => `${o.label} calcolato (${o.computed!.toFixed(2)}) vs dichiarato (${o.declared!.toFixed(2)})`)
      .join("; ");
    return { kind: "reject", detail: `nessun riscontro indipendente conferma Revenue Totale - ${detail}` };
  }

  if (usable.length === 1) {
    const o = usable[0];
    return {
      kind: "warn",
      detail: `${o.label} calcolato da Revenue Totale (${o.computed!.toFixed(2)}) diverge da ${o.label} dichiarato nel file (${o.declared!.toFixed(2)}) - unico riscontro disponibile: impossibile stabilire se il valore corrotto sia Revenue Totale o ${o.label}, verificare manualmente`,
    };
  }

  return { kind: "accept" };
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
    // cellNF:true e' necessario per isRevenueCellDateFormatted - senza,
    // cell.z (il formato numerico) NON e' garantito presente sulle celle
    // lette: verificato empiricamente che e' presente di default sul file
    // reale (probabilmente per come BD scrive la propria tabella di
    // formati), ma NON e' presente di default su un file .xls scritto e
    // riletto dalla stessa libreria SheetJS (solo .w, il testo gia'
    // formattato, senza .z) - comportamento non garantito su cui non ci si
    // puo' affidare implicitamente. cellNF:true lo rende esplicito e
    // affidabile in entrambi i casi, senza alcun impatto sul resto del
    // parsing (sheet_to_json/.v/.w restano invariati).
    workbook = XLSX.read(buffer, { type: "array", cellNF: true });
  } catch (err) {
    return {
      rows: [],
      errors: [`File non leggibile come Excel: ${err instanceof Error ? err.message : String(err)}`],
      warnings: [],
    };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], errors: ["Il file non contiene nessun foglio"], warnings: [] };
  }

  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });

  if (data.length === 0) {
    return { rows: [], errors: ["Il foglio è vuoto"], warnings: [] };
  }

  // Necessario per risalire dalla riga/colonna POSIZIONALE di sheet_to_json
  // (relativa all'inizio del range usato, es. indice 0 = colonna B se il
  // foglio non usa la colonna A - caso reale confermato su questo stesso
  // export BD) alla cella FISICA del foglio, per leggere t/z - vedi
  // isRevenueCellDateFormatted. Se il range manca o e' malformato (file
  // anomalo), il controllo formato-data viene semplicemente saltato per
  // l'intero file: non deve mai far fallire l'intero import, il resto
  // delle validazioni (parseEuroCurrency, guardrail ADR/RevPAR) resta
  // comunque attivo.
  let sheetRange: XLSX.Range | null = null;
  try {
    if (sheet["!ref"]) sheetRange = XLSX.utils.decode_range(sheet["!ref"]);
  } catch {
    sheetRange = null;
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
      warnings: [],
    };
  }

  // ADR/RevPAR sono opzionali (solo riferimento per evaluateRevenueConsistency,
  // mai richieste per riconoscere il formato del file) - a differenza di
  // REQUIRED_COLUMNS, la loro assenza non blocca l'import, semplicemente
  // riduce i riscontri disponibili per quel controllo (vedi commento sopra
  // evaluateRevenueConsistency).
  const optionalColIndex: Record<string, number> = {};
  for (const [key, label] of Object.entries(OPTIONAL_KPI_COLUMNS)) {
    optionalColIndex[key] = headerRow.indexOf(label);
  }

  const rows: ParsedMonthRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

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

    // Controllo sulla cella FISICA di Revenue Totale, PRIMA di qualunque
    // altra lettura/validazione su questo campo (parseEuroCurrency incluso)
    // - vedi isRevenueCellDateFormatted: un valore fisicamente non piu'
    // presente (sostituito da un seriale-data) non deve mai arrivare al
    // guardrail ADR/RevPAR ne' essere ricostruito da esso.
    if (sheetRange) {
      const revenueCellAddr = XLSX.utils.encode_cell({
        r: sheetRange.s.r + i,
        c: sheetRange.s.c + colIndex.revenue,
      });
      if (isRevenueCellDateFormatted(sheet[revenueCellAddr])) {
        errors.push(
          `Riga ${i + 1} (${periodLabel}): Revenue Totale non leggibile: la cella Excel è formattata come data. Verificare il valore sorgente BD.`
        );
        continue;
      }
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

    const kpiOutcomes = classifyKpiChecks(revenueTotal, roomsSold, roomsAvailable, row, optionalColIndex);
    const action = evaluateRevenueConsistency(kpiOutcomes);
    if (action.kind === "reject") {
      errors.push(`Riga ${i + 1} (${periodLabel}): ${action.detail} - riga scartata (Revenue Totale probabilmente corrotto).`);
      continue;
    }
    if (action.kind === "warn") {
      warnings.push(`Riga ${i + 1} (${periodLabel}): ${action.detail}`);
    }

    rows.push({ periodLabel, stayDate, revenueTotal, roomsSold, roomsAvailable, arrivals, presences });
  }

  return { rows, errors, warnings };
}
